import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { api } from "../api/client.js";
import { errorEmbed, warnEmbed } from "../lib/errors.js";
import { BRAND_COLOR } from "../lib/tiers.js";
import type { Command } from "./types.js";

const CONFIRM_TIMEOUT_MS = 30_000;

export const resetSeason: Command = {
  data: new SlashCommandBuilder()
    .setName("reset-season")
    .setDescription("ADMIN: archive the current season and wipe all ratings")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defence in depth: default permissions can be overridden per-guild by admins.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "🔒 Only server administrators can reset the season.", flags: MessageFlags.Ephemeral });
      return;
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("reset:confirm").setLabel("Yes, reset the season").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("reset:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );

    const prompt = await interaction.reply({
      embeds: [
        warnEmbed(
          "⚠️ Reset the season?",
          "This archives the current season and **wipes every player's Elo, tier and history**. This can't be undone from Discord.",
        ),
      ],
      components: [row],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    const message = prompt.resource?.message;
    if (!message) return;

    let click;
    try {
      click = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: CONFIRM_TIMEOUT_MS,
      });
    } catch {
      await interaction.editReply({ embeds: [warnEmbed("⌛ Timed out", "Season reset cancelled.")], components: [] });
      return;
    }

    if (click.customId === "reset:cancel") {
      await click.update({ embeds: [warnEmbed("Cancelled", "The season was not reset.")], components: [] });
      return;
    }

    await click.update({ embeds: [warnEmbed("⏳ Resetting…", "Archiving and clearing the season.")], components: [] });
    try {
      const result = await api.resetSeason(true);
      await interaction.editReply({ embeds: [warnEmbed("✅ Done", "Season reset. Announcement posted.")] });
      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle("🔄 New season started!")
            .setDescription("All ratings have been reset to **1500**. Everyone is back in calibration — good luck!")
            .addFields(
              { name: "Players archived", value: String(result.playersCleared), inline: true },
              { name: "Matches archived", value: String(result.matchesCleared), inline: true },
            )
            .setFooter({ text: `Reset by ${interaction.user.displayName} · previous season ${result.previousSeasonId.slice(0, 8)}` })
            .setTimestamp(),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err, "Resetting the season")] });
    }
  },
};
