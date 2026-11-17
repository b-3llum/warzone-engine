#!/usr/bin/env bash
# Usage: BASE_URL=http://localhost:8787 API_TOKEN=local-dev-token ./scripts/smoke-test.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8787}"
API_TOKEN="${API_TOKEN:-local-dev-token}"
AUTH=(-H "Authorization: Bearer ${API_TOKEN}" -H "Content-Type: application/json")

echo "== 2v2 match =="
curl -sS -X POST "${BASE_URL}/match" "${AUTH[@]}" -d '{
  "matchId": "smoke-2v2-001",
  "players": [
    { "id": "111111111111111111", "name": "Ghost",  "team": 1, "kills": 9, "deaths": 2, "placement": 1, "uptimeSec": 1320 },
    { "id": "222222222222222222", "name": "Soap",   "team": 1, "kills": 4, "deaths": 3, "placement": 1, "uptimeSec": 1100 },
    { "id": "333333333333333333", "name": "Price",  "team": 2, "kills": 6, "deaths": 5, "placement": 2, "uptimeSec": 980  },
    { "id": "444444444444444444", "name": "Gaz",    "team": 2, "kills": 1, "deaths": 6, "placement": 2, "uptimeSec": 640  }
  ]
}'
echo; echo "== 1v1v1v1 FFA match =="
curl -sS -X POST "${BASE_URL}/match" "${AUTH[@]}" -d '{
  "matchId": "smoke-ffa-001",
  "players": [
    { "id": "111111111111111111", "name": "Ghost", "kills": 7, "deaths": 1, "placement": 1, "uptimeSec": 1500 },
    { "id": "333333333333333333", "name": "Price", "kills": 5, "deaths": 3, "placement": 2, "uptimeSec": 1210 },
    { "id": "222222222222222222", "name": "Soap",  "kills": 2, "deaths": 4, "placement": 3, "uptimeSec": 900  },
    { "id": "444444444444444444", "name": "Gaz",   "kills": 0, "deaths": 5, "placement": 4, "uptimeSec": 420  }
  ]
}'
echo; echo "== leaderboard =="
curl -sS "${BASE_URL}/leaderboard"
echo; echo "== player =="
curl -sS "${BASE_URL}/player/111111111111111111"
echo
