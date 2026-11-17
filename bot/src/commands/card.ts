import { EmbedBuilder, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { api } from "../api/client.js";
import { playerCardEmbed } from "../lib/embeds.js";
import { errorEmbed } from "../lib/errors.js";
import { BRAND_COLOR } from "../lib/tiers.js";
import type { Command } from "./types.js";

export const card: Command = {
  data: new SlashCommandBuilder()
    .setName("card")
    .setDescription("Show a player's career card")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName("user").setDescription("Player to look up (defaults to you)")),

  async execute(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    await interaction.deferReply();
    try {
      const player = await api.getPlayer(user.id);
      if (!player) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(BRAND_COLOR)
              .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
              .setDescription(`${user.id === interaction.user.id ? "You haven't" : `<@${user.id}> hasn't`} played a rated match this season yet.`),
          ],
          allowedMentions: { parse: [] },
        });
        return;
      }
      await interaction.editReply({ embeds: [playerCardEmbed(player, user.displayAvatarURL())] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err, "Loading that card")] });
    }
  },
};
