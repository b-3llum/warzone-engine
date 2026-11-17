import { ActivityType, Events, type Client } from "discord.js";

export function registerReady(client: Client): void {
  client.once(Events.ClientReady, (c) => {
    console.log(`[bot] logged in as ${c.user.tag} — serving ${c.guilds.cache.size} guild(s)`);
    c.user.setActivity("Rebirth Island ratings", { type: ActivityType.Watching });
  });
}
