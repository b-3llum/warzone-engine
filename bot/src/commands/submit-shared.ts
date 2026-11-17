/**
 * Shared flow for /submit-2v2 and /submit-ffa:
 *   1. Slash command collects WHO played and placements → stored as a PendingMatch.
 *   2. A modal collects "kills deaths" for each of the 4 players.
 *   3. POST /match with matchId = the slash command's interaction.id (idempotent).
 *   4. Public recap embed in the channel.
 * Parse errors, 400s and network failures keep the pending match and offer a
 * "Re-enter stats" button, so nothing has to be retyped from scratch.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { api, WorkerApiError } from "../api/client.js";
import type { MatchFormat, MatchPlayerPayload } from "../api/types.js";
import { config } from "../config.js";
import { matchRecapEmbed } from "../lib/embeds.js";
import { errorEmbed, warnEmbed } from "../lib/errors.js";
import { truncate } from "../lib/format.js";
import { parseStatLine, StatParseError } from "../lib/parse.js";
import { deletePending, getPending, putPending, type PendingMatch, type PendingPlayer } from "../lib/pending.js";
import type { ComponentHandler } from "./types.js";

export const MATCH_PREFIX = "match";

export interface PlayerSlot {
  option: string;
  team?: number;
  placement: number;
}

/** Display name preference: server nickname → global display name → username. */
function displayName(interaction: ChatInputCommandInteraction, option: string): { id: string; name: string; bot: boolean } | null {
  const user = interaction.options.getUser(option);
  if (!user) return null;
  const member = interaction.options.getMember(option);
  const name =
    member instanceof GuildMember ? member.displayName : (member?.nick ?? user.globalName ?? user.username);
  return { id: user.id, name: truncate(name, 64), bot: user.bot };
}

function canSubmit(interaction: ChatInputCommandInteraction): boolean {
  if (!config.submitterRoleId) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const member = interaction.member;
  if (member instanceof GuildMember) return member.roles.cache.has(config.submitterRoleId);
  return Array.isArray(member?.roles) && member.roles.includes(config.submitterRoleId);
}

/**
 * Validates the slash-command inputs and opens the stats modal.
 * Must call showModal within 3 seconds, so no API calls happen here.
 */
export async function startSubmission(
  interaction: ChatInputCommandInteraction,
  format: MatchFormat,
  slots: PlayerSlot[],
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Matches can only be submitted inside a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canSubmit(interaction)) {
    await interaction.reply({
      embeds: [warnEmbed("🔒 Not allowed", `You need the <@&${config.submitterRoleId}> role to submit matches.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const problems: string[] = [];
  const players: PendingPlayer[] = [];
  const seen = new Set<string>();

  for (const slot of slots) {
    const p = displayName(interaction, slot.option);
    if (!p) {
      problems.push(`Missing player for \`${slot.option}\`.`);
      continue;
    }
    if (p.bot) problems.push(`<@${p.id}> is a bot and can't be rated.`);
    if (seen.has(p.id)) problems.push(`<@${p.id}> is listed more than once.`);
    seen.add(p.id);
    players.push({ id: p.id, name: p.name, team: slot.team, placement: slot.placement });
  }

  if (format === "2v2") {
    const t1 = slots.find((s) => s.team === 1)?.placement;
    const t2 = slots.find((s) => s.team === 2)?.placement;
    if (t1 === t2) problems.push("Team 1 and Team 2 can't have the same placement.");
  }

  if (problems.length) {
    await interaction.reply({
      embeds: [warnEmbed("⚠️ Can't submit this match", problems.join("\n"))],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const pending: PendingMatch = {
    matchId: interaction.id,
    format,
    invokerId: interaction.user.id,
    channelId: interaction.channelId,
    players,
    createdAt: Date.now(),
  };
  putPending(pending);
  await interaction.showModal(buildStatsModal(pending));
}

function slotLabel(p: PendingPlayer, format: MatchFormat): string {
  const ordinal = ["1st", "2nd", "3rd", "4th"][p.placement - 1] ?? `#${p.placement}`;
  const prefix = format === "2v2" ? `Team ${p.team} (${ordinal})` : ordinal;
  return truncate(`${prefix} · ${p.name}`, 45);
}

export function buildStatsModal(pending: PendingMatch, previous?: Map<string, string>): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${MATCH_PREFIX}:${pending.matchId}`)
    .setTitle(pending.format === "2v2" ? "2v2 match stats" : "FFA match stats");

  pending.players.forEach((p, idx) => {
    const input = new TextInputBuilder()
      .setCustomId(`p${idx}`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(16)
      .setPlaceholder("kills deaths — e.g. 7 2");
    const prev = previous?.get(`p${idx}`);
    if (prev) input.setValue(prev);

    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel(slotLabel(p, pending.format))
        .setDescription("Kills and deaths, separated by a space")
        .setTextInputComponent(input),
    );
  });
  return modal;
}

/** Remembers the last raw modal input per match so "Re-enter stats" can pre-fill it. */
const lastInputs = new Map<string, Map<string, string>>();

function retryRow(matchId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${MATCH_PREFIX}:${matchId}:retry`).setLabel("Re-enter stats").setStyle(ButtonStyle.Primary).setEmoji("✏️"),
    new ButtonBuilder().setCustomId(`${MATCH_PREFIX}:${matchId}:cancel`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

async function handleModal(interaction: ModalSubmitInteraction, [matchId]: string[]): Promise<void> {
  const pending = matchId ? getPending(matchId) : undefined;
  if (!pending) {
    await interaction.reply({
      embeds: [warnEmbed("⌛ Submission expired", "This submission timed out or the bot restarted. Please run the command again.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.user.id !== pending.invokerId) {
    await interaction.reply({ content: "Only the person who started this submission can complete it.", flags: MessageFlags.Ephemeral });
    return;
  }

  // 1. Parse stat lines.
  const raw = new Map<string, string>();
  const errors: string[] = [];
  const payloadPlayers: MatchPlayerPayload[] = [];

  pending.players.forEach((p, idx) => {
    const value = interaction.fields.getTextInputValue(`p${idx}`);
    raw.set(`p${idx}`, value);
    try {
      const stats = parseStatLine(value);
      payloadPlayers.push({
        id: p.id,
        name: p.name,
        ...(pending.format === "2v2" ? { team: p.team } : {}),
        placement: p.placement,
        ...stats,
      });
    } catch (err) {
      if (!(err instanceof StatParseError)) throw err;
      errors.push(`**${p.name}:** ${err.message}`);
    }
  });
  lastInputs.set(pending.matchId, raw);

  if (errors.length) {
    await interaction.reply({
      embeds: [warnEmbed("⚠️ Couldn't read some stats", `${errors.join("\n")}\n\nFormat: \`kills deaths\`, e.g. \`7 2\`.`)],
      components: [retryRow(pending.matchId)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Submit.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await api.submitMatch({ matchId: pending.matchId, players: payloadPlayers });
    deletePending(pending.matchId);
    lastInputs.delete(pending.matchId);

    if (result.kind === "recorded-response-lost") {
      await interaction.editReply({
        embeds: [
          warnEmbed(
            "✅ Match recorded",
            "The match was saved, but the connection dropped before the recap came back. Use `/card` or `/leaderboard` to see the new ratings.",
          ),
        ],
        components: [],
      });
      return;
    }

    await interaction.editReply({ content: "✅ Match recorded — recap posted in the channel.", components: [] });
    await interaction.followUp({
      content: pending.players.map((p) => `<@${p.id}>`).join(" "),
      embeds: [matchRecapEmbed(result.outcome, interaction.user.displayName)],
      allowedMentions: { users: pending.players.map((p) => p.id) },
    });
  } catch (err) {
    const isConflict = err instanceof WorkerApiError && err.status === 409;
    if (isConflict) {
      deletePending(pending.matchId);
      lastInputs.delete(pending.matchId);
    }
    await interaction.editReply({
      embeds: [errorEmbed(err, "Submitting this match")],
      components: isConflict ? [] : [retryRow(pending.matchId)],
    });
  }
}

async function handleButton(interaction: ButtonInteraction, [matchId, action]: string[]): Promise<void> {
  const pending = matchId ? getPending(matchId) : undefined;
  if (!pending) {
    await interaction.update({
      embeds: [warnEmbed("⌛ Submission expired", "Please run the command again.")],
      components: [],
      content: "",
    });
    return;
  }
  if (interaction.user.id !== pending.invokerId) {
    await interaction.reply({ content: "Only the person who started this submission can do that.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "cancel") {
    deletePending(pending.matchId);
    lastInputs.delete(pending.matchId);
    await interaction.update({ embeds: [warnEmbed("🗑️ Submission cancelled", "Nothing was recorded.")], components: [], content: "" });
    return;
  }
  if (action === "retry") {
    await interaction.showModal(buildStatsModal(pending, lastInputs.get(pending.matchId)));
  }
}

export const matchComponentHandler: ComponentHandler = {
  prefix: MATCH_PREFIX,
  modal: handleModal,
  button: handleButton,
};
