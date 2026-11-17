import { EmbedBuilder } from "discord.js";
import type { Leaderboard, MatchOutcome, PlayerDetail, PlayerMatchResult, PlayerSummary } from "../api/types.js";
import { esc, formatDelta, placementLabel, signed, sparkline, truncate } from "./format.js";
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
const MAX_ROWS_PER_TIER = 8;
const MAX_ROWS_FILTERED = 20;

// ---------------------------------------------------------------------------
// /leaderboard
// ---------------------------------------------------------------------------

function leaderboardRow(p: PlayerSummary): string {
  const pos = p.rank !== null ? `\`#${String(p.rank).padStart(2, " ")}\`` : "`  –`";
  const elo = `**${p.elo}**`;
  const kpg = `${p.careerKpg.toFixed(2)} KPG`;
  const calib = isUnranked(p.tier) ? ` · ${p.tier.replace("UNRANKED ", "")}` : "";
  return `${pos} ${esc(truncate(p.name, 24))} — ${elo} · ${kpg} · ${formatDelta(p.lastDelta)}${calib}`;
}

export function leaderboardEmbed(board: Leaderboard, filter: TierGroup | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(filter ? `🏆 Warzone Rebirth Leaderboard — ${TIER_BADGE[filter]} ${filter}` : "🏆 Warzone Rebirth Leaderboard")
    .setFooter({ text: `${board.totalPlayers} players · ${board.totalMatches} matches this season` })
    .setTimestamp(new Date(board.updatedAt));

  const groups = new Map<TierGroup, PlayerSummary[]>();
  for (const p of board.players) {
    const g = tierGroup(p.tier);
    if (filter && g !== filter) continue;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }

  const order: TierGroup[] = [...RANKED_TIERS, "UNRANKED"];
  // Title + description + footer are ~200 chars; keep fields within the rest of the 6000 budget.
  let budget = EMBED_TOTAL_MAX - 400;
  let fields = 0;
  const skipped: TierGroup[] = [];
  for (const g of order) {
    const players = groups.get(g);
    if (!players?.length) continue;

    const name = `${g === "UNRANKED" ? `${TIER_BADGE.UNRANKED} Calibrating (< 8 matches)` : `${TIER_BADGE[g]} Tier ${g}`} · ${players.length}`;
    const moreNote = (n: number) => `*…and ${n} more — \`/leaderboard tier:${g}\`*`;
    const fieldMax = Math.min(FIELD_VALUE_MAX, budget - name.length);

    const rows: string[] = [];
    let length = 0;
    for (const p of players.slice(0, filter ? MAX_ROWS_FILTERED : MAX_ROWS_PER_TIER)) {
      const row = leaderboardRow(p);
      // Always leave room for the "…and N more" note.
      if (length + row.length + 1 + moreNote(players.length).length + 1 > fieldMax) break;
      rows.push(row);
      length += row.length + 1;
    }
    if (rows.length === 0) {
      skipped.push(g);
      continue;
    }
    const hidden = players.length - rows.length;
    if (hidden > 0) rows.push(moreNote(hidden));

    const value = rows.join("\n");
    embed.addFields({ name, value });
    budget -= name.length + value.length;
    fields++;
  }
  if (skipped.length) {
    embed.addFields({ name: "More tiers", value: skipped.map((g) => `\`/leaderboard tier:${g}\``).join(" · ") });
  }

  if (fields === 0) {
    embed.setDescription(
      filter ? `No players in **${filter}** yet.` : "No matches recorded this season yet. Use `/submit-2v2` or `/submit-ffa` to get started!",
    );
  } else {
    embed.setDescription("Elo · career kills per game · last match delta");
  }
  return embed;
}

// ---------------------------------------------------------------------------
// /card
// ---------------------------------------------------------------------------

export function playerCardEmbed(p: PlayerDetail, avatarUrl: string): EmbedBuilder {
  const recent = [...p.lastFiveDeltas].reverse(); // oldest → newest
  const trend = recent.length
    ? `\`${sparkline([recent[0]!.eloAfter - recent[0]!.delta, ...recent.map((r) => r.eloAfter)])}\``
    : "";
  const deltaLines = p.lastFiveDeltas.length
    ? p.lastFiveDeltas
        .map(
          (d) =>
            `${placementLabel(d.placement)} \`${d.format.padEnd(3)}\` ${d.kills}K → ${formatDelta(d.delta)} (${Math.round(d.eloAfter)}) <t:${Math.floor(Date.parse(d.playedAt) / 1000)}:R>`,
        )
        .join("\n")
    : "No matches yet.";

  const tierText = isUnranked(p.tier) ? `${badge(p.tier)} ${p.tier}` : `${badge(p.tier)} **${p.tier}**`;

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: p.name, iconURL: avatarUrl })
    .setTitle(`${tierText}${p.rank ? ` · Rank #${p.rank}` : ""}`)
    .addFields(
      { name: "Elo", value: `**${p.elo}**`, inline: true },
      { name: "Peak Elo", value: `${p.peakElo}`, inline: true },
      { name: "Matches", value: `${p.matchesPlayed}`, inline: true },
      { name: "Wins", value: `${p.wins}`, inline: true },
      { name: "Win rate", value: `${p.matchesPlayed ? Math.round((p.wins / p.matchesPlayed) * 100) : 0}%`, inline: true },
      { name: "KPG", value: p.careerKpg.toFixed(2), inline: true },
      { name: "K/D", value: p.kdRatio.toFixed(2), inline: true },
      { name: "Kills", value: `${p.totalKills}`, inline: true },
      { name: "Deaths", value: `${p.totalDeaths}`, inline: true },
      { name: `Last ${p.lastFiveDeltas.length || ""} matches ${trend}`.replace(/\s+/g, " "), value: deltaLines },
    )
    .setFooter({ text: `Player since` })
    .setTimestamp(new Date(p.createdAt));
}

// ---------------------------------------------------------------------------
// Match recap
// ---------------------------------------------------------------------------

function recapLine(r: PlayerMatchResult): string {
  const tier = isUnranked(r.tier) ? r.tier.replace("UNRANKED ", "Calibrating ") : `${badge(r.tier)} ${r.tier}`;
  return (
    `${placementLabel(r.placement)} **${esc(r.name)}** — \`${Math.round(r.eloBefore)} → ${Math.round(r.eloAfter)}\` ` +
    `**${signed(r.delta)}**\n` +
    `　${r.kills}K / ${r.deaths}D · MPS ${Math.round(r.mps)} · IPM ×${r.ipm.toFixed(2)} · ${tier}`
  );
}

function highlights(outcome: MatchOutcome): string[] {
  const out: string[] = [];
  const results = outcome.results;

  const mvp = [...results].sort((a, b) => b.ipm - a.ipm || b.mps - a.mps)[0];
  if (mvp) out.push(`⭐ **MVP:** ${esc(mvp.name)} — IPM ×${mvp.ipm.toFixed(2)} (MPS ${Math.round(mvp.mps)} vs lobby avg ${Math.round(outcome.lobbyAvgMps)})`);

  if (outcome.format === "2v2") {
    // A carry: the higher-IPM teammate on the winning team, if they clearly out-performed their partner.
    const winners = results.filter((r) => r.placement === Math.min(...results.map((x) => x.placement)));
    const [a, b] = [...winners].sort((x, y) => y.ipm - x.ipm);
    if (a && b && a.ipm - b.ipm >= 0.3) out.push(`🏋️ **Carry:** ${esc(a.name)} hauled ${esc(b.name)} (×${a.ipm.toFixed(2)} vs ×${b.ipm.toFixed(2)})`);
  }

  const kills = [...results].sort((a, b) => b.kills - a.kills)[0];
  if (kills && kills.kills > 0 && kills.id !== mvp?.id) out.push(`🔫 **Most kills:** ${esc(kills.name)} (${kills.kills})`);

  for (const r of results) {
    const upset = r.pairwise.find((p) => p.actual === 1 && p.expected <= 0.35);
    if (upset) {
      const opp = results.find((x) => x.id === upset.opponentId);
      out.push(`⚡ **Upset:** ${esc(r.name)} beat ${esc(opp?.name ?? "a favourite")} with only a ${Math.round(upset.expected * 100)}% expected chance`);
    }
  }

  for (const r of results) {
    const change = tierChange(r.tierBefore, r.tier);
    if (!change) continue;
    if (change.kind === "calibrated") out.push(`🎖️ **Calibration complete:** ${esc(r.name)} placed into ${TIER_BADGE[change.to]} **${change.to}**`);
    if (change.kind === "promoted") out.push(`⬆️ **Promoted:** ${esc(r.name)} ${TIER_BADGE[change.from]} ${change.from} → ${TIER_BADGE[change.to]} **${change.to}**`);
    if (change.kind === "demoted") out.push(`⬇️ **Demoted:** ${esc(r.name)} ${TIER_BADGE[change.from]} ${change.from} → ${TIER_BADGE[change.to]} **${change.to}**`);
  }

  return out;
}

export function matchRecapEmbed(outcome: MatchOutcome, submittedBy: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle(outcome.format === "2v2" ? "🎮 2v2 Match Recorded" : "🎮 1v1v1v1 FFA Match Recorded")
    .setFooter({ text: `Match ${outcome.matchId} · submitted by ${submittedBy}` })
    .setTimestamp(new Date(outcome.playedAt));

  const sorted = [...outcome.results].sort((a, b) => a.placement - b.placement || b.delta - a.delta);

  if (outcome.format === "2v2") {
    const teams = new Map<number, PlayerMatchResult[]>();
    for (const r of sorted) teams.set(r.team ?? 0, [...(teams.get(r.team ?? 0) ?? []), r]);
    for (const [team, members] of teams) {
      embed.addFields({
        name: `${placementLabel(members[0]!.placement)} Team ${team}`,
        value: truncate(members.map(recapLine).join("\n"), FIELD_VALUE_MAX),
      });
    }
  } else {
    embed.addFields({ name: "Results", value: truncate(sorted.map(recapLine).join("\n"), FIELD_VALUE_MAX) });
  }

  const hl = highlights(outcome);
  if (hl.length) embed.addFields({ name: "Highlights", value: truncate(hl.join("\n"), FIELD_VALUE_MAX) });
  return embed;
}
