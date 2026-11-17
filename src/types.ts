/**
 * Shared domain + transport types for the Warzone Rebirth rating engine.
 */

// ---------------------------------------------------------------------------
// Worker environment
// ---------------------------------------------------------------------------

export interface Env {
  /** KV namespace holding the season state document. */
  WARZONE_RATINGS: KVNamespace;
  /**
   * Shared secret the Discord bot sends as `Authorization: Bearer <token>`.
   * Required for all mutating endpoints (POST /match, POST /reset-season).
   * Set with: `wrangler secret put API_TOKEN`
   */
  API_TOKEN?: string;
}

// ---------------------------------------------------------------------------
// Inbound payloads
// ---------------------------------------------------------------------------

export type MatchFormat = "2v2" | "FFA";

export interface MatchPlayerInput {
  id: string;
  name: string;
  team?: number;
  kills: number;
  deaths: number;
  placement: number;
  uptimeSec: number;
}

export interface MatchInput {
  /** Optional idempotency key (e.g. Discord message ID). Duplicate submissions are rejected. */
  matchId?: string;
  players: MatchPlayerInput[];
}

/** Match payload after validation + normalisation. */
export interface ValidatedMatch {
  matchId: string;
  format: MatchFormat;
  players: MatchPlayerInput[];
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

export interface MatchHistoryEntry {
  matchId: string;
  playedAt: string;
  format: MatchFormat;
  team?: number;
  placement: number;
  kills: number;
  deaths: number;
  uptimeSec: number;
  /** Career KPG used for the kpg_delta term (pre-match value). */
  careerKpgBefore: number;
  mps: number;
  lobbyAvgMps: number;
  ipm: number;
  kFactor: number;
  eloBefore: number;
  eloAfter: number;
  delta: number;
}

export interface PlayerRecord {
  id: string;
  name: string;
  elo: number;
  peakElo: number;
  matchesPlayed: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  totalUptimeSec: number;
  createdAt: string;
  updatedAt: string;
  /** Most recent first, capped at HISTORY_LIMIT entries. */
  history: MatchHistoryEntry[];
}

export interface SeasonState {
  schemaVersion: 1;
  seasonId: string;
  startedAt: string;
  updatedAt: string;
  matchCount: number;
  players: Record<string, PlayerRecord>;
  /** Recently processed match IDs (bounded) for idempotency. */
  processedMatchIds: string[];
}

// ---------------------------------------------------------------------------
// Outbound views
// ---------------------------------------------------------------------------

export type RankedTier = "S" | "A+" | "A" | "B+" | "B" | "C" | "D";
/** Either a ranked tier or `UNRANKED (X/8)`. */
export type TierLabel = RankedTier | `UNRANKED (${number}/8)`;

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
  /** Rating change from the player's most recent match (null if none). */
  lastDelta: number | null;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
