/**
 * Response/request shapes of the Warzone rating engine Worker (see ../../../src/types.ts).
 * Kept as a standalone copy so the bot can be deployed independently of the Worker.
 */

export type RankedTier = "S" | "A+" | "A" | "B+" | "B" | "C" | "D";
/** A ranked tier, or `UNRANKED (X/8)` while calibrating. */
export type TierLabel = RankedTier | `UNRANKED (${number}/8)`;
export type MatchFormat = "2v2" | "FFA";

export interface PlayerSummary {
  rank: number | null;
  id: string;
  name: string;
  elo: number;
  peakElo: number;
  tier: TierLabel;
  calibrated: boolean;
  matchesPlayed: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  careerKpg: number;
  kdRatio: number;
  /** Present on Worker versions that expose it. */
  lastDelta?: number | null;
}

export interface Leaderboard {
  seasonId: string;
  seasonStartedAt: string;
  updatedAt: string;
  totalMatches: number;
  totalPlayers: number;
  players: PlayerSummary[];
  tiers: { tier: RankedTier; players: PlayerSummary[] }[];
  unranked: PlayerSummary[];
}

export interface RecentDelta {
  matchId: string;
  playedAt: string;
  format: MatchFormat;
  placement: number;
  kills: number;
  delta: number;
  eloAfter: number;
}

export interface PlayerDetail extends PlayerSummary {
  totalUptimeSec: number;
  createdAt: string;
  updatedAt: string;
  /** Most recent first. */
  lastFiveDeltas: RecentDelta[];
}

export interface MatchPlayerPayload {
  id: string;
  name: string;
  team?: number;
  kills: number;
  deaths: number;
  placement: number;
  uptimeSec: number;
}

export interface MatchPayload {
  matchId: string;
  players: MatchPlayerPayload[];
}

export interface PairwiseBreakdown {
  opponentId: string;
  opponentElo: number;
  expected: number;
  actual: number;
  rawDelta: number;
  adjustedDelta: number;
}

export interface PlayerMatchResult {
  id: string;
  name: string;
  team?: number;
  placement: number;
  kills: number;
  deaths: number;
  uptimeSec: number;
  careerKpgBefore: number;
  kpgDelta: number;
  mps: number;
  ipm: number;
  kFactor: number;
  eloBefore: number;
  eloAfter: number;
  delta: number;
  matchesPlayed: number;
  calibrated: boolean;
  tierBefore: TierLabel;
  tier: TierLabel;
  pairwise: PairwiseBreakdown[];
}

export interface MatchOutcome {
  matchId: string;
  format: MatchFormat;
  playedAt: string;
  lobbyAvgMps: number;
  results: PlayerMatchResult[];
}

export interface ResetResult {
  ok: true;
  message: string;
  previousSeasonId: string;
  seasonId: string;
  playersCleared: number;
  matchesCleared: number;
  archivedAs: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
