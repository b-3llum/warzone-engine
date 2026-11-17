/**
 * In-memory store bridging a slash command (who played, placements) and the
 * modal submission that follows (kills/deaths/uptime). Keyed by the slash
 * command's interaction.id, which is also used as the Worker matchId.
 *
 * Entries expire after the modal window; a bot restart simply asks the user to re-run the command.
 */

import type { MatchFormat } from "../api/types.js";

export interface PendingPlayer {
  id: string;
  name: string;
  team?: number;
  placement: number;
}

export interface PendingMatch {
  matchId: string;
  format: MatchFormat;
  invokerId: string;
  channelId: string;
  players: PendingPlayer[];
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, PendingMatch>();

export function putPending(match: PendingMatch): void {
  prune();
  store.set(match.matchId, match);
}

export function getPending(matchId: string): PendingMatch | undefined {
  prune();
  return store.get(matchId);
}

export function deletePending(matchId: string): void {
  store.delete(matchId);
}

function prune(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, m] of store) if (m.createdAt < cutoff) store.delete(id);
}
