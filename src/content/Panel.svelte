<script lang="ts">
  import FilterEditor from '../components/FilterEditor.svelte';
  import ResultsView from '../components/ResultsView.svelte';
  import { COUNT_PRESETS } from '../lib/config';
  import { AbortedError, extractDetailLinks } from '../lib/crawler';
  import { runFilter, type RunProgress } from '../lib/run';
  import { loadSettings, onSettingsChanged, saveResults, saveSettings } from '../lib/storage';
  import type { ResultSet, Settings } from '../lib/types';

  type Overlay = 'none' | 'settings' | 'results';

  let settings = $state<Settings | null>(null);
  let overlay = $state<Overlay>('none');
  let collapsed = $state(false);
  let running = $state(false);
  let status = $state('');
  let error = $state('');
  let progress = $state<RunProgress | null>(null);
  let results = $state<ResultSet | null>(null);
  let controller: AbortController | null = null;

  const percent = $derived(
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  );

  loadSettings().then(loaded => {
    settings = loaded;
  });

  // Keep the panel in sync when the options page saves a change.
  $effect(() => onSettingsChanged(next => (settings = next)));

  async function setTargetCount(value: number) {
    if (!settings) return;
    settings.targetCount = value;
    await saveSettings($state.snapshot(settings));
  }

  async function run() {
    if (!settings || running) return;

    running = true;
    error = '';
    results = null;
    progress = null;
    status = '検索結果を読み取り中…';
    controller = new AbortController();

    try {
      const resultSet = await runFilter({
        searchUrl: window.location.href,
        settings: $state.snapshot(settings),
        seedLinks: extractDetailLinks(document, window.location.href),
        signal: controller.signal,
        onProgress: next => {
          progress = next;
          status = next.message;
        }
      });

      results = resultSet;
      await saveResults(resultSet);
      status = `完了 — 合致 ${resultSet.passed}件（${resultSet.inspected}件を確認）`;
      overlay = 'results';
    } catch (err) {
      progress = null;
      if (err instanceof AbortedError) {
        status = '中断しました';
      } else {
        status = '';
        error = err instanceof Error ? err.message : String(err);
        console.error('[AGF]', err);
      }
    } finally {
      running = false;
      controller = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  function openInTab() {
    window.open(chrome.runtime.getURL('results.html'), '_blank', 'noopener');
  }
</script>

<div class="panel" class:collapsed>
  <div class="head">
    <button
      type="button"
      class="chevron"
      title={collapsed ? '開く' : '折りたたむ'}
      onclick={() => (collapsed = !collapsed)}>{collapsed ? '▸' : '▾'}</button
    >
    <span class="title">🏗 土地フィルター</span>
    <button type="button" class="gear" title="設定" onclick={() => (overlay = 'settings')}>⚙</button
    >
  </div>

  {#if !collapsed}
    {#if !settings}
      <p class="loading">読み込み中…</p>
    {:else}
      <div class="count" title="除外された物件はこの件数に含まれません">合致件数</div>
      <div class="presets">
        {#each COUNT_PRESETS as preset (preset)}
          <button
            type="button"
            class="preset"
            class:active={settings.targetCount === preset}
            disabled={running}
            onclick={() => setTargetCount(preset)}>{preset}</button
          >
        {/each}
      </div>

      {#if running}
        <button type="button" class="run cancel" onclick={cancel}>中断する</button>
      {:else}
        <button type="button" class="run" onclick={run}>フィルター実行</button>
      {/if}

      {#if progress}
        <div class="bar"><div class="fill" style:width="{percent}%"></div></div>
      {/if}

      {#if status}
        <div class="status">{status}</div>
      {/if}
      {#if error}
        <div class="error">エラー: {error}</div>
      {/if}

      {#if results}
        <div class="summary">
          <span class="ok">✓ 合致 {results.passed} / {results.requested}件</span>
          <span class="ng">✗ 除外 {results.excluded}件</span>
          {#if results.failed}<span class="faint">失敗 {results.failed}件</span>{/if}
        </div>
        <button type="button" class="secondary" onclick={() => (overlay = 'results')}>
          📄 結果を表示
        </button>
        <button type="button" class="secondary ghost" onclick={openInTab}>
          ↗ 新しいタブで開く
        </button>
      {/if}
    {/if}
  {/if}
</div>

{#if overlay === 'settings'}
  <div class="overlay">
    <FilterEditor onclose={() => (overlay = 'none')} />
  </div>
{:else if overlay === 'results' && results}
  <div class="overlay">
    <ResultsView {results} onclose={() => (overlay = 'none')} />
  </div>
{/if}

<style>
  .panel {
    position: fixed;
    top: 70px;
    right: 12px;
    z-index: 2147483647;
    width: 236px;
    background: var(--agf-surface);
    border: 2px solid var(--agf-accent);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    font: var(--agf-font);
    color: var(--agf-text);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .panel.collapsed .head {
    margin-bottom: 0;
  }
  .title {
    font-weight: 700;
    color: var(--agf-accent);
    font-size: 14px;
    flex: 1;
  }
  .chevron,
  .gear {
    background: none;
    border: none;
    cursor: pointer;
    color: #999;
    padding: 0;
    line-height: 1;
    font-size: 15px;
  }
  .gear {
    font-size: 17px;
  }
  .chevron:hover,
  .gear:hover {
    color: #333;
  }
  .loading {
    margin: 0;
    font-size: 12px;
    color: var(--agf-muted);
  }
  .count {
    font-size: 12px;
    color: #666;
    margin-bottom: 5px;
  }
  .presets {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }
  .preset {
    flex: 1;
    padding: 3px 0;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #f8f8f8;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    color: #333;
  }
  .preset.active {
    background: var(--agf-accent);
    color: #fff;
    border-color: var(--agf-accent);
  }
  .preset:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .run {
    width: 100%;
    padding: 8px;
    background: var(--agf-accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }
  .run:hover {
    background: var(--agf-accent-dark);
  }
  .run.cancel {
    background: #777;
  }
  .run.cancel:hover {
    background: #555;
  }
  .bar {
    width: 100%;
    height: 4px;
    background: #eee;
    border-radius: 2px;
    margin: 8px 0 4px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--agf-accent);
    transition: width 0.3s;
  }
  .status {
    font-size: 11px;
    color: var(--agf-muted);
    margin-top: 6px;
    min-height: 16px;
  }
  .error {
    font-size: 11px;
    color: var(--agf-accent);
    font-weight: 600;
    margin-top: 4px;
  }
  .summary {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
    margin: 6px 0;
  }
  .summary .ok {
    color: var(--agf-ok);
    font-weight: 700;
  }
  .summary .ng {
    color: var(--agf-accent);
    font-weight: 700;
  }
  .summary .faint {
    color: #aaa;
  }
  .secondary {
    display: block;
    width: 100%;
    padding: 6px;
    margin-top: 6px;
    background: var(--agf-link);
    color: #fff;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .secondary:hover {
    background: var(--agf-link-dark);
  }
  .secondary.ghost {
    background: #ecf0f1;
    color: #555;
  }
  .secondary.ghost:hover {
    background: #dde4e6;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    overflow-y: auto;
    background: var(--agf-bg);
    font: var(--agf-font);
    color: var(--agf-text);
  }
</style>
