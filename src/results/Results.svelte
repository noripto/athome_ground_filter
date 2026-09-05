<script lang="ts">
  import ResultsView from '../components/ResultsView.svelte';
  import RunPanel from './RunPanel.svelte';
  import { describeActiveFilters } from '../lib/evaluate';
  import { inspectLimitFor, runFilter, type RunProgress, type RunTallies } from '../lib/run';
  import { loadResults, loadSettings, saveResults } from '../lib/storage';
  import type { PropertyResult, ResultSet, Settings } from '../lib/types';

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

  const SNAPSHOT_MS = 500;
  const EMPTY_TALLIES: RunTallies = {
    inspected: 0,
    passed: 0,
    excluded: 0,
    failed: 0,
    skipped: 0,
    cached: 0,
    pagesCrawled: 0,
    totalCount: null,
    source: null
  };
  let pending: PropertyResult[] = [];
  let livePassed = $state<PropertyResult[]>([]);
  let liveTallies = $state<RunTallies | null>(null);
  let snapshots: ReturnType<typeof setInterval> | null = null;

  const liveResults = $derived.by<ResultSet | null>(() => {
    if (!settings) return null;
    const t = liveTallies ?? EMPTY_TALLIES;
    return {
      timestamp: Date.now(),
      searchUrl,
      requested: settings.targetCount,
      totalCount: t.totalCount,
      inspected: t.inspected,
      passed: t.passed,
      excluded: t.excluded,
      failed: t.failed,
      skipped: t.skipped,
      cached: t.cached,
      pagesCrawled: t.pagesCrawled,
      stoppedBy: 'complete',
      inspectLimit: inspectLimitFor(settings.targetCount),
      activeFilters: describeActiveFilters(settings.filters),
      source: t.source,
      properties: livePassed
    };
  });

  const shownResults = $derived(running ? liveResults : results);

  function snapshot() {
    if (pending.length === 0) return;
    livePassed = [...livePassed, ...pending];
    pending = [];
  }

  Promise.all([loadSettings(), loadResults()]).then(([loadedSettings, stored]) => {
    settings = loadedSettings;
    results = stored;
    loaded = true;
    if (searchUrl && autostart) run();
  });

  $effect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  async function run() {
    if (!settings || running || !searchUrl) return;

    const keepExcluded = settings.keepExcluded;

    running = true;
    error = '';
    progress = null;
    pending = [];
    livePassed = [];
    liveTallies = null;
    status = '検索結果を読み取り中…';
    controller = new AbortController();
    snapshots = setInterval(snapshot, SNAPSHOT_MS);

    try {
      const resultSet = await runFilter({
        searchUrl,
        settings: $state.snapshot(settings),
        signal: controller.signal,
        onProgress: next => {
          progress = next;
          status = next.message;
          liveTallies = next.tallies;
        },
        onProperty: property => {
          if (keepExcluded || property.passed) pending.push(property);
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
      if (snapshots !== null) clearInterval(snapshots);
      snapshots = null;
      snapshot();
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

  {#if shownResults}
    <ResultsView results={shownResults} live={running} />
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
