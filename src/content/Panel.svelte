<script lang="ts">
  import FilterEditor from '../components/FilterEditor.svelte';
  import { COUNT_PRESETS, countLabel } from '../lib/config';
  import { describeActiveFilters } from '../lib/evaluate';
  import { loadSettings, onSettingsChanged, saveSettings } from '../lib/storage';
  import type { Settings } from '../lib/types';

  let settings = $state<Settings | null>(null);
  let showSettings = $state(false);
  let collapsed = $state(false);

  const activeFilters = $derived(settings ? describeActiveFilters(settings.filters) : []);

  const hitCount = $derived.by(() => {
    const text = document.querySelector('.area-top__property--number')?.textContent ?? '';
    const count = Number.parseInt(text.replace(/,/g, ''), 10);
    return Number.isFinite(count) ? count : null;
  });

  loadSettings().then(loaded => {
    settings = loaded;
  });

  $effect(() => onSettingsChanged(next => (settings = next)));

  async function setTargetCount(value: number) {
    if (!settings) return;
    settings.targetCount = value;
    await saveSettings($state.snapshot(settings));
  }

  function start() {
    const url = new URL(chrome.runtime.getURL('results.html'));
    url.searchParams.set('search', window.location.href);
    url.searchParams.set('autostart', '1');
    window.open(url.toString(), '_blank', 'noopener');
  }

  function openResults() {
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
    <button type="button" class="gear" title="設定" onclick={() => (showSettings = true)}>⚙</button>
  </div>

  {#if !collapsed}
    {#if !settings}
      <p class="loading">読み込み中…</p>
    {:else}
      {#if hitCount !== null}
        <div class="hits">この検索の該当物件数 <b>{hitCount.toLocaleString('ja-JP')}</b> 件</div>
      {/if}

      <div class="count" title="除外された物件はこの件数に含まれません">合致件数</div>
      <div class="presets">
        {#each COUNT_PRESETS as preset (preset)}
          <button
            type="button"
            class="preset"
            class:active={settings.targetCount === preset}
            onclick={() => setTargetCount(preset)}>{countLabel(preset)}</button
          >
        {/each}
      </div>

      <button type="button" class="run" onclick={start}>🚀 取得を開始</button>
      <div class="note">別タブで実行します。このページを閉じても取得は続きます。</div>

      {#if activeFilters.length}
        <div class="filters">条件: {activeFilters.join(' ／ ')}</div>
      {:else}
        <div class="filters warn">⚠ 有効な条件がありません（全件通過）</div>
      {/if}

      <button type="button" class="secondary ghost" onclick={openResults}>
        📄 前回の結果を開く
      </button>
    {/if}
  {/if}
</div>

{#if showSettings}
  <div class="overlay">
    <FilterEditor onclose={() => (showSettings = false)} />
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
  .hits {
    font-size: 12px;
    color: #555;
    background: #f4f6f7;
    border-radius: 5px;
    padding: 5px 8px;
    margin-bottom: 8px;
  }
  .hits b {
    color: var(--agf-accent);
    font-size: 14px;
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
  .note {
    font-size: 10px;
    color: #aaa;
    line-height: 1.6;
    margin-top: 5px;
  }
  .filters {
    font-size: 10px;
    color: var(--agf-muted);
    line-height: 1.6;
    margin-top: 8px;
    word-break: break-all;
  }
  .filters.warn {
    color: var(--agf-accent);
  }
  .secondary {
    display: block;
    width: 100%;
    padding: 6px;
    margin-top: 8px;
    background: var(--agf-link);
    color: #fff;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
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
