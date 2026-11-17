import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { startSubmission } from "./submit-shared.js";
import type { Command } from "./types.js";

export const submitFfa: Command = {
  data: new SlashCommandBuilder()
    .setName("submit-ffa")
    .setDescription("Submit a 1v1v1v1 FFA match — list players in finishing order")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName("first").setDescription("🥇 1st place").setRequired(true))
    .addUserOption((o) => o.setName("second").setDescription("🥈 2nd place").setRequired(true))
    .addUserOption((o) => o.setName("third").setDescription("🥉 3rd place").setRequired(true))
    .addUserOption((o) => o.setName("fourth").setDescription("4th place").setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    await startSubmission(interaction, "FFA", [
      { option: "first", placement: 1 },
      { option: "second", placement: 2 },
      { option: "third", placement: 3 },
      { option: "fourth", placement: 4 },
    ]);
  },
};
