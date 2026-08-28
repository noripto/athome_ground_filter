<script lang="ts">
  import { DISPLAY_FIELDS } from '../lib/config';
  import { findField } from '../lib/evaluate';
  import type { PropertyResult } from '../lib/types';

  interface Props {
    property: PropertyResult;
    maxFields?: number;
  }

  let { property, maxFields = 9 }: Props = $props();

  const shownFields = $derived(
    DISPLAY_FIELDS.map(key => ({ key, value: findField(property.fields, key) }))
      .filter(entry => entry.value !== '')
      .slice(0, maxFields)
  );
</script>

<article class="card" class:ok={property.passed} class:ng={!property.passed}>
  <div class="top">
    <span class="price">{property.price || '価格不明'}</span>
    <span class="badge" class:ok={property.passed}>{property.passed ? '✓ 合致' : '✗ 除外'}</span>
  </div>

  {#if property.area}
    <div class="sub">{property.area}</div>
  {/if}
  {#if property.location || property.title}
    <div class="loc">{property.location || property.title}</div>
  {/if}
  {#if property.traffic}
    <div class="sub">{property.traffic}</div>
  {/if}

  {#if shownFields.length}
    <dl class="fields">
      {#each shownFields as field (field.key)}
        <div class="field">
          <dt>{field.key}</dt>
          <dd>{field.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if !property.passed && property.reasons.length}
    <div class="reasons">
      {#each property.reasons as reason (reason)}
        <div class="reason">✗ {reason}</div>
      {/each}
    </div>
  {/if}

  <a class="link" href={property.url} target="_blank" rel="noopener noreferrer">詳細を見る →</a>
</article>

<style>
  .card {
    background: var(--agf-surface);
    border: 1px solid var(--agf-border);
    border-left: 4px solid #ccc;
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    transition: box-shadow 0.15s;
  }
  .card:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }
  .card.ok {
    border-left-color: var(--agf-ok);
  }
  .card.ng {
    border-left-color: var(--agf-accent);
    opacity: 0.88;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .price {
    font-size: 21px;
    font-weight: 700;
    color: var(--agf-accent);
  }
  .badge {
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
    background: var(--agf-accent-soft);
    color: var(--agf-accent);
  }
  .badge.ok {
    background: var(--agf-ok-soft);
    color: var(--agf-ok);
  }
  .sub {
    font-size: 12px;
    color: var(--agf-muted);
  }
  .loc {
    font-size: 13px;
  }
  .fields {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid #f0f0f0;
    font-size: 11px;
    color: #777;
  }
  .field {
    display: flex;
    gap: 6px;
    margin-bottom: 2px;
  }
  .field dt {
    color: var(--agf-faint);
    min-width: 74px;
    flex-shrink: 0;
  }
  .field dd {
    margin: 0;
  }
  .reasons {
    background: var(--agf-accent-soft);
    border-radius: 6px;
    padding: 6px 10px;
    margin-top: 4px;
  }
  .reason {
    font-size: 11px;
    color: var(--agf-accent);
    font-weight: 600;
  }
  .link {
    display: block;
    margin-top: 10px;
    padding: 7px 12px;
    background: var(--agf-link);
    color: #fff;
    text-decoration: none;
    border-radius: 6px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
  }
  .link:hover {
    background: var(--agf-link-dark);
  }
</style>
