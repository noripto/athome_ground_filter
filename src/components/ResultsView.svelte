<script lang="ts">
  import ResultCard from './ResultCard.svelte';
  import type { ResultSet } from '../lib/types';

  type Tab = 'ok' | 'ng' | 'all';

  interface Props {
    results: ResultSet;
    /** Rendered when the view lives in a dismissable overlay. */
    onclose?: () => void;
  }

  let { results, onclose }: Props = $props();

  let tab = $state<Tab>('ok');

  const visible = $derived(
    tab === 'ok'
      ? results.properties.filter(p => p.passed)
      : tab === 'ng'
        ? results.properties.filter(p => !p.passed)
        : results.properties
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ok', label: '合致のみ' },
    { id: 'ng', label: '除外のみ' },
    { id: 'all', label: '全件' }
  ];

  const crawledAt = $derived(new Date(results.timestamp).toLocaleString('ja-JP'));

  // Only worth saying something when the run fell short of the requested count.
  const stopNote = $derived(
    results.stoppedBy === 'target'
      ? ''
      : results.stoppedBy === 'exhausted'
        ? `⚠ 指定の ${results.requested}件に届く前に検索結果が尽きました（検索条件を広げてください）`
        : `⚠ 確認件数の上限 ${results.inspectLimit}件に達したため中断しました（条件が厳しすぎる可能性があります）`
  );
</script>

<div class="view">
  <header class="head">
    <div class="head-main">
      <h1>🏗 土地フィルター 結果</h1>
      <div class="stats">
        <span class="stat ok">✓ 合致 {results.passed} / 指定 {results.requested}件</span>
        <span class="stat ng">✗ 除外 {results.excluded}件</span>
        {#if results.failed}
          <span class="stat">取得失敗 {results.failed}件</span>
        {/if}
        <span class="stat">確認 {results.inspected}件 / {results.pagesCrawled}ページ</span>
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

  <div class="controls">
    {#each tabs as entry (entry.id)}
      <button
        type="button"
        class="tab"
        class:active={tab === entry.id}
        onclick={() => (tab = entry.id)}>{entry.label}</button
      >
    {/each}
    <span class="count">{visible.length}件表示</span>
  </div>

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
