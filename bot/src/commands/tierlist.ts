import { AttachmentBuilder, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { api } from "../api/client.js";
import { loadAvatars } from "../lib/avatars.js";
import { errorEmbed, warnEmbed } from "../lib/errors.js";
import { renderTierList } from "../lib/tierlist.js";
import type { Command } from "./types.js";

export const tierlist: Command = {
  data: new SlashCommandBuilder()
    .setName("tierlist")
    .setDescription("Post the season tier list as an image")
    .setContexts(InteractionContextType.Guild)
    .addBooleanOption((o) =>
      o.setName("calibrating").setDescription("Include players still in calibration (default: yes)"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const includeCalibrating = interaction.options.getBoolean("calibrating") ?? true;
    await interaction.deferReply();
    try {
      const board = await api.getLeaderboard();
      if (board.players.length === 0) {
        await interaction.editReply({
          embeds: [warnEmbed("No players yet", "No matches recorded this season. Use `/submit-2v2` or `/submit-ffa` to get started!")],
        });
        return;
      }

      const updated = new Date(board.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const shown = includeCalibrating ? board.players : board.players.filter((p) => p.calibrated);
      const avatars = await loadAvatars(interaction.client, shown.map((p) => p.id));
      const png = renderTierList(board.players, {
        avatars,
        title: "Tier List WZ",
        subtitle: `ranking · ${board.totalPlayers} players · ${board.totalMatches} matches · ${updated}`,
        includeCalibrating,
      });
      await interaction.editReply({ files: [new AttachmentBuilder(png, { name: "tierlist.png" })] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err, "Building the tier list")] });
    }
  },
};
