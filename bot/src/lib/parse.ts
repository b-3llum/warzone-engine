/**
 * Parses a modal line "kills deaths uptime".
 * Accepted separators: whitespace, comma, slash. Uptime: seconds ("754"), "mm:ss" ("12:34") or "h:mm:ss".
 * Examples: "7 2 12:30", "7/2/750", "7, 2, 1:02:05"
 */

export interface StatLine {
  kills: number;
  deaths: number;
  uptimeSec: number;
}

export class StatParseError extends Error {}

const MAX_KILLS = 200;
const MAX_DEATHS = 200;
const MAX_UPTIME_SEC = 4 * 60 * 60;

export function parseUptime(raw: string): number {
  const s = raw.trim().toLowerCase().replace(/s$/, "");
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) throw new StatParseError(`"${raw}" is not a valid uptime (use seconds, mm:ss or h:mm:ss).`);
  const [, h, min, sec] = m;
  if (Number(sec) >= 60) throw new StatParseError(`"${raw}": seconds must be below 60.`);
  if (h !== undefined && Number(min) >= 60) throw new StatParseError(`"${raw}": minutes must be below 60.`);
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec);
}

export function parseStatLine(raw: string): StatLine {
  const parts = raw.trim().split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3) {
    throw new StatParseError(`Expected 3 values "kills deaths uptime", got ${parts.length} in "${raw}".`);
  }
  const [k, d, u] = parts as [string, string, string];
  if (!/^\d+$/.test(k)) throw new StatParseError(`Kills "${k}" must be a whole number.`);
  if (!/^\d+$/.test(d)) throw new StatParseError(`Deaths "${d}" must be a whole number.`);
  const kills = Number(k);
  const deaths = Number(d);
  const uptimeSec = parseUptime(u);
  if (kills > MAX_KILLS) throw new StatParseError(`Kills must be at most ${MAX_KILLS}.`);
  if (deaths > MAX_DEATHS) throw new StatParseError(`Deaths must be at most ${MAX_DEATHS}.`);
  if (uptimeSec > MAX_UPTIME_SEC) throw new StatParseError(`Uptime must be at most 4 hours.`);
  return { kills, deaths, uptimeSec };
}
