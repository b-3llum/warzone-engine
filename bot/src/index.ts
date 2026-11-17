import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerReady } from "./events/ready.js";

// Slash commands, buttons and modals only need the Guilds intent (no privileged intents).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

registerReady(client);
registerInteractionCreate(client);

client.on("error", (err) => console.error("[discord] client error", err));
client.on("warn", (msg) => console.warn("[discord]", msg));

process.on("unhandledRejection", (reason) => console.error("[process] unhandled rejection", reason));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bot] ${signal} received, shutting down`);
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.discordToken);
