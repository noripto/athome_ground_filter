<script lang="ts">
  import { countLabel } from '../lib/config';
  import { describeActiveFilters } from '../lib/evaluate';
  import type { RunProgress } from '../lib/run';
  import type { Settings } from '../lib/types';

  interface Props {
    searchUrl: string;
    settings: Settings;
    running: boolean;
    progress: RunProgress | null;
    status: string;
    error: string;
    onstart: () => void;
    oncancel: () => void;
  }

  let { searchUrl, settings, running, progress, status, error, onstart, oncancel }: Props =
    $props();

  const activeFilters = $derived(describeActiveFilters(settings.filters));

  // A「全件」run has no goal to measure against, so it reports a count rather
  // than a proportion and shows no bar.
  const percent = $derived(
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null
  );
</script>

<section class="run">
  <div class="row">
    <div class="what">
      <div class="label">取得対象</div>
      <a class="url" href={searchUrl} target="_blank" rel="noopener noreferrer">{searchUrl}</a>
      <div class="meta">
        取得件数: {countLabel(settings.targetCount)} ／ 取得間隔: {settings.requestDelayMs}ms
      </div>
      <div class="meta">
        条件: {activeFilters.length ? activeFilters.join(' ／ ') : 'なし（全件通過）'}
      </div>
    </div>
    {#if running}
      <button type="button" class="agf-btn agf-btn-ghost" onclick={oncancel}>■ 中断する</button>
    {:else}
      <button type="button" class="agf-btn agf-btn-save" onclick={onstart}>🚀 取得を開始</button>
    {/if}
  </div>

  {#if percent !== null}
    <div class="bar"><div class="fill" style:width="{percent}%"></div></div>
  {:else if running}
    <div class="bar indeterminate"><div class="fill"></div></div>
  {/if}

  {#if status}
    <div class="status">{status}</div>
  {/if}
  {#if error}
    <div class="error">エラー: {error}</div>
  {/if}
</section>

<style>
  .run {
    background: var(--agf-surface);
    border-bottom: 1px solid var(--agf-border);
    padding: 14px 20px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .what {
    min-width: 0;
    flex: 1;
  }
  .label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #999;
    margin-bottom: 4px;
  }
  .url {
    display: block;
    font-size: 12px;
    color: var(--agf-link);
    word-break: break-all;
    margin-bottom: 4px;
  }
  .meta {
    font-size: 11px;
    color: var(--agf-muted);
    line-height: 1.7;
    word-break: break-all;
  }
  .bar {
    width: 100%;
    height: 5px;
    background: #eee;
    border-radius: 3px;
    margin-top: 12px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--agf-accent);
    transition: width 0.3s;
  }
  .bar.indeterminate .fill {
    width: 35%;
    animation: slide 1.4s ease-in-out infinite;
  }
  @keyframes slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(300%);
    }
  }
  .status {
    font-size: 12px;
    color: #555;
    margin-top: 8px;
    min-height: 18px;
  }
  .error {
    font-size: 12px;
    color: var(--agf-accent);
    font-weight: 600;
    margin-top: 4px;
  }
</style>
