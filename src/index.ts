/**
 * Warzone Rebirth Rating Engine — Cloudflare Worker entrypoint.
 *
 * Routes
 *   GET  /health
 *   GET  /leaderboard
 *   GET  /player/:id
 *   POST /match            (auth)
 *   POST /reset-season     (auth)
 */

import {
  DuplicateMatchError,
  ValidationError,
  buildLeaderboard,
  emptySeasonState,
  processMatch,
  summarizePlayer,
  validateMatchInput,
} from "./engine";
import type { ApiError, Env, SeasonState } from "./types";

const STATE_KEY = "season:state:v1";
const ARCHIVE_PREFIX = "season:archive:";
const MAX_BODY_BYTES = 16 * 1024;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...extra },
  });
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiError = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return json(body, status);
}

/** Constant-time string comparison to avoid token timing leaks. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function requireAuth(req: Request, env: Env): void {
  if (!env.API_TOKEN) {
    throw new HttpError(503, "AUTH_NOT_CONFIGURED", "API_TOKEN secret is not configured on this Worker.");
  }
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !safeEqual(token, env.API_TOKEN)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid bearer token.");
  }
}

async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("Content-Type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Body exceeds ${MAX_BODY_BYTES} bytes.`);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

// ---------------------------------------------------------------------------
// KV persistence
// ---------------------------------------------------------------------------

function isSeasonState(v: unknown): v is SeasonState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<SeasonState>;
  return s.schemaVersion === 1 && typeof s.players === "object" && s.players !== null && Array.isArray(s.processedMatchIds);
}

async function loadState(env: Env): Promise<SeasonState> {
  let raw: unknown;
  try {
    raw = await env.WARZONE_RATINGS.get(STATE_KEY, "json");
  } catch (err) {
    // `get(..., "json")` throws on corrupt JSON as well as on KV failures.
    console.error("KV read failed", err);
    throw new HttpError(503, "STORAGE_READ_FAILED", "Failed to read rating state from storage.");
  }
  if (raw === null) return emptySeasonState(new Date().toISOString());
  if (!isSeasonState(raw)) {
    console.error("KV state failed schema check");
    throw new HttpError(500, "STATE_CORRUPT", "Stored rating state is corrupt or has an unknown schema version.");
  }
  return raw;
}

async function saveState(env: Env, state: SeasonState): Promise<void> {
  try {
    await env.WARZONE_RATINGS.put(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("KV write failed", err);
    throw new HttpError(503, "STORAGE_WRITE_FAILED", "Failed to persist rating state.");
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleLeaderboard(env: Env, url: URL): Promise<Response> {
  const state = await loadState(env);
  const board = buildLeaderboard(state);
  const tierFilter = url.searchParams.get("tier");
  if (tierFilter) {
    const t = tierFilter.toUpperCase();
    if (t === "UNRANKED") {
      return json({ ...board, players: board.unranked, tiers: [] });
    }
    return json({
      ...board,
      players: board.players.filter((p) => p.tier === t),
      tiers: board.tiers.filter((g) => g.tier === t),
      unranked: [],
    });
  }
  return json(board);
}

async function handlePlayer(env: Env, id: string): Promise<Response> {
  const state = await loadState(env);
  const player = state.players[id];
  if (!player) return errorResponse(404, "PLAYER_NOT_FOUND", `No player with id "${id}" this season.`);

  const board = buildLeaderboard(state);
  const rank = board.players.find((p) => p.id === id)?.rank ?? null;

  return json({
    ...summarizePlayer(player, rank),
    totalUptimeSec: player.totalUptimeSec,
    createdAt: player.createdAt,
    updatedAt: player.updatedAt,
    lastFiveDeltas: player.history.slice(0, 5).map((h) => ({
      matchId: h.matchId,
      playedAt: h.playedAt,
      format: h.format,
      placement: h.placement,
      kills: h.kills,
      delta: h.delta,
      eloAfter: h.eloAfter,
    })),
    history: player.history,
  });
}

async function handleMatch(req: Request, env: Env): Promise<Response> {
  requireAuth(req, env);
  const body = await readJson(req);
  const match = validateMatchInput(body);

  const state = await loadState(env);
  const { state: next, outcome } = processMatch(state, match, new Date().toISOString());
  await saveState(env, next);

  return json(outcome, 201);
}

async function handleResetSeason(req: Request, env: Env): Promise<Response> {
  requireAuth(req, env);
  const body = (await readJson(req).catch((e) => {
    // An empty / non-JSON body is fine for reset; only re-throw auth-ish problems.
    if (e instanceof HttpError && e.code === "UNSUPPORTED_MEDIA_TYPE") return {};
    throw e;
  })) as { archive?: unknown };

  const previous = await loadState(env);
  let archivedAs: string | null = null;

  if (body && body.archive === true && Object.keys(previous.players).length > 0) {
    archivedAs = `${ARCHIVE_PREFIX}${previous.seasonId}`;
    try {
      await env.WARZONE_RATINGS.put(archivedAs, JSON.stringify(previous));
    } catch (err) {
      console.error("KV archive failed", err);
      throw new HttpError(503, "STORAGE_WRITE_FAILED", "Failed to archive season; reset aborted.");
    }
  }

  // Write an explicit empty season (rather than deleting) so the new seasonId is stable.
  const fresh = emptySeasonState(new Date().toISOString());
  await saveState(env, fresh);

  return json({
    ok: true,
    message: "Season reset. All ratings cleared.",
    previousSeasonId: previous.seasonId,
    seasonId: fresh.seasonId,
    playersCleared: Object.keys(previous.players).length,
    matchesCleared: previous.matchCount,
    archivedAs,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (path === "/health" && method === "GET") return json({ ok: true, time: new Date().toISOString() });
  if (path === "/leaderboard" && method === "GET") return handleLeaderboard(env, url);
  if (path === "/match" && method === "POST") return handleMatch(req, env);
  if (path === "/reset-season" && method === "POST") return handleResetSeason(req, env);

  const playerMatch = path.match(/^\/player\/([^/]+)$/);
  if (playerMatch && method === "GET") {
    let id: string;
    try {
      id = decodeURIComponent(playerMatch[1]);
    } catch {
      return errorResponse(400, "INVALID_ID", "Player id is not valid URL encoding.");
    }
    return handlePlayer(env, id);
  }

  const knownPaths = ["/health", "/leaderboard", "/match", "/reset-season"];
  if (knownPaths.includes(path) || playerMatch) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", `${method} is not allowed on ${path}.`);
  }
  return errorResponse(404, "NOT_FOUND", `No route for ${method} ${path}.`);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message, err.details);
      if (err instanceof ValidationError) return errorResponse(400, "VALIDATION_ERROR", err.message, err.details);
      if (err instanceof DuplicateMatchError) return errorResponse(409, "DUPLICATE_MATCH", err.message, { matchId: err.matchId });
      console.error("Unhandled error", err);
      return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
  },
} satisfies ExportedHandler<Env>;
