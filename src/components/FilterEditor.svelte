<script lang="ts">
  import FilterRow from './FilterRow.svelte';
  import {
    COUNT_PRESETS,
    FILTER_DEFS,
    MIN_REQUEST_DELAY_MS,
    SECTIONS,
    countLabel,
    getFilterDef
  } from '../lib/config';
  import { clearCache, countDetails } from '../lib/db';
  import { describeActiveFilters } from '../lib/evaluate';
  import { inspectLimitFor } from '../lib/run';
  import { loadSettings, resetSettings, saveSettings } from '../lib/storage';
  import type { Settings } from '../lib/types';

  interface Props {
    title?: string;
    onclose?: () => void;
    onapply?: (settings: Settings) => void;
  }

  let { title = '⚙ 土地フィルター 設定', onclose, onapply }: Props = $props();

  let settings = $state<Settings | null>(null);
  let cachedCount = $state<number | null>(null);
  let notice = $state('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const ownsCache = window.location.protocol === 'chrome-extension:';

  function refreshCacheCount() {
    if (!ownsCache) return;
    countDetails().then(
      count => (cachedCount = count),
      () => (cachedCount = null)
    );
  }

  refreshCacheCount();

  async function dropCache() {
    if (!confirm('保存済みの詳細ページをすべて削除しますか？\n次回の取得は全件を読み直します。'))
      return;
    await clearCache();
    refreshCacheCount();
    flash('✓ キャッシュを削除しました');
  }

  const activeSummary = $derived(settings ? describeActiveFilters(settings.filters) : []);
  const inspectLimit = $derived(inspectLimitFor(settings?.targetCount ?? 0));

  loadSettings().then(loaded => {
    settings = loaded;
  });

  function flash(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 3000);
  }

  async function save() {
    if (!settings) return;
    const saved = $state.snapshot(settings);
    await saveSettings(saved);
    const active = activeSummary.length;
    flash(`✓ 保存しました（有効な条件: ${active ? `${active}件` : 'なし'}）`);
    onapply?.(saved);
  }

  async function reset() {
    if (!confirm('すべての設定をデフォルトに戻しますか？')) return;
    settings = await resetSettings();
    flash('✓ デフォルトに戻しました');
  }
</script>

<div class="editor">
  <header class="bar">
    <h2>{title}</h2>
    <div class="actions">
      <button type="button" class="agf-btn agf-btn-ghost" onclick={reset}>デフォルトに戻す</button>
      <button type="button" class="agf-btn agf-btn-save" onclick={save}>保存</button>
      {#if onclose}
        <button type="button" class="agf-btn agf-btn-ghost" onclick={onclose}>× 閉じる</button>
      {/if}
    </div>
  </header>

  {#if notice}
    <div class="notice">{notice}</div>
  {/if}

  {#if !settings}
    <p class="loading">読み込み中…</p>
  {:else}
    <div class="body">
      <div class="section-title">クロール設定</div>

      <div class="crawl">
        <span class="crawl-label">合致件数</span>
        <div class="presets">
          {#each COUNT_PRESETS as preset (preset)}
            <button
              type="button"
              class="preset"
              class:active={settings.targetCount === preset}
              onclick={() => settings && (settings.targetCount = preset)}
              >{countLabel(preset)}</button
            >
          {/each}
        </div>
        <div class="crawl-help">
          {#if settings.targetCount === 0}
            検索結果を最後のページまで辿ります。除外された物件も含め、詳細ページを
            {inspectLimit} 件確認した時点で打ち切ります。
          {:else}
            条件に合致した物件がこの件数に達するまでページを辿ります。除外された物件は件数に含まれません。
            合致が集まらない場合は、詳細ページを {inspectLimit} 件確認した時点で打ち切ります。
          {/if}
        </div>
      </div>

      <div class="crawl">
        <label class="crawl-label" for="agf-delay">リクエスト間隔</label>
        <input
          id="agf-delay"
          class="agf-num"
          type="number"
          min={MIN_REQUEST_DELAY_MS}
          max="5000"
          step="100"
          bind:value={settings.requestDelayMs}
        />
        <span class="agf-unit">
          ms — 短くすると athome のアクセス制限に掛かりやすくなります（{MIN_REQUEST_DELAY_MS} 以上）
        </span>
      </div>

      <div class="crawl">
        <label class="crawl-label" for="agf-cache-age">詳細キャッシュの有効期間</label>
        <input
          id="agf-cache-age"
          class="agf-num"
          type="number"
          min="0"
          max="365"
          step="1"
          bind:value={settings.detailMaxAgeDays}
        />
        <span class="agf-unit">日</span>
        <div class="crawl-help">
          一度読んだ詳細ページはこの期間だけ再利用し、2回目以降の取得では新着物件だけを読みます。
          価格や掲載終了は一覧ページから毎回読み直すので、この値を長くしても最新のままです。 0
          にすると毎回すべて取得し直します。
        </div>
      </div>

      {#if ownsCache}
        <div class="crawl">
          <span class="crawl-label">保存済みの詳細</span>
          <span class="agf-unit">{cachedCount === null ? '確認中…' : `${cachedCount}件`}</span>
          <button type="button" class="agf-btn agf-btn-secondary" onclick={dropCache}>
            キャッシュを削除
          </button>
        </div>
      {/if}

      <div class="crawl">
        <label class="crawl-check">
          <input type="checkbox" bind:checked={settings.keepExcluded} />
          除外された物件も結果に残す（除外理由つき）
        </label>
      </div>

      {#each SECTIONS as section (section.title)}
        <div class="section-title">{section.title}</div>
        {#each section.ids as id (id)}
          {@const def = getFilterDef(id)}
          {#if def && settings.filters[id]}
            <FilterRow {def} bind:state={settings.filters[id]} />
          {/if}
        {/each}
      {/each}

      <div class="summary">
        <strong>適用中の条件（{activeSummary.length} / {FILTER_DEFS.length}）:</strong>
        {activeSummary.length ? activeSummary.join(' ／ ') : 'なし（全件が通過します）'}
      </div>
    </div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .bar {
    background: var(--agf-accent);
    color: #fff;
    padding: 14px 20px;
    position: sticky;
    top: 0;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .bar h2 {
    margin: 0;
    font-size: 17px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .notice {
    background: var(--agf-ok-soft);
    border: 1px solid var(--agf-ok);
    color: var(--agf-ok);
    padding: 9px 16px;
    border-radius: 6px;
    font-weight: 600;
    margin: 14px auto 0;
    max-width: 840px;
    width: calc(100% - 40px);
  }
  .loading {
    padding: 24px 20px;
    color: var(--agf-muted);
  }
  .body {
    padding: 8px 20px 40px;
    max-width: 840px;
    width: 100%;
    margin: 0 auto;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #999;
    margin: 20px 0 8px;
    padding: 0 4px;
  }
  .crawl {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    background: var(--agf-surface);
    border: 1px solid var(--agf-border);
    border-radius: var(--agf-radius);
    padding: 11px 14px;
    margin-bottom: 6px;
  }
  .crawl-label {
    min-width: 132px;
    font-weight: 600;
    font-size: 13px;
  }
  .crawl-help {
    width: 100%;
    font-size: 11px;
    color: #aaa;
    line-height: 1.7;
  }
  .crawl-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }
  .crawl-check input {
    accent-color: var(--agf-accent);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .presets {
    display: flex;
    gap: 5px;
  }
  .preset {
    padding: 4px 12px;
    border: 1px solid #ccc;
    border-radius: 20px;
    background: #f8f8f8;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    color: #333;
  }
  .preset.active {
    background: var(--agf-accent);
    border-color: var(--agf-accent);
    color: #fff;
  }
  .summary {
    margin-top: 20px;
    padding: 12px 14px;
    background: var(--agf-surface);
    border: 1px dashed var(--agf-border);
    border-radius: var(--agf-radius);
    font-size: 12px;
    color: #666;
    line-height: 1.8;
  }
</style>
