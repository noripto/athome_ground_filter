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
  import type { FilterSettings, ResultSet, Settings } from '../lib/types';

  type Tab = 'ok' | 'ng' | 'all';

  interface Props {
    results: ResultSet;
    /** Rendered when the view lives in a dismissable overlay. */
    onclose?: () => void;
  }

  let { results, onclose }: Props = $props();

  let tab = $state<Tab>('ok');
  let sortIndex = $state(0);
  let refilterOpen = $state(false);
  let view = $state<ViewFilter>(emptyViewFilter());

  /**
   * Conditions the user has changed since the run. `evaluate` only ever read a
   * field map and those were all kept, so re-judging every property costs a
   * pass over an array and nothing else — no crawling, no waiting.
   */
  let liveFilters = $state<FilterSettings | null>(null);

  const judged = $derived(
    liveFilters ? refilter(results.properties, liveFilters) : results.properties
  );

  const byTab = $derived(
    tab === 'ok'
      ? judged.filter(p => p.passed)
      : tab === 'ng'
        ? judged.filter(p => !p.passed)
        : judged
  );

  const visible = $derived(sortProperties(applyViewFilter(byTab, view), SORT_OPTIONS[sortIndex]));

  const narrowed = $derived(isViewFilterActive(view) || liveFilters !== null);
  const passedNow = $derived(judged.filter(p => p.passed).length);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ok', label: '合致のみ' },
    { id: 'ng', label: '除外のみ' },
    { id: 'all', label: '全件' }
  ];

  function applyFilters(next: Settings) {
    liveFilters = next.filters;
    refilterOpen = false;
  }

  function resetView() {
    view = emptyViewFilter();
    liveFilters = null;
  }

  const crawledAt = $derived(new Date(results.timestamp).toLocaleString('ja-JP'));

  // Only worth saying something when the run ended somewhere other than where
  // it meant to. Anything but 'target' and 'complete' is worth explaining, and
  // several of these used to be reported as「検索結果が尽きました」.
  const stopNote = $derived.by(() => {
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
      <h1>🏗 土地フィルター 結果</h1>
      <div class="stats">
        <span class="stat ok">
          ✓ 合致 {results.passed}{results.requested > 0 ? ` / 指定 ${results.requested}` : ''}件
        </span>
        <span class="stat ng">✗ 除外 {results.excluded}件</span>
        {#if results.failed}
          <span class="stat">取得失敗 {results.failed}件</span>
        {/if}
        <span class="stat">確認 {results.inspected}件 / {results.pagesCrawled}ページ</span>
        <!-- Both are work the run did not have to do, which is the point. -->
        {#if results.skipped}
          <span class="stat">一覧で除外 {results.skipped}件（詳細取得なし）</span>
        {/if}
        {#if results.cached}
          <span class="stat">キャッシュ {results.cached}件</span>
        {/if}
        <!-- Loose check: results stored before this field existed have none. -->
        {#if results.totalCount != null}
          <span class="stat">検索該当 {results.totalCount.toLocaleString('ja-JP')}件</span>
        {/if}
      </div>
      {#if stopNote}
        <div class="meta warn">{stopNote}</div>
      {/if}
      <div class="meta">取得日時: {crawledAt}</div>
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

  <!--
    Everything below works over results already in hand: no request is made,
    however the conditions are changed.
  -->
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

    <span class="count">
      {visible.length}件表示{narrowed ? `（合致 ${passedNow}件）` : ''}
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
      <button type="button" class="agf-btn agf-btn-ghost" onclick={resetView}>条件をリセット</button
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

  <div class="main">
    {#if visible.length === 0}
      <p class="empty">該当する物件がありません。</p>
    {:else}
      <div class="grid">
        {#each visible as property (property.url)}
          <ResultCard {property} />
        {/each}
      </div>
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
  .empty {
    color: var(--agf-muted);
    text-align: center;
    padding: 60px 0;
  }
</style>
