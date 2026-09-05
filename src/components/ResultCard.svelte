<script lang="ts">
  import { DISPLAY_FIELDS } from '../lib/config';
  import { findField, narrowestRoadWidth } from '../lib/evaluate';
  import type { PropertyResult } from '../lib/types';

  interface Props {
    property: PropertyResult;
    maxFields?: number;
    /** Omitted where starring makes no sense, which hides the button. */
    onfavorite?: () => void;
    favorited?: boolean;
    /** The registration is in flight, so the button should not fire twice. */
    busy?: boolean;
    /** False when the property number could not be read out of the URL. */
    favouritable?: boolean;
    /** Why athome refused this one, when it did. */
    note?: string;
    /** Set on a starred property, saying which side it was starred from. */
    origin?: 'extension' | 'athome';
  }

  let {
    property,
    maxFields = 9,
    onfavorite,
    favorited = false,
    busy = false,
    favouritable = true,
    note = '',
    origin = undefined
  }: Props = $props();

  const shownFields = $derived(
    DISPLAY_FIELDS.map(key => ({ key, value: findField(property.fields, key) }))
      .filter(entry => entry.value !== '')
      .slice(0, maxFields)
  );

  /**
   * The frontage filter judges a number the card never showed: 「北 幅員4.0m」
   * is what gets printed, and 4.0 is what gets compared. Deriving it from the
   * same helper the filter uses means the two can never disagree.
   */
  const roadWidth = $derived(narrowestRoadWidth(findField(property.fields, '接道状況')));

  // The name falls back to the address, so only repeat it when it adds something.
  const showLocation = $derived(property.location !== '' && property.location !== property.name);
</script>

<article class="card" class:ok={property.passed} class:ng={!property.passed}>
  <div class="top">
    <h3 class="name">{property.name || '物件名不明'}</h3>
    <span class="badge" class:ok={property.passed}>{property.passed ? '✓ 合致' : '✗ 除外'}</span>
  </div>
  {#if origin === 'athome'}
    <!-- Nothing judged it, so the ✓ badge above is not a verdict on this one. -->
    <div class="origin">athome 側で登録された物件（条件は未判定）</div>
  {/if}
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
        <!--
          Sits right after 接道状況 rather than in DISPLAY_FIELDS, because it is
          read off that field rather than being one of its own — and so it does
          not eat one of the `maxFields` slots.
        -->
        {#if field.key === '接道状況' && roadWidth !== null}
          <div class="field">
            <dt>接道幅</dt>
            <dd class="derived">{roadWidth}m</dd>
          </div>
        {/if}
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

  <div class="actions">
    <a class="btn detail" href={property.url} target="_blank" rel="noopener noreferrer">
      詳細を見る →
    </a>
    {#if onfavorite}
      <button
        type="button"
        class="btn star"
        class:on={favorited}
        disabled={busy || !favouritable}
        aria-pressed={favorited}
        title={!favouritable
          ? '物件番号を読み取れないため登録できません'
          : favorited
            ? 'お気に入りから外す（athome 側も解除します）'
            : 'お気に入りに入れて、この検索結果から外す'}
        onclick={onfavorite}
      >
        {busy ? '⏳ 通信中…' : favorited ? '★ お気に入り解除' : '☆ お気に入り'}
      </button>
    {/if}
  </div>
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
  .origin {
    font-size: 11px;
    color: var(--agf-muted);
    line-height: 1.6;
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
  .derived {
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  /* Both halves are the same control to the eye, so they are one rule. */
  .btn {
    flex: 1;
    display: block;
    padding: 7px 12px;
    border: none;
    border-radius: 6px;
    text-decoration: none;
    text-align: center;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
  }
  .detail {
    background: var(--agf-link);
  }
  .detail:hover {
    background: var(--agf-link-dark);
  }
  .star {
    background: #8d8d8d;
  }
  .star:hover:not(:disabled) {
    background: #6f6f6f;
  }
  .star.on {
    background: #e8a317;
  }
  .star.on:hover:not(:disabled) {
    background: #cf9013;
  }
  .star:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
</style>
