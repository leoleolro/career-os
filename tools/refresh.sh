#!/usr/bin/env bash
# Portable refresh chain (cloud routine + any shell): hunt → descriptions → rescore → insights → shortlist → dashboard.
# No macOS notification (see tools/daily.sh for the local variant). Run from anywhere: bash tools/refresh.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT" || exit 1
export PATH="$HOME/.local/lib/node/bin:$PATH"
mkdir -p data/logs
node hunt.mjs --new-only --details 20 --min-score 45 --top 60 > data/logs/last-hunt.json 2> data/logs/last-hunt.err || echo "hunt exited $?"
node tools/details.mjs --top 30 >/dev/null 2>&1 || true
node tools/rescore.mjs >/dev/null 2>&1 || true
node tools/insights.mjs >/dev/null 2>&1 || true
node tools/shortlist.mjs >/dev/null 2>&1 || true
node tools/dashboard.mjs >/dev/null 2>&1 || true
node -e 'const j=require("./data/logs/last-hunt.json");console.log(JSON.stringify({fetched:j.fetched,unique:j.unique,added:j.added,errors:j.errors,topNew:(j.topNew||[]).slice(0,5)}))' 2>/dev/null || cat data/logs/last-hunt.err | tail -5
