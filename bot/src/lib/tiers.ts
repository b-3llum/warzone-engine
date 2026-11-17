import type { RankedTier, TierLabel } from "../api/types.js";

export const BRAND_COLOR = 0x002fa7;
export const SUCCESS_COLOR = 0x2ecc71;
export const ERROR_COLOR = 0xe74c3c;
export const WARN_COLOR = 0xf1c40f;

/** Highest first. */
export const RANKED_TIERS: readonly RankedTier[] = ["S", "A+", "A", "B+", "B", "C", "D"];
export const TIER_FILTER_CHOICES = [...RANKED_TIERS, "UNRANKED"] as const;
export type TierGroup = RankedTier | "UNRANKED";

export const TIER_BADGE: Record<TierGroup, string> = {
  S: "💎",
  "A+": "🔥",
  A: "🟣",
  "B+": "🔵",
  B: "🟢",
  C: "🟡",
  D: "⚪",
  UNRANKED: "⏳",
};

export const isUnranked = (tier: TierLabel): boolean => tier.startsWith("UNRANKED");
export const tierGroup = (tier: TierLabel): TierGroup => (isUnranked(tier) ? "UNRANKED" : (tier as RankedTier));
export const badge = (tier: TierLabel): string => TIER_BADGE[tierGroup(tier)];

/** -1 for unranked, 0 (D) .. 6 (S) for ranked tiers. */
export function tierIndex(tier: TierLabel): number {
  if (isUnranked(tier)) return -1;
  return RANKED_TIERS.length - 1 - RANKED_TIERS.indexOf(tier as RankedTier);
}

export type TierChange =
  | { kind: "calibrated"; to: RankedTier }
  | { kind: "promoted"; from: RankedTier; to: RankedTier }
  | { kind: "demoted"; from: RankedTier; to: RankedTier }
  | null;

export function tierChange(before: TierLabel, after: TierLabel): TierChange {
  if (isUnranked(after)) return null;
  const to = after as RankedTier;
  if (isUnranked(before)) return { kind: "calibrated", to };
  const from = before as RankedTier;
  const diff = tierIndex(after) - tierIndex(before);
  if (diff > 0) return { kind: "promoted", from, to };
  if (diff < 0) return { kind: "demoted", from, to };
  return null;
}
