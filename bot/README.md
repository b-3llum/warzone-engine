# Warzone Rebirth Rating Bot

discord.js v14 + TypeScript frontend for the rating engine Worker in the repository root.

## Commands
| Command | Who | What |
|---|---|---|
| `/leaderboard [tier]` | everyone | Season leaderboard grouped by tier: Elo, KPG, last delta |
| `/card [user]` | everyone | Career card: tier, Elo, peak, KPG, K/D, wins, last-5 sparkline |
| `/submit-2v2` | everyone, or `SUBMITTER_ROLE_ID` | Pick 4 players + team placements → modal for stats → recap |
| `/submit-ffa` | everyone, or `SUBMITTER_ROLE_ID` | Pick players in finishing order → modal for stats → recap |
| `/reset-season` | Administrator | Confirm button → archive + wipe season → announcement |

Stats modal: one line per player, `kills deaths uptime`. Uptime can be seconds (`750`), `mm:ss` (`12:30`) or `h:mm:ss`.
Separators can be spaces, commas or slashes: `7 2 12:30`, `7/2/750`.

## Setup
1. Create an application at https://discord.com/developers/applications, add a bot, copy its token and the application ID.
2. Invite it with the `bot` and `applications.commands` scopes (no privileged intents needed).
3. Configure and run:

```bash
cd bot
npm install
cp .env.example .env   # fill in values; API_TOKEN must equal the Worker's API_TOKEN secret
npm run deploy-commands
npm run dev            # or: npm run build && npm start
```

## Layout
```
src/
  index.ts                 client bootstrap, graceful shutdown
  deploy-commands.ts       registers slash commands (guild if GUILD_ID set, else global; --clear to remove)
  config.ts                .env loading + validation
  api/client.ts            Worker HTTP client: timeouts, retries, typed errors
  api/types.ts             Worker request/response types
  commands/                one file per slash command + shared submission flow
  events/                  ready + interactionCreate router
  lib/                     embeds, tier badges, stat parsing, pending-submission store, error embeds
```

## Notes
- `matchId` is the slash command's `interaction.id`, so retries never double-count a match. A 409 on a retry is reported as "recorded".
- Pending submissions (between the slash command and the modal) live in memory for 15 minutes. If the bot restarts mid-submission, the user re-runs the command.
- Run a single bot instance: the pending-submission store is per process.
