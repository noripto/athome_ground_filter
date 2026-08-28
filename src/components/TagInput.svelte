<script lang="ts">
  interface Props {
    values: string[];
    hints?: string[];
    placeholder?: string;
  }

  let { values = $bindable(), hints = [], placeholder = '値を入力して追加' }: Props = $props();

  let draft = $state('');

  function add(value: string) {
    const trimmed = value.trim();
    if (!trimmed || values.includes(trimmed)) {
      draft = '';
      return;
    }
    values = [...values, trimmed];
    draft = '';
  }

  function remove(value: string) {
    values = values.filter(v => v !== value);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add(draft);
  }
</script>

<div class="wrap">
  <div class="row">
    {#each values as value (value)}
      <span class="tag">
        {value}
        <button type="button" class="tag-x" title="削除" onclick={() => remove(value)}>×</button>
      </span>
    {/each}
    <input
      type="text"
      class="tag-input"
      bind:value={draft}
      {placeholder}
      onkeydown={onKeydown}
      onblur={() => add(draft)}
    />
    <button type="button" class="add" onclick={() => add(draft)}>追加</button>
  </div>

  {#if hints.length}
    <div class="hints">
      <span class="hints-label">例:</span>
      {#each hints as hint (hint)}
        <button
          type="button"
          class="hint"
          class:used={values.includes(hint)}
          onclick={() => add(hint)}>{hint}</button
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: var(--agf-accent);
    color: #fff;
    padding: 2px 6px 2px 10px;
    border-radius: 20px;
    font-size: 12px;
  }
  .tag-x {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }
  .tag-x:hover {
    color: #fff;
  }
  .tag-input {
    padding: 4px 10px;
    border: 1px solid #ccc;
    border-radius: 5px;
    font: inherit;
    font-size: 12px;
    width: 140px;
  }
  .add {
    padding: 4px 12px;
    background: #eee;
    border: 1px solid #ccc;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
  }
  .add:hover {
    background: #e0e0e0;
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .hints-label {
    font-size: 11px;
    color: #aaa;
  }
  .hint {
    padding: 2px 9px;
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 20px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    color: #666;
  }
  .hint:hover {
    background: #ffe8e6;
    border-color: var(--agf-accent);
    color: var(--agf-accent);
  }
  .hint.used {
    opacity: 0.35;
  }
</style>
