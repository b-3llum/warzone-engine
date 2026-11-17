# Warzone Rebirth Rating Engine (Cloudflare Worker)

## Setup
    npm install
    npx wrangler login
    npx wrangler kv namespace create WARZONE_RATINGS            # copy id -> wrangler.toml `id`
    npx wrangler kv namespace create WARZONE_RATINGS --preview  # copy id -> wrangler.toml `preview_id`
    npx wrangler secret put API_TOKEN
    npm run typecheck
    npx wrangler deploy

## Local dev
    echo 'API_TOKEN="local-dev-token"' > .dev.vars
    npx wrangler dev
    ./scripts/smoke-test.sh

## Endpoints
- GET  /health
- GET  /leaderboard[?tier=A%2B]
- GET  /player/:id
- POST /match         (Authorization: Bearer <API_TOKEN>)
- POST /reset-season  (Authorization: Bearer <API_TOKEN>, optional body {"archive": true})
