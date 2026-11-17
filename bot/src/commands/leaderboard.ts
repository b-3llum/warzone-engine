import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { api } from "../api/client.js";
import { leaderboardEmbed } from "../lib/embeds.js";
import { errorEmbed } from "../lib/errors.js";
import { TIER_BADGE, TIER_FILTER_CHOICES, type TierGroup } from "../lib/tiers.js";
import type { Command } from "./types.js";

export const leaderboard: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the season leaderboard, grouped by tier")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("tier")
        .setDescription("Only show one tier")
        .addChoices(...TIER_FILTER_CHOICES.map((t) => ({ name: `${TIER_BADGE[t]} ${t}`, value: t }))),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const tier = (interaction.options.getString("tier") as TierGroup | null) ?? null;
    await interaction.deferReply();
    try {
      // Fetch the full board and filter locally, so ranks and grouping stay consistent.
      const board = await api.getLeaderboard();
      await interaction.editReply({ embeds: [leaderboardEmbed(board, tier)] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err, "Loading the leaderboard")] });
    }
  },
};
