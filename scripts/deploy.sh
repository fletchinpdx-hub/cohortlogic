#!/bin/bash
# Deploy wrapper — runs the Tier 1 pre-deploy gate, then deploys.
#
# Use this INSTEAD of `npx wrangler deploy` so the gate can never be skipped:
#
#     ./scripts/deploy.sh
#
# If any check fails, the deploy is aborted. Pass --skip-gate ONLY in a genuine
# emergency (you own the consequences).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--skip-gate" ]; then
  echo "⚠  Skipping pre-deploy gate (--skip-gate). Deploying without checks."
else
  bash scripts/predeploy.sh
fi

echo ""
echo "▶ Deploying with wrangler…"
npx wrangler deploy
