import { card } from "./card.js";
import { leaderboard } from "./leaderboard.js";
import { resetSeason } from "./reset-season.js";
import { submit2v2 } from "./submit-2v2.js";
import { submitFfa } from "./submit-ffa.js";
import { tierlist } from "./tierlist.js";
import { matchComponentHandler } from "./submit-shared.js";
import type { Command, ComponentHandler } from "./types.js";

export const commands: readonly Command[] = [leaderboard, tierlist, card, submit2v2, submitFfa, resetSeason];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

export const componentHandlers = new Map<string, ComponentHandler>([[matchComponentHandler.prefix, matchComponentHandler]]);
