/**
 * Fetches Discord avatars for tier-list tiles.
 * Avatar URLs contain a content hash, so a downloaded image can be cached by URL safely.
 */

import { loadImage, type Image } from "@napi-rs/canvas";
import type { Client } from "discord.js";

const CACHE_LIMIT = 500;
const CONCURRENCY = 6;
const TIMEOUT_MS = 5_000;
const imageCache = new Map<string, Image>();

async function download(url: string): Promise<Image | null> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    if (imageCache.size >= CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value!);
    imageCache.set(url, img);
    return img;
  } catch {
    return null;
  }
}

/** Returns a map of Discord user ID → avatar image. Users that can't be resolved are simply left out. */
export async function loadAvatars(client: Client, userIds: string[]): Promise<Map<string, Image>> {
  const result = new Map<string, Image>();
  const queue = [...new Set(userIds)];

  async function worker(): Promise<void> {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (!/^\d{15,22}$/.test(id)) continue; // not a Discord snowflake (e.g. test data)
      try {
        const user = await client.users.fetch(id); // served from cache after the first time
        const img = await download(user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }));
        if (img) result.set(id, img);
      } catch {
        // Unknown user or network error: the tile falls back to text only.
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}
