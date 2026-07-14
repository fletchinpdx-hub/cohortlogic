#!/bin/bash
# Tier 1 pre-deploy gate — fast, no browser. Runs on EVERY deploy.
#
# Bundles the cheap static/logic checks that have caught (or would have caught)
# real production regressions in this project:
#   1. CSP inline-handler check   — onclick= in innerHTML is silently CSP-blocked
#   2. Cache-version consistency  — mismatched ?v= tags ship a half-stale app
#   3. Secret-exposure check      — .git/.qa-credentials must not deploy publicly
#   4. Algorithm unit tests       — silent class-assignment regressions
#
# All are sub-second and immune to UI churn. Exits non-zero if any fail, which
# aborts scripts/deploy.sh before it calls wrangler.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

status=0

run() {
  local label="$1"; shift
  echo ""
  echo "──────────────────────────────────────────────"
  echo "▶ $label"
  echo "──────────────────────────────────────────────"
  if ! "$@"; then
    status=1
    echo "‼ $label FAILED"
  fi
}

run "1/4  CSP inline-handler check"   bash scripts/check-csp.sh
run "2/4  Cache-version consistency"  bash scripts/check-versions.sh
run "3/4  Secret-exposure check"      bash scripts/check-assetsignore.sh
run "4/4  Algorithm unit tests"       node tests/algorithm.test.js

echo ""
echo "═══════════════════════════════════════════════"
if [ "$status" -ne 0 ]; then
  echo "❌  PRE-DEPLOY GATE FAILED — fix the above before deploying."
else
  echo "✅  PRE-DEPLOY GATE PASSED"
fi
echo "═══════════════════════════════════════════════"
exit "$status"
