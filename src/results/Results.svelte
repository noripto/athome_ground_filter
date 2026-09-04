<script lang="ts">
  import ResultsView from '../components/ResultsView.svelte';
  import RunPanel from './RunPanel.svelte';
  import { runFilter, type RunProgress } from '../lib/run';
  import { loadResults, loadSettings, saveResults } from '../lib/storage';
  import type { ResultSet, Settings } from '../lib/types';

  /**
   * The crawl lives here rather than in the content script. This tab outlives
   * whatever the user does on athome.co.jp, which a run of thousands of
   * requests needs; the search it should walk arrives in the URL, so a reload
   * picks up exactly where a fresh start would.
   */
  const params = new URLSearchParams(window.location.search);
  const searchUrl = params.get('search') ?? '';
  const autostart = params.get('autostart') === '1';

  let settings = $state<Settings | null>(null);
  let results = $state<ResultSet | null>(null);
  let loaded = $state(false);
  let running = $state(false);
  let progress = $state<RunProgress | null>(null);
  let status = $state('');
  let error = $state('');
  let controller: AbortController | null = null;

  Promise.all([loadSettings(), loadResults()]).then(([loadedSettings, stored]) => {
    settings = loadedSettings;
    results = stored;
    loaded = true;
    if (searchUrl && autostart) run();
  });

  // Closing the tab mid-run loses everything read so far, which for a whole
  // search is a lot of somebody else's bandwidth as well as the user's time.
  $effect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  async function run() {
    if (!settings || running || !searchUrl) return;

    running = true;
    error = '';
    results = null;
    progress = null;
    status = '検索結果を読み取り中…';
    controller = new AbortController();

    try {
      const resultSet = await runFilter({
        searchUrl,
        settings: $state.snapshot(settings),
        signal: controller.signal,
        onProgress: next => {
          progress = next;
          status = next.message;
        }
      });

      results = resultSet;
      await saveResults(resultSet);
      status = resultSet.stoppedBy === 'aborted' ? '中断しました' : status;
    } catch (err) {
      progress = null;
      status = '';
      error = err instanceof Error ? err.message : String(err);
      console.error('[AGF]', err);
    } finally {
      running = false;
      controller = null;
    }
  }

  function cancel() {
    controller?.abort();
    status = '中断しています…';
  }
</script>

{#if !loaded}
  <p class="msg">読み込み中…</p>
{:else}
  {#if searchUrl && settings}
    <RunPanel
      {searchUrl}
      {settings}
      {running}
      {progress}
      {status}
      {error}
      onstart={run}
      oncancel={cancel}
    />
  {/if}

  {#if results}
    <ResultsView {results} />
  {:else if !searchUrl}
    <p class="msg">
      まだ結果がありません。<br />
      athome.co.jp の土地検索結果ページでフィルターを実行してください。
    </p>
  {:else if !running}
    <p class="msg">「取得を開始」を押すと、この検索の結果を読み取ります。</p>
  {/if}
{/if}

<style>
  .msg {
    padding: 80px 20px;
    text-align: center;
    color: var(--agf-muted);
    line-height: 2;
  }
</style>
