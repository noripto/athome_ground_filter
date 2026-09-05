<script lang="ts">
  import FilterEditor from './FilterEditor.svelte';
  import ResultCard from './ResultCard.svelte';
  import {
    SORT_OPTIONS,
    applyViewFilter,
    emptyViewFilter,
    isViewFilterActive,
    refilter,
    sortProperties,
    type ViewFilter
  } from '../lib/view';
  import { sendFavorite, sendFavoriteList, sendUnfavorite } from '../lib/athome-tab';
  import { deleteFavorite, getDetail, getListing, listFavorites, putFavorite } from '../lib/db';
  import { isFavouritable, reconcile } from '../lib/favorite';
  import { detailIdFromUrl } from '../lib/markup';
  import { loadFavoriteSync, saveFavoriteSync } from '../lib/storage';
  import type { Favorite, FilterSettings, PropertyResult, ResultSet, Settings } from '../lib/types';

  type Tab = 'ok' | 'ng' | 'all' | 'fav';

  interface Props {
    results: ResultSet;
    live?: boolean;
    onclose?: () => void;
  }

  let { results, live = false, onclose }: Props = $props();

  let tab = $state<Tab>('ok');
  let sortIndex = $state(0);
  let refilterOpen = $state(false);
  let view = $state<ViewFilter>(emptyViewFilter());

  const PAGE = 300;
  let shown = $state(PAGE);
  let refilterSerial = $state(0);

  let favorites = $state<Favorite[]>([]);
  let pending = $state<string[]>([]);
  let bulk = $state<{ done: number; total: number; failed: number } | null>(null);
  let stopBulk = false;

  const BULK_DELAY_MS = 1500;

  let syncing = $state(false);
  let syncNote = $state('');
  let syncedAt = $state<number | null>(null);
  let orphans = $state<string[]>([]);
  let syncedOnce = false;

  listFavorites().then(stored => {
    favorites = stored.sort((a, b) => b.addedAt - a.addedAt);
  });
  loadFavoriteSync().then(at => (syncedAt = at));

  $effect(() => {
    if (tab !== 'fav' || syncedOnce) return;
    syncedOnce = true;
    void sync();
  });

  const favoriteIds = $derived(new Set(favorites.map(entry => entry.id)));
  const idOf = (property: PropertyResult) => detailIdFromUrl(property.url) ?? '';

  let liveFilters = $state<FilterSettings | null>(null);

  const judged = $derived(
    liveFilters ? refilter(results.properties, liveFilters) : results.properties
  );

  const searchable = $derived(judged.filter(p => !favoriteIds.has(idOf(p))));

  const byTab = $derived(
    tab === 'fav'
      ? favorites.map(entry => entry.property)
      : tab === 'ok'
        ? searchable.filter(p => p.passed)
        : tab === 'ng'
          ? searchable.filter(p => !p.passed)
          : searchable
  );

  const visible = $derived(sortProperties(applyViewFilter(byTab, view), SORT_OPTIONS[sortIndex]));

  const viewKey = $derived(
    [
      tab,
      sortIndex,
      refilterSerial,
      view.keyword,
      view.minPriceMan,
      view.maxPriceMan,
      view.minAreaSqm,
      view.maxAreaSqm,
      view.maxWalkMinutes
    ].join('|')
  );
  $effect(() => {
    void viewKey;
    shown = PAGE;
  });

  const rendered = $derived(visible.slice(0, shown));
  const remaining = $derived(visible.length - rendered.length);

  const narrowed = $derived(isViewFilterActive(view) || liveFilters !== null);
  const passedNow = $derived(judged.filter(p => p.passed).length);

  const tabs = $derived<{ id: Tab; label: string }[]>([
    { id: 'ok', label: '合致のみ' },
    { id: 'ng', label: '除外のみ' },
    { id: 'all', label: '全件' },
    { id: 'fav', label: `★ お気に入り${favorites.length ? ` ${favorites.length}` : ''}` }
  ]);

  function noteFor(id: string): string {
    return favorites.find(f => f.id === id)?.remoteNote ?? '';
  }

  function why(reply: { error: string; status: number; body: string }): string {
    return reply.error || `HTTP ${reply.status} ${reply.body}`.trim();
  }

  async function remember(entry: Favorite): Promise<void> {
    const plain = $state.snapshot(entry) as Favorite;
    await putFavorite(plain);
    favorites = favorites.some(f => f.id === plain.id)
      ? favorites.map(f => (f.id === plain.id ? plain : f))
      : [plain, ...favorites];
  }

  async function fail(entry: Favorite, note: string): Promise<void> {
    console.warn('[AGF]', note);
    await remember({ ...$state.snapshot(entry), remoteNote: note } as Favorite);
  }

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  async function star(property: PropertyResult): Promise<void> {
    const id = idOf(property);
    if (!id || favoriteIds.has(id) || pending.includes(id)) return;

    pending = [...pending, id];
    const entry: Favorite = {
      id,
      addedAt: Date.now(),
      property: $state.snapshot(property) as PropertyResult,
      origin: 'extension',
      remote: 'unsent',
      remoteNote: ''
    };

    try {
      await remember(entry);

      if (!isFavouritable(id)) {
        await fail(entry, '⚠ 物件番号を読み取れませんでした');
        return;
      }

      const reply = await sendFavorite(id, results.searchUrl);
      if (reply.ok) await remember({ ...entry, remote: 'ok', remoteNote: '' });
      else {
        await remember({ ...entry, remote: 'failed' });
        await fail(entry, `⚠ athome への登録に失敗: ${why(reply)}`);
      }
    } catch (err) {
      await fail(entry, `⚠ 登録できませんでした: ${err instanceof Error ? err.message : err}`);
    } finally {
      pending = pending.filter(other => other !== id);
    }
  }

  async function unstar(id: string): Promise<void> {
    const entry = favorites.find(f => f.id === id);
    if (!entry || pending.includes(id)) return;

    pending = [...pending, id];
    try {
      if (entry.remote === 'ok') {
        const reply = await sendUnfavorite(id, results.searchUrl);
        if (!reply.ok) {
          await fail(entry, `⚠ athome からの解除に失敗: ${why(reply)}`);
          return;
        }
      }

      await deleteFavorite(id);
      favorites = favorites.filter(f => f.id !== id);
    } catch (err) {
      await fail(entry, `⚠ 解除できませんでした: ${err instanceof Error ? err.message : err}`);
    } finally {
      pending = pending.filter(other => other !== id);
    }
  }

  function toggleStar(property: PropertyResult): void {
    const id = idOf(property);
    if (!id) {
      console.warn('[AGF] 物件番号を読み取れません:', property.url);
      return;
    }
    void (favoriteIds.has(id) ? unstar(id) : star(property));
  }

  async function importFavorite(id: string): Promise<void> {
    const source = (await getDetail(id)) ?? (await getListing(id));
    await remember({
      id,
      addedAt: Date.now(),
      property: {
        url: `https://www.athome.co.jp/tochi/${id}/`,
        passed: true,
        reasons: [],
        name: source?.name || `物件番号 ${id}`,
        price: source?.price ?? '',
        area: source?.area ?? '',
        location: source?.location ?? '',
        traffic: source?.traffic ?? '',
        fields: source?.fields ?? {}
      },
      origin: 'athome',
      remote: 'ok',
      remoteNote: ''
    });
  }

  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    syncNote = '';

    try {
      const list = await sendFavoriteList(results.searchUrl);
      if (!list.ok) {
        syncNote = `⚠ ${list.note}`;
        return;
      }

      const { toImport, toDrop } = reconcile($state.snapshot(favorites) as Favorite[], list.ids);
      for (const id of toImport) await importFavorite(id);

      orphans = toDrop;
      syncedAt = Date.now();
      await saveFavoriteSync(syncedAt);
      syncNote = `同期しました（${list.note}${toImport.length ? ` ／ 取り込み ${toImport.length}件` : ''}）`;
    } catch (err) {
      syncNote = `⚠ 同期できませんでした: ${err instanceof Error ? err.message : err}`;
    } finally {
      syncing = false;
    }
  }

  async function dropOrphans(): Promise<void> {
    for (const id of orphans) {
      await deleteFavorite(id);
      favorites = favorites.filter(f => f.id !== id);
    }
    orphans = [];
  }

  const syncedLabel = $derived(
    syncedAt === null ? '未同期' : `最終同期 ${new Date(syncedAt).toLocaleString('ja-JP')}`
  );

  async function starAll(): Promise<void> {
    const targets = visible.filter(p => !favoriteIds.has(idOf(p)));
    if (targets.length === 0 || bulk) return;

    stopBulk = false;
    bulk = { done: 0, total: targets.length, failed: 0 };

    for (const property of targets) {
      if (stopBulk) break;
      await star(property);
      const entry = favorites.find(f => f.id === idOf(property));
      bulk = {
        done: bulk.done + 1,
        total: bulk.total,
        failed: bulk.failed + (entry?.remote === 'failed' ? 1 : 0)
      };
      if (!stopBulk) await wait(BULK_DELAY_MS);
    }

    bulk = null;
  }

  function applyFilters(next: Settings) {
    liveFilters = next.filters;
    refilterSerial++;
    refilterOpen = false;
  }

  function resetView() {
    view = emptyViewFilter();
    liveFilters = null;
    refilterSerial++;
  }

  const crawledAt = $derived(new Date(results.timestamp).toLocaleString('ja-JP'));

  const sourceNote = $derived.by(() => {
    switch (results.source) {
      case 'state':
        return '一覧の取得元: athome の埋め込みデータ';
      case 'cards':
        return '⚠ 一覧の取得元: カードのHTML（埋め込みデータを読めず、一部の条件を一覧で判定できません）';
      case 'links':
        return '⚠ 一覧の取得元: リンクのみ（一覧では何も判定できず、全件の詳細ページを取得します）';
      default:
        return '';
    }
  });

  const stopNote = $derived.by(() => {
    if (live) return '';
    switch (results.stoppedBy) {
      case 'target':
      case 'complete':
        return '';
      case 'exhausted':
        return results.requested > 0
          ? `⚠ 指定の ${results.requested}件に届く前に検索結果が尽きました（検索条件を広げてください）`
          : '⚠ 検索結果をすべて読み終えました';
      case 'limit':
        return `⚠ 確認件数の上限 ${results.inspectLimit}件に達したため中断しました（条件が厳しすぎる可能性があります）`;
      case 'paging':
        return '⚠ ページ送りが効きませんでした（athome 側の URL 仕様が変わった可能性があります）';
      case 'blocked':
        return '⚠ athome のアクセス制限に掛かったため中断しました（時間を空けるか、取得間隔を長くして再実行してください）';
      case 'http':
        return `⚠ 通信エラーが続いたため ${results.pagesCrawled} ページ目で中断しました`;
      case 'aborted':
        return '中断しました（ここまでの結果は保存済みです）';
      default:
        return '';
    }
  });
</script>

<div class="view">
  <header class="head">
    <div class="head-main">
      <h1>{live ? '🏗 土地フィルター 取得中…' : '🏗 土地フィルター 結果'}</h1>
      <div class="stats">
        <span class="stat ok">
          ✓ 合致 {results.passed}{results.requested > 0 ? ` / 指定 ${results.requested}` : ''}件
        </span>
        <span class="stat ng">✗ 除外 {results.excluded}件</span>
        {#if results.failed}
          <span class="stat">取得失敗 {results.failed}件</span>
        {/if}
        <span class="stat">確認 {results.inspected}件 / {results.pagesCrawled}ページ</span>
        {#if results.skipped}
          <span class="stat">一覧で除外 {results.skipped}件（詳細取得なし）</span>
        {/if}
        {#if results.cached}
          <span class="stat">キャッシュ {results.cached}件</span>
        {/if}
        {#if results.totalCount != null}
          <span class="stat">
            検索該当 {#if results.countBefore != null && results.countBefore !== results.totalCount}
              {results.countBefore.toLocaleString('ja-JP')} →
            {/if}{results.totalCount.toLocaleString('ja-JP')}件
          </span>
        {/if}
      </div>
      {#if stopNote}
        <div class="meta warn">{stopNote}</div>
      {/if}
      {#if live}
        <div class="meta">取得しながら表示しています。中断してもここまでの結果は残ります。</div>
      {:else}
        <div class="meta">取得日時: {crawledAt}</div>
      {/if}
      {#if sourceNote}
        <div class="meta" class:warn={results.source !== 'state'}>{sourceNote}</div>
      {/if}
      {#if results.narrowedBy?.length}
        <div class="meta">athome 側で絞り込み: {results.narrowedBy.join(' ／ ')}</div>
      {/if}
      {#if results.activeFilters.length}
        <div class="meta">適用条件: {results.activeFilters.join(' ／ ')}</div>
      {:else}
        <div class="meta warn">⚠ 有効なフィルターがありません（全件通過）</div>
      {/if}
    </div>
    {#if onclose}
      <button type="button" class="agf-btn agf-btn-ghost" onclick={onclose}>× 閉じる</button>
    {/if}
  </header>

  <div class="controls">
    {#each tabs as entry (entry.id)}
      <button
        type="button"
        class="tab"
        class:active={tab === entry.id}
        onclick={() => (tab = entry.id)}>{entry.label}</button
      >
    {/each}

    <label class="sort">
      並び替え
      <select bind:value={sortIndex}>
        {#each SORT_OPTIONS as option, index (option.label)}
          <option value={index}>{option.label}</option>
        {/each}
      </select>
    </label>

    <button
      type="button"
      class="tab"
      class:active={refilterOpen}
      onclick={() => (refilterOpen = !refilterOpen)}
    >
      🔎 条件を変えて絞り込む
    </button>

    {#if bulk}
      <span class="bulk">
        ★ 登録中 {bulk.done} / {bulk.total}件{bulk.failed ? `（失敗 ${bulk.failed}件）` : ''}
      </span>
      <button type="button" class="agf-btn agf-btn-stop" onclick={() => (stopBulk = true)}>
        ■ 中断
      </button>
    {:else if tab !== 'fav' && visible.length > 0}
      <button type="button" class="agf-btn agf-btn-secondary" onclick={starAll}>
        ★ 表示中の {visible.length}件を登録
      </button>
    {/if}

    <span class="count">
      {rendered.length}/{visible.length}件表示{narrowed ? `（合致 ${passedNow}件）` : ''}
    </span>
  </div>

  <div class="narrow">
    <input
      class="agf-num keyword"
      type="search"
      placeholder="物件名・所在地・駅で絞り込み"
      bind:value={view.keyword}
    />
    <span class="range">
      価格
      <input
        class="agf-num"
        type="number"
        min="0"
        step="100"
        placeholder="下限"
        bind:value={view.minPriceMan}
      />
      〜
      <input
        class="agf-num"
        type="number"
        min="0"
        step="100"
        placeholder="上限"
        bind:value={view.maxPriceMan}
      />
      万円
    </span>
    <span class="range">
      面積
      <input
        class="agf-num"
        type="number"
        min="0"
        step="10"
        placeholder="下限"
        bind:value={view.minAreaSqm}
      />
      〜
      <input
        class="agf-num"
        type="number"
        min="0"
        step="10"
        placeholder="上限"
        bind:value={view.maxAreaSqm}
      />
      m²
    </span>
    <span class="range">
      駅徒歩
      <input
        class="agf-num"
        type="number"
        min="0"
        step="1"
        placeholder="以内"
        bind:value={view.maxWalkMinutes}
      />
      分
    </span>
    {#if narrowed}
      <button type="button" class="agf-btn agf-btn-secondary" onclick={resetView}
        >条件をリセット</button
      >
    {/if}
  </div>

  {#if refilterOpen}
    <div class="refilter">
      <FilterEditor
        title="🔎 条件を変えて絞り込み直す（再取得なし）"
        onapply={applyFilters}
        onclose={() => (refilterOpen = false)}
      />
    </div>
  {/if}

  {#if tab === 'fav'}
    <div class="sync">
      <button type="button" class="agf-btn agf-btn-secondary" disabled={syncing} onclick={sync}>
        {syncing ? '⏳ 同期中…' : '🔄 athome と同期'}
      </button>
      <span class="synced">{syncedLabel}</span>
      {#if syncNote}
        <span class="synced" class:bad={syncNote.startsWith('⚠')}>{syncNote}</span>
      {/if}
    </div>

    {#if orphans.length}
      <div class="orphans">
        <span>⚠ athome 側にない★が {orphans.length}件あります（athome で解除された可能性）</span>
        <button type="button" class="agf-btn agf-btn-stop" onclick={dropOrphans}>
          athome に合わせて {orphans.length}件を外す
        </button>
      </div>
    {/if}
  {/if}

  <div class="main">
    {#if tab === 'fav' && visible.length === 0}
      <p class="empty">
        まだお気に入りがありません。<br />
        カードの ☆ を押すと、athome のお気に入りに登録してこの検索結果から外します。<br />
        ★ を押し直すと、athome 側からも解除します。
      </p>
    {:else if visible.length === 0}
      <p class="empty">該当する物件がありません。</p>
    {:else}
      <div class="grid">
        {#each rendered as property (property.url)}
          <ResultCard
            {property}
            favorited={favoriteIds.has(idOf(property))}
            busy={pending.includes(idOf(property))}
            favouritable={isFavouritable(idOf(property))}
            origin={favorites.find(f => f.id === idOf(property))?.origin}
            note={noteFor(idOf(property))}
            onfavorite={() => toggleStar(property)}
          />
        {/each}
      </div>
      {#if remaining > 0}
        <div class="more">
          <button type="button" class="agf-btn agf-btn-secondary" onclick={() => (shown += PAGE)}>
            さらに {Math.min(PAGE, remaining)}件表示（残り {remaining}件）
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .view {
    min-height: 100%;
    background: var(--agf-bg);
  }
  .head {
    background: var(--agf-accent);
    color: #fff;
    padding: 14px 20px;
    position: sticky;
    top: 0;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .head h1 {
    margin: 0 0 6px;
    font-size: 18px;
  }
  .stats {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .stat {
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 10px;
    border-radius: 20px;
  }
  .stat.ok {
    background: rgba(39, 174, 96, 0.5);
  }
  .stat.ng {
    background: rgba(0, 0, 0, 0.32);
  }
  .meta {
    font-size: 11px;
    opacity: 0.85;
    margin-top: 6px;
    word-break: break-all;
  }
  .meta.warn {
    opacity: 1;
    color: #ffe9b0;
  }
  .controls {
    background: var(--agf-surface);
    border-bottom: 1px solid var(--agf-border);
    padding: 10px 20px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #666;
    margin-left: 8px;
  }
  .sort select {
    font: inherit;
    font-size: 12px;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fff;
    color: #333;
  }
  .narrow {
    background: var(--agf-surface);
    border-bottom: 1px solid var(--agf-border);
    padding: 8px 20px 10px;
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    font-size: 12px;
    color: #666;
  }
  .narrow .keyword {
    width: 240px;
  }
  .range {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .range :global(.agf-num) {
    width: 74px;
  }
  .refilter {
    border-bottom: 1px solid var(--agf-border);
    background: var(--agf-bg);
  }
  .tab {
    padding: 5px 16px;
    border: 1px solid #ddd;
    border-radius: 20px;
    background: #f8f8f8;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    color: #666;
  }
  .tab.active {
    background: var(--agf-accent);
    color: #fff;
    border-color: var(--agf-accent);
  }
  .tab:hover:not(.active) {
    background: #eee;
  }
  .bulk {
    margin-left: auto;
    font-size: 12px;
    color: #555;
  }
  .count {
    margin-left: auto;
    font-size: 11px;
    color: #aaa;
  }
  .main {
    padding: 20px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 20px;
    background: var(--agf-surface);
    border-bottom: 1px solid var(--agf-border);
  }
  .synced {
    font-size: 11px;
    color: var(--agf-muted);
  }
  .synced.bad {
    color: var(--agf-accent);
  }
  .orphans {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 20px;
    background: var(--agf-accent-soft);
    border-bottom: 1px solid var(--agf-border);
    font-size: 12px;
    color: #555;
  }
  .more {
    display: flex;
    justify-content: center;
    padding: 24px 0 4px;
  }
  .empty {
    color: var(--agf-muted);
    text-align: center;
    padding: 60px 0;
  }
</style>
