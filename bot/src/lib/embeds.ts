import { EmbedBuilder } from "discord.js";
import type { Leaderboard, MatchOutcome, PlayerDetail, PlayerMatchResult, PlayerSummary } from "../api/types.js";
import { esc, sparkline, truncate } from "./format.js";
import {
  BRAND_COLOR,
  RANKED_TIERS,
  SUCCESS_COLOR,
  TIER_BADGE,
  type TierGroup,
  badge,
  isUnranked,
  tierChange,
  tierGroup,
} from "./tiers.js";

// Discord limits: 25 fields, 1024 chars per field value, 6000 chars total per embed.
const FIELD_VALUE_MAX = 1024;
const EMBED_TOTAL_MAX = 6000;
const MAX_ROWS_PER_TIER = 10;
const MAX_ROWS_FILTERED = 25;
/** Name column width. Keeps table rows ≲ 32 chars so they don't wrap on phones. */
const NAME_W = 11;

// ---------------------------------------------------------------------------
// Monospace table helpers
// ---------------------------------------------------------------------------

/** Names go inside code blocks, so strip backticks (can't be escaped there) and pad to a fixed width. */
const cell = (s: string, w: number): string => {
  const clean = s.replace(/`/g, "'");
  return clean.length > w ? `${clean.slice(0, w - 1)}…` : clean.padEnd(w);
};
const right = (s: string | number, w: number): string => String(s).padStart(w);
const intDelta = (n: number): string => {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : r < 0 ? `-${Math.abs(r)}` : "±0";
};
/** In a ```diff block, "+" lines render green, "-" lines red, " " lines neutral. */
const diffMark = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return " ";
  const r = Math.round(n);
  return r > 0 ? "+" : r < 0 ? "-" : " ";
};
const diffBlock = (lines: string[]): string => `\`\`\`diff\n${lines.join("\n")}\n\`\`\``;
const ordinal = (p: number): string => ["1st", "2nd", "3rd", "4th"][p - 1] ?? `#${p}`;

// ---------------------------------------------------------------------------
// /leaderboard
// ---------------------------------------------------------------------------

function leaderboardTable(players: PlayerSummary[], calibrating: boolean): string[] {
  const header = `  ${calibrating ? "   " : "  #"}  ${cell("Player", NAME_W)}  Elo   KPG Last`;
  const rows = players.map((p) => {
    const pos = calibrating ? p.tier.match(/\((\d+\/\d+)\)/)?.[1] ?? "–" : String(p.rank ?? "–");
    const last = p.lastDelta === null || p.lastDelta === undefined ? "  –" : right(intDelta(p.lastDelta), 4);
    return `${diffMark(p.lastDelta)} ${right(pos, 3)}  ${cell(p.name, NAME_W)} ${right(p.elo, 4)} ${right(p.careerKpg.toFixed(1), 5)} ${last}`;
  });
  return [header, ...rows];
}

export function leaderboardEmbed(board: Leaderboard, filter: TierGroup | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(filter ? `🏆 Leaderboard · ${TIER_BADGE[filter]} ${filter === "UNRANKED" ? "Calibrating" : `Tier ${filter}`}` : "🏆 Leaderboard")
    .setFooter({ text: `${board.totalPlayers} players · ${board.totalMatches} matches this season` })
    .setTimestamp(new Date(board.updatedAt));

  const groups = new Map<TierGroup, PlayerSummary[]>();
  for (const p of board.players) {
    const g = tierGroup(p.tier);
    if (filter && g !== filter) continue;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }

  const order: TierGroup[] = [...RANKED_TIERS, "UNRANKED"];
  let budget = EMBED_TOTAL_MAX - 400; // title, footer, description
  let fields = 0;
  const skipped: TierGroup[] = [];

  for (const g of order) {
    const players = groups.get(g);
    if (!players?.length) continue;

    const calibrating = g === "UNRANKED";
    const name = calibrating
      ? `${TIER_BADGE.UNRANKED} Calibrating — ${players.length} player${players.length === 1 ? "" : "s"}`
      : `${TIER_BADGE[g]} Tier ${g} — ${players.length} player${players.length === 1 ? "" : "s"}`;
    const moreNote = (n: number) => `*+${n} more · \`/leaderboard tier:${g}\`*`;
    const fieldMax = Math.min(FIELD_VALUE_MAX, budget - name.length) - moreNote(players.length).length - 10;

    const all = leaderboardTable(players.slice(0, filter ? MAX_ROWS_FILTERED : MAX_ROWS_PER_TIER), calibrating);
    const lines: string[] = [];
    for (const line of all) {
      if (diffBlock([...lines, line]).length > fieldMax) break;
      lines.push(line);
    }
    const shown = lines.length - 1; // minus header
    if (shown <= 0) {
      skipped.push(g);
      continue;
    }
    const hidden = players.length - shown;
    const value = diffBlock(lines) + (hidden > 0 ? `\n${moreNote(hidden)}` : "");
    embed.addFields({ name, value });
    budget -= name.length + value.length;
    fields++;
  }

  if (skipped.length) {
    embed.addFields({ name: "More tiers", value: skipped.map((g) => `\`/leaderboard tier:${g}\``).join(" · ") });
  }

  if (fields === 0) {
    embed.setDescription(
      filter
        ? `Nobody in **${filter === "UNRANKED" ? "calibration" : `Tier ${filter}`}** yet.`
        : "No matches recorded this season yet.\nUse `/submit-2v2` or `/submit-ffa` to get started!",
    );
  } else if (groups.has("UNRANKED") && fields === 1 && !filter) {
    embed.setDescription("Everyone is still calibrating — tiers unlock after **8 matches**.");
  }
  return embed;
}

// ---------------------------------------------------------------------------
// /card
// ---------------------------------------------------------------------------

export function playerCardEmbed(p: PlayerDetail, avatarUrl: string): EmbedBuilder {
  const calibrating = isUnranked(p.tier);
  const progress = p.tier.match(/\((\d+)\/(\d+)\)/);
  const headline = calibrating
    ? `${badge(p.tier)} **Calibrating** · ${progress?.[1] ?? p.matchesPlayed}/${progress?.[2] ?? 8} matches`
    : `${badge(p.tier)} **Tier ${p.tier}**${p.rank ? ` · Rank #${p.rank}` : ""}`;
  const winRate = p.matchesPlayed ? Math.round((p.wins / p.matchesPlayed) * 100) : 0;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: p.name, iconURL: avatarUrl })
    .setDescription(`${headline}\n# ${p.elo}  Elo`)
    .addFields(
      { name: "Peak", value: `${p.peakElo}`, inline: true },
      { name: "Record", value: `${p.wins}W · ${p.matchesPlayed}G (${winRate}%)`, inline: true },
      { name: "Combat", value: `${p.careerKpg.toFixed(1)} KPG · ${p.kdRatio.toFixed(2)} K/D`, inline: true },
    )
    .setFooter({ text: `${p.totalKills} kills · ${p.totalDeaths} deaths · player since` })
    .setTimestamp(new Date(p.createdAt));

  if (p.lastFiveDeltas.length) {
    const oldestFirst = [...p.lastFiveDeltas].reverse();
    const series = [oldestFirst[0]!.eloAfter - oldestFirst[0]!.delta, ...oldestFirst.map((d) => d.eloAfter)];
    const trend = series.length >= 3 ? `  \`${sparkline(series)}\`` : "";
    const rows = p.lastFiveDeltas.map(
      (d) => `${diffMark(d.delta)} ${right(intDelta(d.delta), 4)}  ${right(Math.round(d.eloAfter), 4)}  ${ordinal(d.placement)}  ${d.format.padEnd(3)}  ${right(d.kills, 2)}K`,
    );
    embed.addFields({
      name: `Recent form${trend}`,
      value: diffBlock(rows),
    });
  }
  return embed;
}

// ---------------------------------------------------------------------------
// Match recap
// ---------------------------------------------------------------------------

function recapRow(r: PlayerMatchResult, withPlace: boolean): string {
  const place = withPlace ? `${ordinal(r.placement)} ` : "";
  const kd = `${r.kills}/${r.deaths}`;
  return `${diffMark(r.delta)} ${place}${cell(r.name, NAME_W)} ${right(Math.round(r.eloAfter), 4)} ${right(intDelta(r.delta), 4)}  ${right(kd, 5)}`;
}

function recapHeader(withPlace: boolean): string {
  return `  ${withPlace ? "    " : ""}${cell("Player", NAME_W)}  Elo    Δ    K/D`;
}

function highlights(outcome: MatchOutcome): string[] {
  const out: string[] = [];
  const results = outcome.results;

  const mvp = [...results].sort((a, b) => b.ipm - a.ipm || b.mps - a.mps)[0];
  if (mvp) out.push(`⭐ **MVP** — ${esc(mvp.name)} (${mvp.kills} kills, ×${mvp.ipm.toFixed(2)} performance)`);

  if (outcome.format === "2v2") {
    const best = Math.min(...results.map((x) => x.placement));
    const [a, b] = results.filter((r) => r.placement === best).sort((x, y) => y.ipm - x.ipm);
    if (a && b && a.ipm - b.ipm >= 0.3) out.push(`🏋️ **Carry** — ${esc(a.name)} carried ${esc(b.name)}`);
  }

  const topKills = [...results].sort((a, b) => b.kills - a.kills)[0];
  if (topKills && topKills.kills > 0 && topKills.id !== mvp?.id) out.push(`🔫 **Most kills** — ${esc(topKills.name)} (${topKills.kills})`);

  for (const r of results) {
    const upset = r.pairwise.find((p) => p.actual === 1 && p.expected <= 0.35);
    if (upset) {
      const opp = results.find((x) => x.id === upset.opponentId);
      out.push(`⚡ **Upset** — ${esc(r.name)} beat ${esc(opp?.name ?? "a favourite")} (${Math.round(upset.expected * 100)}% odds)`);
    }
  }

  for (const r of results) {
    const change = tierChange(r.tierBefore, r.tier);
    if (!change) continue;
    if (change.kind === "calibrated") out.push(`🎖️ **Placed** — ${esc(r.name)} → ${TIER_BADGE[change.to]} **Tier ${change.to}**`);
    if (change.kind === "promoted") out.push(`⬆️ **Promoted** — ${esc(r.name)} → ${TIER_BADGE[change.to]} **Tier ${change.to}**`);
    if (change.kind === "demoted") out.push(`⬇️ **Demoted** — ${esc(r.name)} → ${TIER_BADGE[change.to]} Tier ${change.to}`);
  }
  return out;
}

export function matchRecapEmbed(outcome: MatchOutcome, submittedBy: string): EmbedBuilder {
  const sorted = [...outcome.results].sort((a, b) => a.placement - b.placement || b.delta - a.delta);
  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle(outcome.format === "2v2" ? "🎮 2v2 Match Recorded" : "🎮 FFA Match Recorded")
    .setFooter({ text: `Submitted by ${submittedBy}` })
    .setTimestamp(new Date(outcome.playedAt));

  if (outcome.format === "2v2") {
    const teams = new Map<number, PlayerMatchResult[]>();
    for (const r of sorted) teams.set(r.team ?? 0, [...(teams.get(r.team ?? 0) ?? []), r]);
    const lines = [recapHeader(false)];
    for (const [team, members] of teams) {
      lines.push(`  ── Team ${team} · ${ordinal(members[0]!.placement)} ──`);
      for (const m of members) lines.push(recapRow(m, false));
    }
    embed.setDescription(diffBlock(lines));
  } else {
    embed.setDescription(diffBlock([recapHeader(true), ...sorted.map((r) => recapRow(r, true))]));
  }

  const hl = highlights(outcome);
  if (hl.length) embed.addFields({ name: "Highlights", value: truncate(hl.join("\n"), FIELD_VALUE_MAX) });

  const calibrating = sorted.filter((r) => isUnranked(r.tier));
  if (calibrating.length) {
    const progress = calibrating.map((r) => r.matchesPlayed);
    const same = progress.every((n) => n === progress[0]);
    const note =
      calibrating.length === sorted.length && same
        ? `All players are calibrating (${progress[0]}/8). Tiers unlock after 8 matches.`
        : `Calibrating: ${calibrating.map((r) => `${esc(r.name)} ${r.matchesPlayed}/8`).join(" · ")}`;
    embed.addFields({ name: "​", value: `⏳ ${note}` });
  }
  return embed;
}
