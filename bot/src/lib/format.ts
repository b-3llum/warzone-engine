/** Small text-formatting helpers shared by embeds. */

export const signed = (n: number, dp = 1): string => {
  const v = Number(n.toFixed(dp));
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(dp)}`;
};

export const deltaArrow = (n: number): string => (n > 0 ? "▲" : n < 0 ? "▼" : "▬");

export const formatDelta = (n: number | null | undefined, dp = 1): string =>
  n === null || n === undefined ? "—" : `${deltaArrow(n)} ${signed(n, dp)}`;

export const formatUptime = (sec: number): string => {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

const SPARK = "▁▂▃▄▅▆▇█";

/** Unicode sparkline of a numeric series (oldest → newest). */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return SPARK[3]!.repeat(values.length);
  return values.map((v) => SPARK[Math.round(((v - min) / (max - min)) * (SPARK.length - 1))]).join("");
}

export const placementLabel = (p: number): string => (["🥇", "🥈", "🥉", "4️⃣"][p - 1] ?? `#${p}`);

/** Escape Discord markdown in user-controlled names. */
export const esc = (s: string): string => s.replace(/([\\*_`~|])/g, "\\$1");

export const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
