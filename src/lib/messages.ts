export const PING = 'agf-ping';
export const FAVORITE = 'agf-favorite';
export const UNFAVORITE = 'agf-unfavorite';
export const FAVORITES = 'agf-favorites';

export interface PingMessage {
  type: typeof PING;
}

export interface FavoriteMessage {
  type: typeof FAVORITE | typeof UNFAVORITE;
  id: string;
}

export interface FavoritesMessage {
  type: typeof FAVORITES;
}

export type Message = PingMessage | FavoriteMessage | FavoritesMessage;

export interface PingReply {
  ok: true;
}

export interface FavoriteReply {
  ok: boolean;
  status: number;
  body: string;
  error: string;
}

function tagged(value: unknown): value is { type: unknown } {
  return typeof value === 'object' && value !== null && 'type' in value;
}

export function isPing(value: unknown): value is PingMessage {
  return tagged(value) && value.type === PING;
}

export function isFavoritesMessage(value: unknown): value is FavoritesMessage {
  return tagged(value) && value.type === FAVORITES;
}

export function isFavoriteMessage(value: unknown): value is FavoriteMessage {
  return (
    tagged(value) &&
    (value.type === FAVORITE || value.type === UNFAVORITE) &&
    typeof (value as FavoriteMessage).id === 'string'
  );
}
