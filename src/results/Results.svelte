<script lang="ts">
  import ResultsView from '../components/ResultsView.svelte';
  import { loadResults } from '../lib/storage';
  import type { ResultSet } from '../lib/types';

  let results = $state<ResultSet | null>(null);
  let loaded = $state(false);

  loadResults().then(stored => {
    results = stored;
    loaded = true;
  });
</script>

{#if !loaded}
  <p class="msg">読み込み中…</p>
{:else if results}
  <ResultsView {results} />
{:else}
  <p class="msg">
    まだ結果がありません。<br />
    athome.co.jp の土地検索結果ページでフィルターを実行してください。
  </p>
{/if}

<style>
  .msg {
    padding: 80px 20px;
    text-align: center;
    color: var(--agf-muted);
    line-height: 2;
  }
</style>
