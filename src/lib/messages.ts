/**
 * What the results page says to the content script.
 *
 * The two run in different origins and only one of them can post to athome, so
 * every favourite registration crosses this boundary. Keeping the shapes in one
 * file means the guard and the sender cannot drift apart.
 */

export const PING = 'agf-ping';
export const FAVORITE = 'agf-favorite';
export const UNFAVORITE = 'agf-unfavorite';

export interface PingMessage {
  type: typeof PING;
}

export interface FavoriteMessage {
  type: typeof FAVORITE | typeof UNFAVORITE;
  /** The property number, which is athome's BUKKEN. */
  id: string;
}

export type Message = PingMessage | FavoriteMessage;

export interface PingReply {
  ok: true;
}

export interface FavoriteReply {
  ok: boolean;
  status: number;
  body: string;
  /** Empty unless the post never reached athome at all. */
  error: string;
}

function tagged(value: unknown): value is { type: unknown } {
  return typeof value === 'object' && value !== null && 'type' in value;
}

export function isPing(value: unknown): value is PingMessage {
  return tagged(value) && value.type === PING;
}

export function isFavoriteMessage(value: unknown): value is FavoriteMessage {
  return (
    tagged(value) &&
    (value.type === FAVORITE || value.type === UNFAVORITE) &&
    typeof (value as FavoriteMessage).id === 'string'
  );
}
