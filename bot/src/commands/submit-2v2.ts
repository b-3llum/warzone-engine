import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { startSubmission } from "./submit-shared.js";
import type { Command } from "./types.js";

const placementChoices = [1, 2, 3, 4].map((n) => ({ name: ["1st", "2nd", "3rd", "4th"][n - 1]!, value: n }));

export const submit2v2: Command = {
  data: new SlashCommandBuilder()
    .setName("submit-2v2")
    .setDescription("Submit a 2v2 Warzone Rebirth match (you'll enter kills/deaths/uptime next)")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName("team1_player1").setDescription("Team 1 — first player").setRequired(true))
    .addUserOption((o) => o.setName("team1_player2").setDescription("Team 1 — second player").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("team1_placement").setDescription("Team 1 final placement").setRequired(true).addChoices(...placementChoices),
    )
    .addUserOption((o) => o.setName("team2_player1").setDescription("Team 2 — first player").setRequired(true))
    .addUserOption((o) => o.setName("team2_player2").setDescription("Team 2 — second player").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("team2_placement").setDescription("Team 2 final placement").setRequired(true).addChoices(...placementChoices),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const t1 = interaction.options.getInteger("team1_placement", true);
    const t2 = interaction.options.getInteger("team2_placement", true);
    await startSubmission(interaction, "2v2", [
      { option: "team1_player1", team: 1, placement: t1 },
      { option: "team1_player2", team: 1, placement: t1 },
      { option: "team2_player1", team: 2, placement: t2 },
      { option: "team2_player2", team: 2, placement: t2 },
    ]);
  },
};
