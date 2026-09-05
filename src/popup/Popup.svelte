<script lang="ts">
  import { countLabel } from '../lib/config';
  import { describeActiveFilters } from '../lib/evaluate';
  import { loadResults, loadSettings } from '../lib/storage';
  import type { ResultSet, Settings } from '../lib/types';

  let settings = $state<Settings | null>(null);
  let results = $state<ResultSet | null>(null);

  const activeFilters = $derived(settings ? describeActiveFilters(settings.filters) : []);

  loadSettings().then(loaded => (settings = loaded));
  loadResults().then(stored => (results = stored));

  function openOptions() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  function openResults() {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
    window.close();
  }
</script>

<div class="popup">
  <h1>🏗 土地フィルター</h1>
  <p class="lead">土地検索の結果ページを開くと、右上に操作パネルが表示されます。</p>

  <button type="button" class="agf-btn agf-btn-primary block" onclick={openOptions}>
    ⚙ フィルター設定を開く
  </button>
  <button
    type="button"
    class="agf-btn agf-btn-link block"
    disabled={!results}
    onclick={openResults}
  >
    📄 最新の結果を見る
  </button>

  <div class="info">
    {#if settings}
      <div class="info-line">
        <span class="key">合致件数</span>
        {settings.targetCount === 0 ? '全件' : `${countLabel(settings.targetCount)}まで`}
      </div>
    {/if}
    {#if results}
      <div class="info-line">
        <span class="key">前回の結果</span>
        合致 {results.passed}{results.requested > 0
          ? ` / ${results.requested}`
          : ''}（{results.inspected}件を確認）
      </div>
    {/if}
  </div>

  <div class="filters">
    <div class="filters-title">現在の条件</div>
    {#if !settings}
      <div class="faint">読み込み中…</div>
    {:else if activeFilters.length === 0}
      <div class="faint">有効な条件はありません（全件通過）</div>
    {:else}
      <ul>
        {#each activeFilters as filter (filter)}
          <li>{filter}</li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .popup {
    width: 260px;
    padding: 16px;
  }
  h1 {
    color: var(--agf-accent);
    font-size: 15px;
    margin: 0 0 10px;
  }
  .lead {
    margin: 0 0 12px;
    font-size: 12px;
    color: #666;
  }
  .block {
    display: block;
    width: 100%;
    margin-bottom: 8px;
    padding: 8px;
  }
  .info {
    margin-top: 4px;
    font-size: 12px;
  }
  .info-line {
    display: flex;
    gap: 8px;
    color: #555;
  }
  .key {
    color: var(--agf-faint);
    min-width: 72px;
  }
  .filters {
    border-top: 1px solid #eee;
    padding-top: 10px;
    margin-top: 10px;
  }
  .filters-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #999;
    margin-bottom: 6px;
  }
  .filters ul {
    margin: 0;
    padding-left: 16px;
  }
  .filters li {
    font-size: 11px;
    color: #666;
    line-height: 1.7;
    word-break: break-all;
  }
  .faint {
    font-size: 11px;
    color: #aaa;
  }
</style>
