/**
 * Parses a modal line "kills deaths".
 * Accepted separators: whitespace, comma, slash. Examples: "7 2", "7/2", "7, 2".
 */

export interface StatLine {
  kills: number;
  deaths: number;
}

export class StatParseError extends Error {}

const MAX_KILLS = 200;
const MAX_DEATHS = 200;

export function parseStatLine(raw: string): StatLine {
  const parts = raw.trim().split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 2) {
    throw new StatParseError(`Expected 2 values "kills deaths", got ${parts.length} in "${raw}".`);
  }
  const [k, d] = parts as [string, string];
  if (!/^\d+$/.test(k)) throw new StatParseError(`Kills "${k}" must be a whole number.`);
  if (!/^\d+$/.test(d)) throw new StatParseError(`Deaths "${d}" must be a whole number.`);
  const kills = Number(k);
  const deaths = Number(d);
  if (kills > MAX_KILLS) throw new StatParseError(`Kills must be at most ${MAX_KILLS}.`);
  if (deaths > MAX_DEATHS) throw new StatParseError(`Deaths must be at most ${MAX_DEATHS}.`);
  return { kills, deaths };
}
