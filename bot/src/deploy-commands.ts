/**
 * Registers slash commands with Discord.
 *   GUILD_ID set   → guild commands (update instantly; use for dev / single-server bots)
 *   GUILD_ID empty → global commands (can take up to ~1 hour to propagate)
 * Pass --clear to remove all commands at that scope instead.
 */
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import { config } from "./config.js";

const clear = process.argv.includes("--clear");
const body = clear ? [] : commands.map((c) => c.data.toJSON());
const rest = new REST({ version: "10" }).setToken(config.discordToken);

const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

try {
  const scope = config.guildId ? `guild ${config.guildId}` : "global scope";
  console.log(`${clear ? "Clearing" : "Registering"} ${body.length} command(s) in ${scope}…`);
  const result = (await rest.put(route, { body })) as unknown[];
  console.log(`✅ Done: ${result.length} command(s) active.`);
  for (const c of body) console.log(`   /${c.name}`);
} catch (err) {
  console.error("❌ Failed to deploy commands:", err);
  process.exit(1);
}
