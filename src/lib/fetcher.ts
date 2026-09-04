/**
 * The one place that talks to athome over the network.
 *
 * A run that walks a whole search makes thousands of requests instead of a few
 * dozen, which changes what "a failed request" means: a single hiccup used to
 * end the crawl, and the site's rate limiting was never recognised at all
 * because it does not arrive as an error status.
 */

const JITTER = 0.25;

/** Noise added to the gap between requests, so the crawl has no exact rhythm. */
const PACE_JITTER = 0.3;

export class AbortedError extends Error {
  constructor() {
    super('中断しました');
    this.name = 'AbortedError';
  }
}

/**
 * Waits, but gives up the moment the run is cancelled. A plain timer holds a
 * cancellation for as long as the wait it is in the middle of, and a backoff
 * wait runs to a minute or two — long enough that the cancel button reads as
 * broken.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Thrown once athome keeps answering with its bot check despite backing off. */
export class BlockedError extends Error {
  constructor() {
    super('athome のアクセス制限に掛かりました');
    this.name = 'BlockedError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

/** What a page request produced, once every retry it was owed has been spent. */
export type PageOutcome =
  | { kind: 'ok'; html: string; doc: Document }
  /** The page does not exist — for a list page, that is the end of the search. */
  | { kind: 'notfound' }
  /** athome served its bot check instead of the page. */
  | { kind: 'challenged' }
  | { kind: 'error'; status: number };

/**
 * athome answers a rate-limited request with a 200 carrying a JS bot check
 * rather than an error status, so a challenge can only be recognised by its
 * content: none of the markup a real page has, plus the protection script the
 * interstitial always ships.
 */
export function isChallengeHtml(html: string): boolean {
  if (html.includes('card-box-inner')) return false;
  return (
    html.includes('reeseSkipExpirationCheck') ||
    html.includes('onProtectionInitialized') ||
    html.includes('【アットホーム】認証中')
  );
}

export interface RetryPolicy {
  /** The first wait, in ms. It doubles with every attempt. */
  baseMs: number;
  /** Ceiling on any single wait. */
  maxMs: number;
  /** How many retries to spend before giving up. */
  attempts: number;
}

const THROTTLED: RetryPolicy = { baseMs: 2000, maxMs: 60_000, attempts: 5 };
const FORBIDDEN: RetryPolicy = { baseMs: 10_000, maxMs: 120_000, attempts: 3 };
const SERVER: RetryPolicy = { baseMs: 1000, maxMs: 20_000, attempts: 3 };
const CHALLENGE: RetryPolicy = { baseMs: 10_000, maxMs: 120_000, attempts: 3 };

/** How a status should be retried, or null when retrying it is pointless. */
export function policyForStatus(status: number): RetryPolicy | null {
  if (status === 429 || status === 503) return THROTTLED;
  if (status === 403) return FORBIDDEN;
  if (status >= 500) return SERVER;
  return null;
}

/**
 * Exponential backoff with jitter. The jitter matters because several requests
 * often fail together, and without it they would all come back in lockstep.
 */
export function backoffDelay(attempt: number, policy: RetryPolicy, random = Math.random): number {
  const base = Math.min(policy.baseMs * 2 ** attempt, policy.maxMs);
  return Math.round(base * (1 + JITTER * (random() * 2 - 1)));
}

/** Milliseconds to wait per a Retry-After header, in either form it takes. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

const COOLDOWN_STEP_MS = 1500;
const COOLDOWN_MAX_MS = 8000;
const CLEAN_RUN_TO_RECOVER = 20;

/**
 * A challenge is the site saying the crawl is going too fast, which is about
 * more than the one request that tripped it: every later request slows down
 * too, and the pace only recovers after a long clean streak.
 */
export interface Pacer {
  readonly cooldownMs: number;
  penalise(): void;
  reward(): void;
}

export function newPacer(): Pacer {
  let cooldownMs = 0;
  let clean = 0;

  return {
    get cooldownMs() {
      return cooldownMs;
    },
    penalise() {
      clean = 0;
      cooldownMs = Math.min(COOLDOWN_MAX_MS, cooldownMs + COOLDOWN_STEP_MS);
    },
    reward() {
      if (cooldownMs === 0) return;
      clean++;
      if (clean < CLEAN_RUN_TO_RECOVER) return;
      clean = 0;
      cooldownMs = cooldownMs <= COOLDOWN_STEP_MS ? 0 : Math.floor(cooldownMs / 2);
    }
  };
}

/** The gap to leave before the next request: the set pace, plus any penalty. */
export function paceDelay(delayMs: number, cooldownMs = 0, random = Math.random): number {
  const base = delayMs + cooldownMs;
  return Math.round(base * (1 + PACE_JITTER * (random() * 2 - 1)));
}

type Attempt =
  | { kind: 'ok'; html: string; doc: Document }
  | { kind: 'notfound' }
  | { kind: 'challenged' }
  | { kind: 'failed'; status: number; policy: RetryPolicy | null; retryAfter: number | null };

async function attemptFetch(url: string, signal?: AbortSignal): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', signal });
  } catch (err) {
    if (signal?.aborted) throw new AbortedError();
    console.warn('[AGF] 取得に失敗:', url, err);
    // A thrown fetch is a transport problem, which is worth the same patience
    // as a server error; status 0 marks that there was never a response.
    return { kind: 'failed', status: 0, policy: SERVER, retryAfter: null };
  }

  if (res.status === 404) return { kind: 'notfound' };

  if (!res.ok) {
    return {
      kind: 'failed',
      status: res.status,
      policy: policyForStatus(res.status),
      retryAfter: retryAfterMs(res.headers.get('Retry-After'))
    };
  }

  const html = await res.text();
  if (isChallengeHtml(html)) return { kind: 'challenged' };
  return { kind: 'ok', html, doc: new DOMParser().parseFromString(html, 'text/html') };
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Shared across a run so one challenge slows every later request down. */
  pacer?: Pacer;
  /** Overridable so tests never actually wait. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Fetches one page, retrying whatever is worth retrying before giving up. */
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<PageOutcome> {
  const { signal, pacer, wait = sleep, random = Math.random } = options;

  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);

    const result = await attemptFetch(url, signal);

    if (result.kind === 'ok') {
      pacer?.reward();
      return result;
    }
    if (result.kind === 'notfound') return result;

    const challenged = result.kind === 'challenged';
    if (challenged) pacer?.penalise();

    const policy = challenged ? CHALLENGE : result.policy;
    if (policy === null || attempt >= policy.attempts) {
      return challenged ? { kind: 'challenged' } : { kind: 'error', status: result.status };
    }

    // The signal matters most here: a challenge backs off for up to two
    // minutes, and a cancellation that waits that out is not a cancellation.
    const stated = challenged ? null : result.retryAfter;
    await wait(Math.min(stated ?? backoffDelay(attempt, policy, random), policy.maxMs), signal);
  }
}
