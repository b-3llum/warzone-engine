/**
 * Typed HTTP client for the Warzone rating engine Worker.
 *
 * - Per-request timeout via AbortSignal.timeout
 * - Exponential backoff with jitter on network failures, timeouts, 429 and 502/503/504
 * - POST /match is retried safely because the Worker de-duplicates on `matchId`;
 *   a 409 on a *retry* means our earlier attempt landed, which is reported as such.
 * - POST /reset-season is never retried.
 */

import { config } from "../config.js";
import type {
  ApiErrorBody,
  Leaderboard,
  MatchOutcome,
  MatchPayload,
  PlayerDetail,
  ResetResult,
} from "./types.js";

/** The Worker answered with a non-2xx status. */
export class WorkerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
    /** 1-based attempt number on which this response was received. */
    public readonly attempt: number,
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
}

/** The Worker could not be reached (DNS, TLS, timeout, connection reset...). */
export class WorkerNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkerNetworkError";
  }
}

export type SubmitResult =
  | { kind: "recorded"; outcome: MatchOutcome }
  /** A retry hit 409: the first attempt was stored but its response was lost. */
  | { kind: "recorded-response-lost"; matchId: string };

interface RequestOptions {
  body?: unknown;
  /** Total attempts (1 = no retry). */
  attempts?: number;
  timeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * Node's fetch reports every network failure as "fetch failed"; the real reason
 * (ENOTFOUND, ECONNREFUSED, timeout, TLS error...) is on `cause`.
 */
function describeNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === "TimeoutError") return "request timed out";
  const cause = err.cause as { code?: string; message?: string } | undefined;
  if (cause?.code) return `${err.message} (${cause.code}${cause.message ? `: ${cause.message}` : ""})`;
  if (cause?.message) return `${err.message} (${cause.message})`;
  return err.message;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WorkerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly defaultTimeoutMs = 8_000,
  ) {}

  getLeaderboard(tier?: string): Promise<Leaderboard> {
    const qs = tier ? `?tier=${encodeURIComponent(tier)}` : "";
    return this.request<Leaderboard>("GET", `/leaderboard${qs}`, { attempts: 3 });
  }

  /** Returns `null` when the player has no record this season. */
  async getPlayer(id: string): Promise<PlayerDetail | null> {
    try {
      return await this.request<PlayerDetail>("GET", `/player/${encodeURIComponent(id)}`, { attempts: 3 });
    } catch (err) {
      if (err instanceof WorkerApiError && err.status === 404) return null;
      throw err;
    }
  }

  async submitMatch(payload: MatchPayload): Promise<SubmitResult> {
    try {
      const outcome = await this.request<MatchOutcome>("POST", "/match", { body: payload, attempts: 3, timeoutMs: 12_000 });
      return { kind: "recorded", outcome };
    } catch (err) {
      if (err instanceof WorkerApiError && err.status === 409 && err.attempt > 1) {
        return { kind: "recorded-response-lost", matchId: payload.matchId };
      }
      throw err;
    }
  }

  resetSeason(archive = true): Promise<ResetResult> {
    return this.request<ResetResult>("POST", "/reset-season", { body: { archive }, attempts: 1 });
  }

  private async request<T>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    const attempts = Math.max(1, opts.attempts ?? 1);
    const url = `${this.baseUrl}${path}`;
    let lastNetworkError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        const backoff = 400 * 2 ** (attempt - 2) + Math.random() * 250;
        await sleep(backoff);
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.token}`,
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
            "User-Agent": "warzone-rating-bot/1.0",
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(opts.timeoutMs ?? this.defaultTimeoutMs),
        });
      } catch (err) {
        lastNetworkError = err;
        console.warn(`[api] ${method} ${url} attempt ${attempt}/${attempts} failed: ${describeNetworkError(err)}`);
        continue;
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch (err) {
          throw new WorkerApiError(res.status, "BAD_RESPONSE", "Rating engine returned malformed JSON.", undefined, attempt);
        }
      }

      const errBody = await res.json().catch(() => null) as ApiErrorBody | null;
      const apiErr = new WorkerApiError(
        res.status,
        errBody?.error?.code ?? `HTTP_${res.status}`,
        errBody?.error?.message ?? res.statusText ?? "Request failed",
        errBody?.error?.details,
        attempt,
      );

      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
        console.warn(`[api] ${method} ${path} attempt ${attempt}/${attempts} got ${res.status}, retrying`);
        continue;
      }
      throw apiErr;
    }

    const reason = describeNetworkError(lastNetworkError);
    throw new WorkerNetworkError(`Rating engine unreachable after ${attempts} attempt(s): ${reason}`, {
      cause: lastNetworkError,
    });
  }
}

export const api = new WorkerClient(config.workerApiBase, config.apiToken);
