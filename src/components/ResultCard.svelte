<script lang="ts">
  import { DISPLAY_FIELDS } from '../lib/config';
  import { findField } from '../lib/evaluate';
  import type { PropertyResult } from '../lib/types';

  interface Props {
    property: PropertyResult;
    maxFields?: number;
    /** Omitted where starring makes no sense, which hides the button. */
    onfavorite?: () => void;
    favorited?: boolean;
    /** The registration is in flight, so the button should not fire twice. */
    busy?: boolean;
    /** Why athome refused this one, when it did. */
    note?: string;
  }

  let {
    property,
    maxFields = 9,
    onfavorite,
    favorited = false,
    busy = false,
    note = ''
  }: Props = $props();

  const shownFields = $derived(
    DISPLAY_FIELDS.map(key => ({ key, value: findField(property.fields, key) }))
      .filter(entry => entry.value !== '')
      .slice(0, maxFields)
  );

  // The name falls back to the address, so only repeat it when it adds something.
  const showLocation = $derived(property.location !== '' && property.location !== property.name);
</script>

<article class="card" class:ok={property.passed} class:ng={!property.passed}>
  <div class="top">
    <h3 class="name">{property.name || '物件名不明'}</h3>
    {#if onfavorite}
      <button
        type="button"
        class="star"
        class:on={favorited}
        disabled={busy}
        title={favorited ? 'お気に入りから外す' : 'お気に入りに入れて検索結果から外す'}
        aria-pressed={favorited}
        onclick={onfavorite}>{busy ? '…' : favorited ? '★' : '☆'}</button
      >
    {/if}
    <span class="badge" class:ok={property.passed}>{property.passed ? '✓ 合致' : '✗ 除外'}</span>
  </div>
  {#if note}
    <div class="note">{note}</div>
  {/if}

  <dl class="headline">
    <div class="line">
      <dt>価格</dt>
      <dd class="price">{property.price || '価格不明'}</dd>
    </div>
    {#if property.area}
      <div class="line">
        <dt>土地面積</dt>
        <dd>{property.area}</dd>
      </div>
    {/if}
  </dl>

  {#if showLocation}
    <div class="loc">{property.location}</div>
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
  .name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.5;
    color: var(--agf-text);
    word-break: break-word;
  }
  .star {
    border: none;
    background: none;
    cursor: pointer;
    padding: 0 2px;
    font-size: 19px;
    line-height: 1;
    color: var(--agf-faint);
    flex-shrink: 0;
  }
  .star.on {
    color: #e8a317;
  }
  .star:hover:not(:disabled) {
    color: #e8a317;
  }
  .star:disabled {
    cursor: progress;
  }
  .note {
    font-size: 11px;
    color: var(--agf-accent);
    line-height: 1.6;
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
  .headline {
    margin: 4px 0 2px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .headline .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .headline dt {
    color: var(--agf-faint);
    font-size: 11px;
    min-width: 52px;
    flex-shrink: 0;
  }
  .headline dd {
    margin: 0;
    font-size: 13px;
    color: var(--agf-text);
  }
  .price {
    font-size: 20px;
    font-weight: 700;
    color: var(--agf-accent);
    line-height: 1.3;
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
