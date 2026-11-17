/**
 * Renders the season leaderboard as a tier-list image (PNG):
 * a coloured label per tier on the left, one tile per player on the right.
 */

import { createCanvas, GlobalFonts, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import type { PlayerSummary, RankedTier } from "../api/types.js";
import { isUnranked, RANKED_TIERS } from "./tiers.js";

// Fonts ship with the bot so rendering doesn't depend on what's installed on the server.
const fontPath = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
GlobalFonts.registerFromPath(fontPath("Inter-ExtraBold.ttf"), "TierBold");
GlobalFonts.registerFromPath(fontPath("Inter-Medium.ttf"), "TierMedium");

const TIER_COLORS: Record<RankedTier | "CAL", string> = {
  S: "#ff7f7f",
  "A+": "#7f7fff",
  A: "#ffbf7f",
  "B+": "#7fbfff",
  B: "#ffdf7f",
  C: "#ffff7f",
  D: "#bfbfbf",
  CAL: "#4a4a4a",
};

// Layout (px)
const WIDTH = 2000;
const MARGIN = 68;
const TABLE_TOP = 248;
const LABEL_W = 160;
const TILE = 148;
const GAP = 14;
const PAD = 14;
const BOTTOM = 68;
const BG = "#1a1a1a";
const TABLE_BG = "#1e1e1e";
const LINE = "#333333";
const TILE_BG = "#2b2b2b";
const TILE_BORDER = "#3c3c3c";

export interface TierListOptions {
  title?: string;
  subtitle?: string;
  includeCalibrating?: boolean;
  /** Discord user ID → avatar image. Players without one get a text-only tile. */
  avatars?: Map<string, Image>;
}

interface Row {
  key: RankedTier | "CAL";
  players: PlayerSummary[];
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Word-wrap, breaking words that are too long on their own (like "Hunte/rbyll"). */
function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = () => {
    if (line) lines.push(line);
    line = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxW) {
      line = candidate;
      continue;
    }
    push();
    if (ctx.measureText(word).width <= maxW) {
      line = word;
      continue;
    }
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > maxW) push();
      line += ch;
    }
  }
  push();
  return lines;
}

/**
 * Largest font size that fits the name in the given box.
 * First tries sizes where no word has to be split mid-word; only splits words as a last resort.
 */
function fitName(
  ctx: SKRSContext2D,
  name: string,
  maxW: number,
  maxH: number,
  sizes: number[],
  maxLines: number,
): { size: number; lines: string[] } {
  const words = name.split(/\s+/).filter(Boolean);
  for (const allowBreak of [false, true]) {
    for (const size of sizes) {
      ctx.font = `${size}px TierBold`;
      if (!allowBreak && words.some((w) => ctx.measureText(w).width > maxW)) continue;
      const lines = wrap(ctx, name, maxW);
      if (lines.length <= maxLines && lines.length * size * 1.15 <= maxH) return { size, lines };
    }
  }
  const size = sizes[sizes.length - 1]!;
  ctx.font = `${size}px TierBold`;
  const lines = wrap(ctx, name, maxW).slice(0, maxLines);
  if (wrap(ctx, name, maxW).length > maxLines) lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, -1)}…`;
  return { size, lines };
}

function subLabel(p: PlayerSummary): string {
  return isUnranked(p.tier) ? `${p.elo} · ${p.tier.match(/\((\d+\/\d+)\)/)?.[1] ?? ""}` : `${p.elo}`;
}

/** Text-only tile (no avatar available). */
function drawTextTile(ctx: SKRSContext2D, x: number, y: number, p: PlayerSummary): void {
  roundRect(ctx, x, y, TILE, TILE, 8);
  ctx.fillStyle = TILE_BG;
  ctx.fill();
  ctx.strokeStyle = TILE_BORDER;
  ctx.lineWidth = 2;
  ctx.stroke();

  const subH = 32;
  const { size, lines } = fitName(ctx, p.name, TILE - 18, TILE - subH - 16, [32, 30, 28, 26, 24, 22, 20, 18], 3);
  const lineH = size * 1.15;
  let ty = y + (TILE - subH - lines.length * lineH) / 2 + size * 0.9 + 4;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = `${size}px TierBold`;
  for (const l of lines) {
    ctx.fillText(l, x + TILE / 2, ty);
    ty += lineH;
  }
  ctx.font = "21px TierMedium";
  ctx.fillStyle = "#9a9a9a";
  ctx.fillText(subLabel(p), x + TILE / 2, y + TILE - 13);
}

/** Avatar tile: picture fills the square, name over a dark fade at the bottom, Elo badge top-right. */
function drawAvatarTile(ctx: SKRSContext2D, x: number, y: number, p: PlayerSummary, img: Image): void {
  ctx.save();
  roundRect(ctx, x, y, TILE, TILE, 8);
  ctx.clip();

  // Cover-fit the avatar.
  const scale = Math.max(TILE / img.width, TILE / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, x + (TILE - w) / 2, y + (TILE - h) / 2, w, h);

  // Bottom fade for name legibility.
  const fade = ctx.createLinearGradient(0, y + TILE * 0.38, 0, y + TILE);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.55, "rgba(0,0,0,0.65)");
  fade.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = fade;
  ctx.fillRect(x, y, TILE, TILE);

  // Name (bottom, up to 2 lines).
  const { size, lines } = fitName(ctx, p.name, TILE - 14, 56, [24, 22, 20, 18, 16], 2);
  const lineH = size * 1.12;
  let ty = y + TILE - 10 - (lines.length - 1) * lineH;
  ctx.font = `${size}px TierBold`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  for (const l of lines) {
    ctx.fillText(l, x + TILE / 2, ty);
    ty += lineH;
  }
  ctx.shadowBlur = 0;

  // Elo badge (top-right).
  const label = subLabel(p);
  ctx.font = "18px TierBold";
  const bw = ctx.measureText(label).width + 14;
  roundRect(ctx, x + TILE - bw - 6, y + 6, bw, 26, 13);
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(label, x + TILE - 6 - bw / 2, y + 25);
  ctx.restore();

  roundRect(ctx, x, y, TILE, TILE, 8);
  ctx.strokeStyle = TILE_BORDER;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function renderTierList(players: PlayerSummary[], opts: TierListOptions = {}): Buffer {
  const includeCal = opts.includeCalibrating ?? true;

  const rows: Row[] = [];
  for (const tier of RANKED_TIERS) {
    const inTier = players.filter((p) => p.tier === tier).sort((a, b) => b.elo - a.elo);
    if (inTier.length) rows.push({ key: tier, players: inTier });
  }
  if (includeCal) {
    const cal = players.filter((p) => isUnranked(p.tier)).sort((a, b) => b.elo - a.elo);
    if (cal.length) rows.push({ key: "CAL", players: cal });
  }

  const tilesW = WIDTH - MARGIN * 2 - LABEL_W - PAD * 2;
  const perLine = Math.max(1, Math.floor((tilesW + GAP) / (TILE + GAP)));
  const rowHeights = rows.map((r) => {
    const lines = Math.max(1, Math.ceil(r.players.length / perLine));
    return PAD * 2 + lines * TILE + (lines - 1) * GAP;
  });
  const tableH = rowHeights.reduce((a, b) => a + b, 0);
  const height = TABLE_TOP + Math.max(tableH, 200) + BOTTOM;

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  // Title
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "72px TierBold";
  ctx.fillText(opts.title ?? "Tier List WZ", WIDTH / 2, 152);
  ctx.fillStyle = "#b5b5b5";
  ctx.font = "34px TierMedium";
  ctx.fillText(opts.subtitle ?? "ranking", WIDTH / 2, 202);

  const tableW = WIDTH - MARGIN * 2;
  if (rows.length === 0) {
    roundRect(ctx, MARGIN, TABLE_TOP, tableW, 200, 12);
    ctx.fillStyle = TABLE_BG;
    ctx.fill();
    ctx.fillStyle = "#8a8a8a";
    ctx.font = "36px TierMedium";
    ctx.fillText("No ranked players yet", WIDTH / 2, TABLE_TOP + 112);
    return canvas.toBuffer("image/png");
  }

  // Table frame
  roundRect(ctx, MARGIN, TABLE_TOP, tableW, tableH, 12);
  ctx.fillStyle = TABLE_BG;
  ctx.fill();
  ctx.save();
  ctx.clip();

  let y = TABLE_TOP;
  rows.forEach((row, i) => {
    const h = rowHeights[i]!;

    // Label cell
    ctx.fillStyle = TIER_COLORS[row.key];
    ctx.fillRect(MARGIN, y, LABEL_W, h);
    ctx.textAlign = "center";
    if (row.key === "CAL") {
      ctx.fillStyle = "#ffffff";
      ctx.font = "40px TierBold";
      ctx.fillText("CAL", MARGIN + LABEL_W / 2, y + h / 2 + 4);
      ctx.font = "20px TierMedium";
      ctx.fillStyle = "#d0d0d0";
      ctx.fillText("< 8 games", MARGIN + LABEL_W / 2, y + h / 2 + 34);
    } else {
      ctx.fillStyle = "#111111";
      ctx.font = "56px TierBold";
      ctx.fillText(row.key, MARGIN + LABEL_W / 2, y + h / 2 + 20);
    }

    // Tiles
    row.players.forEach((p, idx) => {
      const col = idx % perLine;
      const line = Math.floor(idx / perLine);
      const tx = MARGIN + LABEL_W + PAD + col * (TILE + GAP);
      const ty = y + PAD + line * (TILE + GAP);
      const img = opts.avatars?.get(p.id);
      if (img) drawAvatarTile(ctx, tx, ty, p, img);
      else drawTextTile(ctx, tx, ty, p);
    });

    // Row separator
    if (i < rows.length - 1) {
      ctx.fillStyle = LINE;
      ctx.fillRect(MARGIN, y + h - 1, tableW, 2);
    }
    y += h;
  });
  ctx.restore();

  roundRect(ctx, MARGIN, TABLE_TOP, tableW, tableH, 12);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  return canvas.toBuffer("image/png");
}
