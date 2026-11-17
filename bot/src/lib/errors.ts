import { EmbedBuilder } from "discord.js";
import { WorkerApiError, WorkerNetworkError } from "../api/client.js";
import { ERROR_COLOR, WARN_COLOR } from "./tiers.js";
import { truncate } from "./format.js";

/** Turns any thrown value into a user-facing embed. Internal details are logged, never shown. */
export function errorEmbed(err: unknown, context = "That request"): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(ERROR_COLOR);

  if (err instanceof WorkerNetworkError) {
    return embed
      .setTitle("📡 Rating engine unreachable")
      .setDescription(`${context} couldn't reach the rating engine. Nothing was changed. Please try again in a moment.`);
  }

  if (err instanceof WorkerApiError) {
    switch (true) {
      case err.status === 400: {
        const details = Array.isArray(err.details) ? (err.details as unknown[]).map((d) => `• ${String(d)}`).join("\n") : "";
        return embed
          .setTitle("❌ Match rejected")
          .setDescription(truncate(`The rating engine rejected the data:\n${details || err.message}`, 4000));
      }
      case err.status === 409:
        return embed
          .setColor(WARN_COLOR)
          .setTitle("⚠️ Already submitted")
          .setDescription("This match has already been recorded, so it was not counted again.");
      case err.status === 401 || err.code === "AUTH_NOT_CONFIGURED":
        console.error("[api] auth failure — check API_TOKEN matches the Worker secret", err);
        return embed
          .setTitle("🔒 Bot misconfigured")
          .setDescription("The bot's API token was rejected by the rating engine. Please tell a server admin.");
      case err.status === 404:
        return embed.setTitle("🔍 Not found").setDescription(err.message);
      case err.status === 429:
        return embed.setTitle("⏳ Slow down").setDescription("The rating engine is rate-limiting requests. Try again shortly.");
      default:
        console.error("[api] unexpected error", err);
        return embed
          .setTitle("💥 Rating engine error")
          .setDescription(`${context} failed (HTTP ${err.status}, \`${err.code}\`). Nothing was changed if this was a submission; please retry.`);
    }
  }

  console.error("[bot] unexpected error", err);
  return embed.setTitle("💥 Something went wrong").setDescription(`${context} failed unexpectedly. Please try again.`);
}

export function warnEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(WARN_COLOR).setTitle(title).setDescription(description);
}
