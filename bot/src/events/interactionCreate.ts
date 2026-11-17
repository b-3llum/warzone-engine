import { Events, MessageFlags, type Client, type Interaction, type RepliableInteraction } from "discord.js";
import { commandMap, componentHandlers } from "../commands/index.js";
import { errorEmbed } from "../lib/errors.js";

/** Last-resort error reply that works whether or not the interaction was already acknowledged. */
async function safeErrorReply(interaction: RepliableInteraction, err: unknown): Promise<void> {
  const payload = { embeds: [errorEmbed(err, "That command")], components: [] };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (replyErr) {
    console.error("[bot] failed to send error reply", replyErr);
  }
}

export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) {
          console.warn(`[bot] unknown command /${interaction.commandName} — re-run deploy-commands?`);
          return;
        }
        await command.execute(interaction);
        return;
      }

      if (interaction.isModalSubmit() || interaction.isButton()) {
        const [prefix, ...args] = interaction.customId.split(":");
        const handler = prefix ? componentHandlers.get(prefix) : undefined;
        if (!handler) return; // e.g. reset:* buttons are collected inline by their command
        if (interaction.isModalSubmit() && handler.modal) await handler.modal(interaction, args);
        else if (interaction.isButton() && handler.button) await handler.button(interaction, args);
      }
    } catch (err) {
      console.error(`[bot] interaction ${interaction.id} failed`, err);
      if (interaction.isRepliable()) await safeErrorReply(interaction, err);
    }
  });
}
