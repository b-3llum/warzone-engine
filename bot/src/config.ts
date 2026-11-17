import "dotenv/config";

export interface BotConfig {
  discordToken: string;
  clientId: string;
  guildId: string | null;
  workerApiBase: string;
  apiToken: string;
  submitterRoleId: string | null;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function loadConfig(): BotConfig {
  const base = required("WORKER_API_BASE").replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`WORKER_API_BASE is not a valid URL: ${base}`);
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("WORKER_API_BASE must use https:// (http is only allowed for localhost).");
  }

  return {
    discordToken: required("DISCORD_TOKEN"),
    clientId: required("CLIENT_ID"),
    guildId: optional("GUILD_ID"),
    workerApiBase: base,
    apiToken: required("API_TOKEN"),
    submitterRoleId: optional("SUBMITTER_ROLE_ID"),
  };
}

export const config: BotConfig = loadConfig();
