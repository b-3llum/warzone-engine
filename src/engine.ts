/**
 * Pure rating engine: validation, MPS/IPM, pairwise Elo decomposition, tiering.
 * No I/O lives here so every function is deterministic and unit-testable.
 */

import type {
  MatchFormat,
  MatchHistoryEntry,
  MatchInput,
  MatchOutcome,
  MatchPlayerInput,
  PairwiseBreakdown,
  PlayerMatchResult,
  PlayerRecord,
  PlayerSummary,
  RankedTier,
  SeasonState,
  TierLabel,
  ValidatedMatch,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_ELO = 1500;
export const CALIBRATION_MATCHES = 8;
export const K_CALIBRATION = 80;
export const K_CALIBRATED = 30;
export const IPM_MIN = 0.4;
export const IPM_MAX = 1.8;
export const LOBBY_SIZE = 4;
export const HISTORY_LIMIT = 50;
export const PROCESSED_MATCH_ID_LIMIT = 500;

const PLACEMENT_POINTS: Readonly<Record<number, number>> = { 1: 50, 2: 30, 3: 15, 4: 0 };

/** Ordered high → low. A player qualifies for the first tier whose floor they meet. */
export const TIER_FLOORS: ReadonlyArray<{ tier: RankedTier; min: number }> = [
  { tier: "S", min: 2100 },
  { tier: "A+", min: 1900 },
  { tier: "A", min: 1700 },
  { tier: "B+", min: 1500 },
  { tier: "B", min: 1300 },
  { tier: "C", min: 1100 },
  { tier: "D", min: Number.NEGATIVE_INFINITY },
];

export const TIER_ORDER: ReadonlyArray<RankedTier> = TIER_FLOORS.map((t) => t.tier);

// Sanity caps to reject garbage from the bot / typos.
const MAX_KILLS = 200;
const MAX_DEATHS = 200;
const MAX_UPTIME_SEC = 4 * 60 * 60;
const MAX_NAME_LEN = 64;
const MAX_ID_LEN = 64;

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string, public readonly details: string[] = []) {
    super(message);
    this.name = "ValidationError";
  }
}

const isNonNegInt = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * Validates and normalises an untrusted match payload.
 * Rules:
 *  - exactly 4 players with unique IDs
 *  - FFA: no `team` fields, placements are a permutation of 1..4
 *  - 2v2: every player has `team`, exactly 2 teams of 2, teammates share a placement,
 *         the two teams have different placements (1..4)
 */
export function validateMatchInput(raw: unknown): ValidatedMatch {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const body = raw as Partial<MatchInput> & Record<string, unknown>;

  let matchId: string | undefined;
  if (body.matchId !== undefined) {
    if (typeof body.matchId !== "string" || !/^[A-Za-z0-9_\-:.]{1,128}$/.test(body.matchId)) {
      errors.push("matchId must be 1-128 chars of [A-Za-z0-9_-:.].");
    } else {
      matchId = body.matchId;
    }
  }

  if (!Array.isArray(body.players)) {
    throw new ValidationError("`players` must be an array.", errors);
  }
  if (body.players.length !== LOBBY_SIZE) {
    errors.push(`Exactly ${LOBBY_SIZE} players are required (got ${body.players.length}).`);
  }

  const players: MatchPlayerInput[] = [];
  const seenIds = new Set<string>();

  body.players.forEach((p: unknown, i: number) => {
    const at = `players[${i}]`;
    if (typeof p !== "object" || p === null) {
      errors.push(`${at} must be an object.`);
      return;
    }
    const r = p as Record<string, unknown>;

    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || id.length > MAX_ID_LEN) errors.push(`${at}.id must be a non-empty string (<= ${MAX_ID_LEN} chars).`);
    else if (seenIds.has(id)) errors.push(`${at}.id "${id}" is duplicated.`);
    else seenIds.add(id);

    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || name.length > MAX_NAME_LEN) errors.push(`${at}.name must be a non-empty string (<= ${MAX_NAME_LEN} chars).`);

    if (!isNonNegInt(r.kills, MAX_KILLS)) errors.push(`${at}.kills must be an integer 0-${MAX_KILLS}.`);
    if (!isNonNegInt(r.deaths, MAX_DEATHS)) errors.push(`${at}.deaths must be an integer 0-${MAX_DEATHS}.`);
    if (!isNonNegInt(r.placement, LOBBY_SIZE) || (r.placement as number) < 1)
      errors.push(`${at}.placement must be an integer 1-${LOBBY_SIZE}.`);
    if (typeof r.uptimeSec !== "number" || !Number.isFinite(r.uptimeSec) || r.uptimeSec < 0 || r.uptimeSec > MAX_UPTIME_SEC)
      errors.push(`${at}.uptimeSec must be a number 0-${MAX_UPTIME_SEC}.`);
    if (r.team !== undefined && r.team !== null && (!Number.isInteger(r.team) || (r.team as number) < 0))
      errors.push(`${at}.team must be a non-negative integer when provided.`);

    players.push({
      id,
      name,
      team: r.team === undefined || r.team === null ? undefined : (r.team as number),
      kills: r.kills as number,
      deaths: r.deaths as number,
      placement: r.placement as number,
      uptimeSec: r.uptimeSec as number,
    });
  });

  if (errors.length) throw new ValidationError("Invalid match payload.", errors);

  // Format detection
  const withTeam = players.filter((p) => p.team !== undefined).length;
  let format: MatchFormat;

  if (withTeam === 0) {
    format = "FFA";
    const placements = players.map((p) => p.placement).sort((a, b) => a - b);
    // Ties are allowed in FFA, but placements must be internally consistent (competition ranking, e.g. 1,1,3,4).
    const valid = placements.every((pl) => pl === placements.indexOf(pl) + 1);
    if (!valid) errors.push(`FFA placements ${JSON.stringify(placements)} are not a valid ranking (e.g. 1,2,3,4 or 1,1,3,4).`);
  } else if (withTeam === LOBBY_SIZE) {
    format = "2v2";
    const teams = new Map<number, MatchPlayerInput[]>();
    for (const p of players) teams.set(p.team!, [...(teams.get(p.team!) ?? []), p]);
    if (teams.size !== 2 || [...teams.values()].some((t) => t.length !== 2)) {
      errors.push("2v2 matches require exactly 2 teams of 2 players.");
    } else {
      const [a, b] = [...teams.values()];
      if (a[0].placement !== a[1].placement || b[0].placement !== b[1].placement)
        errors.push("Teammates must share the same placement in 2v2.");
      if (a[0].placement === b[0].placement) errors.push("The two teams cannot share the same placement in 2v2.");
    }
  } else {
    errors.push("Either all players must have `team` (2v2) or none (FFA).");
    format = "FFA";
  }

  if (errors.length) throw new ValidationError("Invalid match payload.", [...new Set(errors)]);

  return { matchId: matchId ?? crypto.randomUUID(), format, players };
}

// ---------------------------------------------------------------------------
// Core formulas
// ---------------------------------------------------------------------------

export const placementPoints = (placement: number): number => PLACEMENT_POINTS[placement] ?? 0;

export const careerKpg = (p: Pick<PlayerRecord, "totalKills" | "matchesPlayed">): number =>
  p.matchesPlayed > 0 ? p.totalKills / p.matchesPlayed : 0;

/** MPS = kills*15 + placement_pts + uptime*0.1 - deaths*12 + kpg_delta*10, floored at 0. */
export function computeMps(p: MatchPlayerInput, playerCareerKpg: number): number {
  const kpgDelta = p.kills - playerCareerKpg;
  const mps = p.kills * 15 + placementPoints(p.placement) + p.uptimeSec * 0.1 - p.deaths * 12 + kpgDelta * 10;
  return Math.max(0, mps);
}

/** IPM = 1 + (mps - avg)/avg, clamped to [0.4, 1.8]. Neutral (1.0) if the lobby average is 0. */
export function computeIpm(mps: number, lobbyAvgMps: number): number {
  if (lobbyAvgMps <= 0) return 1.0;
  return clamp(1.0 + (mps - lobbyAvgMps) / lobbyAvgMps, IPM_MIN, IPM_MAX);
}

export const kFactor = (matchesPlayed: number): number =>
  matchesPlayed < CALIBRATION_MATCHES ? K_CALIBRATION : K_CALIBRATED;

export const expectedScore = (playerElo: number, opponentElo: number): number =>
  1 / (1 + 10 ** ((opponentElo - playerElo) / 400));

/** Lower placement number = better finish. */
export const actualScore = (playerPlacement: number, opponentPlacement: number): number =>
  playerPlacement < opponentPlacement ? 1.0 : playerPlacement > opponentPlacement ? 0.0 : 0.5;

/** Asymmetric IPM scaling: good performers gain more / lose less, poor performers the opposite. */
export function adjustDelta(k: number, s: number, e: number, ipm: number): number {
  const raw = k * (s - e);
  return s >= e ? raw * ipm : raw * (2.0 - ipm);
}

export function tierForElo(elo: number): RankedTier {
  return TIER_FLOORS.find((t) => elo >= t.min)!.tier;
}

export function tierLabel(p: Pick<PlayerRecord, "elo" | "matchesPlayed">): TierLabel {
  if (p.matchesPlayed < CALIBRATION_MATCHES) return `UNRANKED (${p.matchesPlayed}/${CALIBRATION_MATCHES})` as TierLabel;
  return tierForElo(p.elo);
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export function emptySeasonState(nowIso: string): SeasonState {
  return {
    schemaVersion: 1,
    seasonId: crypto.randomUUID(),
    startedAt: nowIso,
    updatedAt: nowIso,
    matchCount: 0,
    players: {},
    processedMatchIds: [],
  };
}

function newPlayer(id: string, name: string, nowIso: string): PlayerRecord {
  return {
    id,
    name,
    elo: DEFAULT_ELO,
    peakElo: DEFAULT_ELO,
    matchesPlayed: 0,
    wins: 0,
    totalKills: 0,
    totalDeaths: 0,
    totalUptimeSec: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    history: [],
  };
}

export function summarizePlayer(p: PlayerRecord, rank: number | null): PlayerSummary {
  return {
    rank,
    id: p.id,
    name: p.name,
    elo: round(p.elo, 0),
    peakElo: round(p.peakElo, 0),
    tier: tierLabel(p),
    calibrated: p.matchesPlayed >= CALIBRATION_MATCHES,
    matchesPlayed: p.matchesPlayed,
    wins: p.wins,
    totalKills: p.totalKills,
    totalDeaths: p.totalDeaths,
    careerKpg: round(careerKpg(p), 2),
    kdRatio: round(p.totalDeaths > 0 ? p.totalKills / p.totalDeaths : p.totalKills, 2),
    lastDelta: p.history[0]?.delta ?? null,
  };
}

// ---------------------------------------------------------------------------
// Match processing
// ---------------------------------------------------------------------------

export class DuplicateMatchError extends Error {
  constructor(public readonly matchId: string) {
    super(`Match "${matchId}" has already been processed.`);
    this.name = "DuplicateMatchError";
  }
}

/**
 * Runs the full rating pipeline against a season state.
 * Returns a NEW state object (input is not mutated) plus the per-player outcome.
 *
 * All pairwise expectations use PRE-match Elo so the update is order-independent.
 * Each player's pairwise sum is normalised by the number of opponents they were
 * compared against (N-1 = 3 in FFA; 2 in 2v2 since teammates are skipped).
 */
export function processMatch(
  prev: SeasonState,
  match: ValidatedMatch,
  nowIso: string,
): { state: SeasonState; outcome: MatchOutcome } {
  if (prev.processedMatchIds.includes(match.matchId)) throw new DuplicateMatchError(match.matchId);

  const state: SeasonState = structuredClone(prev);

  // 1. Resolve (or create) player records, snapshot pre-match values.
  const ctx = match.players.map((input) => {
    const record = state.players[input.id] ?? newPlayer(input.id, input.name, nowIso);
    const kpgBefore = careerKpg(record);
    const mps = computeMps(input, kpgBefore);
    return {
      input,
      record,
      eloBefore: record.elo,
      tierBefore: tierLabel(record),
      kpgBefore,
      k: kFactor(record.matchesPlayed),
      mps,
      ipm: 1,
    };
  });

  // 2. Lobby average MPS → IPM.
  const lobbyAvgMps = ctx.reduce((s, c) => s + c.mps, 0) / ctx.length;
  for (const c of ctx) c.ipm = computeIpm(c.mps, lobbyAvgMps);

  // 3. Pairwise Elo decomposition.
  const results: PlayerMatchResult[] = ctx.map((c) => {
    const pairwise: PairwiseBreakdown[] = [];
    for (const o of ctx) {
      if (o === c) continue;
      if (match.format === "2v2" && o.input.team === c.input.team) continue; // skip teammates
      const e = expectedScore(c.eloBefore, o.eloBefore);
      const s = actualScore(c.input.placement, o.input.placement);
      const rawDelta = c.k * (s - e);
      const adjustedDelta = adjustDelta(c.k, s, e, c.ipm);
      pairwise.push({
        opponentId: o.input.id,
        opponentElo: round(o.eloBefore),
        expected: round(e, 4),
        actual: s,
        rawDelta: round(rawDelta, 3),
        adjustedDelta: round(adjustedDelta, 3),
      });
    }
    const opponents = pairwise.length;
    const delta = opponents > 0 ? pairwise.reduce((s, p) => s + p.adjustedDelta, 0) / opponents : 0;
    const eloAfter = round(c.eloBefore + delta);
    const appliedDelta = round(eloAfter - c.eloBefore);

    // 4. Persist into the record.
    const r = c.record;
    r.name = c.input.name; // keep display name fresh (Discord nick changes)
    r.elo = eloAfter;
    r.peakElo = Math.max(r.peakElo, eloAfter);
    r.matchesPlayed += 1;
    r.totalKills += c.input.kills;
    r.totalDeaths += c.input.deaths;
    r.totalUptimeSec += c.input.uptimeSec;
    if (c.input.placement === 1) r.wins += 1;
    r.updatedAt = nowIso;

    const entry: MatchHistoryEntry = {
      matchId: match.matchId,
      playedAt: nowIso,
      format: match.format,
      team: c.input.team,
      placement: c.input.placement,
      kills: c.input.kills,
      deaths: c.input.deaths,
      uptimeSec: c.input.uptimeSec,
      careerKpgBefore: round(c.kpgBefore, 3),
      mps: round(c.mps),
      lobbyAvgMps: round(lobbyAvgMps),
      ipm: round(c.ipm, 4),
      kFactor: c.k,
      eloBefore: round(c.eloBefore),
      eloAfter,
      delta: appliedDelta,
    };
    r.history = [entry, ...r.history].slice(0, HISTORY_LIMIT);
    state.players[r.id] = r;

    return {
      id: r.id,
      name: r.name,
      team: c.input.team,
      placement: c.input.placement,
      kills: c.input.kills,
      deaths: c.input.deaths,
      uptimeSec: c.input.uptimeSec,
      careerKpgBefore: round(c.kpgBefore, 3),
      kpgDelta: round(c.input.kills - c.kpgBefore, 3),
      mps: round(c.mps),
      ipm: round(c.ipm, 4),
      kFactor: c.k,
      eloBefore: round(c.eloBefore),
      eloAfter,
      delta: appliedDelta,
      matchesPlayed: r.matchesPlayed,
      calibrated: r.matchesPlayed >= CALIBRATION_MATCHES,
      tierBefore: c.tierBefore,
      tier: tierLabel(r),
      pairwise,
    };
  });

  state.matchCount += 1;
  state.updatedAt = nowIso;
  state.processedMatchIds = [match.matchId, ...state.processedMatchIds].slice(0, PROCESSED_MATCH_ID_LIMIT);

  results.sort((a, b) => a.placement - b.placement || b.delta - a.delta);

  return {
    state,
    outcome: { matchId: match.matchId, format: match.format, playedAt: nowIso, lobbyAvgMps: round(lobbyAvgMps), results },
  };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export function buildLeaderboard(state: SeasonState) {
  const all = Object.values(state.players);
  const ranked = all
    .filter((p) => p.matchesPlayed >= CALIBRATION_MATCHES)
    .sort((a, b) => b.elo - a.elo || b.matchesPlayed - a.matchesPlayed || a.name.localeCompare(b.name));
  const unranked = all
    .filter((p) => p.matchesPlayed < CALIBRATION_MATCHES)
    .sort((a, b) => b.elo - a.elo || b.matchesPlayed - a.matchesPlayed || a.name.localeCompare(b.name));

  const rankedSummaries = ranked.map((p, i) => summarizePlayer(p, i + 1));
  const unrankedSummaries = unranked.map((p) => summarizePlayer(p, null));

  const tiers = TIER_ORDER.map((tier) => ({
    tier,
    players: rankedSummaries.filter((p) => p.tier === tier),
  })).filter((g) => g.players.length > 0);

  // Flat list: everyone, Elo descending (calibrated or not), each labelled with their tier.
  const players = [...rankedSummaries, ...unrankedSummaries].sort(
    (a, b) => b.elo - a.elo || b.matchesPlayed - a.matchesPlayed,
  );

  return {
    seasonId: state.seasonId,
    seasonStartedAt: state.startedAt,
    updatedAt: state.updatedAt,
    totalMatches: state.matchCount,
    totalPlayers: all.length,
    players,
    tiers,
    unranked: unrankedSummaries,
  };
}
