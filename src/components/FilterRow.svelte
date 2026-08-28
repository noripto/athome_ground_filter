<script lang="ts">
  import TagInput from './TagInput.svelte';
  import type {
    ExcludeTextState,
    FilterDef,
    FilterState,
    MinRoadWidthState,
    NumericRangeState,
    RequireContainsState
  } from '../lib/types';

  interface Props {
    def: FilterDef;
    state: FilterState;
  }

  let { def, state = $bindable() }: Props = $props();

  // Number inputs bind to strings so an empty box means "no bound" rather than 0.
  function toNumber(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? n : null;
  }
</script>

<div class="row" class:off={!state.enabled}>
  <label class="toggle">
    <input type="checkbox" bind:checked={state.enabled} />
    <span>{def.label}</span>
  </label>

  <div class="body">
    {#if def.type === 'exclude_text'}
      <TagInput bind:values={(state as ExcludeTextState).values} hints={def.hints} />
      <span class="note">これらを含む物件を除外</span>
    {:else if def.type === 'min_road_width'}
      <input
        class="agf-num"
        type="number"
        min="0"
        step="0.5"
        value={(state as MinRoadWidthState).minWidth}
        oninput={e =>
          ((state as MinRoadWidthState).minWidth =
            toNumber((e.currentTarget as HTMLInputElement).value) ?? def.defaultMinWidth)}
      />
      <span class="agf-unit">{def.unit} 以下を除外</span>
    {:else if def.type === 'require_contains'}
      <input
        class="agf-text"
        type="text"
        bind:value={(state as RequireContainsState).required}
        placeholder={def.defaultRequired}
      />
      <span class="note">この文字列を含まない物件を除外</span>
    {:else if def.type === 'numeric_range'}
      <span class="agf-unit">最小</span>
      <input
        class="agf-num"
        type="number"
        placeholder="なし"
        value={(state as NumericRangeState).min ?? ''}
        oninput={e =>
          ((state as NumericRangeState).min = toNumber(
            (e.currentTarget as HTMLInputElement).value
          ))}
      />
      <span class="agf-unit">{def.unit}</span>
      <span class="agf-unit">最大</span>
      <input
        class="agf-num"
        type="number"
        placeholder="なし"
        value={(state as NumericRangeState).max ?? ''}
        oninput={e =>
          ((state as NumericRangeState).max = toNumber(
            (e.currentTarget as HTMLInputElement).value
          ))}
      />
      <span class="agf-unit">{def.unit}</span>
    {/if}

    {#if def.help}
      <div class="help">{def.help}</div>
    {/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: flex-start;
    background: var(--agf-surface);
    border: 1px solid var(--agf-border);
    border-radius: var(--agf-radius);
    padding: 11px 14px;
    margin-bottom: 6px;
    gap: 14px;
    transition: opacity 0.2s;
  }
  .row.off {
    opacity: 0.55;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    min-width: 132px;
    font-weight: 600;
    font-size: 13px;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .toggle input {
    accent-color: var(--agf-accent);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .note,
  .help {
    font-size: 11px;
    color: #aaa;
  }
  .help {
    width: 100%;
  }
  .agf-text {
    padding: 5px 8px;
    border: 1px solid #ccc;
    border-radius: 5px;
    font: inherit;
    font-size: 13px;
    width: 120px;
  }
</style>
