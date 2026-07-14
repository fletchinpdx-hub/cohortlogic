#!/bin/bash
# Pre-deploy secret-exposure check.
#
# wrangler.toml deploys the ENTIRE project root (`[assets] directory = "."`), so
# anything not listed in .assetsignore is served publicly at cohortlogic.com/<path>.
# In Jul 2026 this exposed .git/config (push token) and .qa-credentials (QA
# password) on the live site. This asserts .assetsignore exists and still covers
# every sensitive path so that exposure can't silently regress.
#
# Exit 1 if .assetsignore is missing or any required entry is absent.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IGNORE="$ROOT/.assetsignore"

echo "=== Secret-exposure (.assetsignore) check ==="

if [ ! -f "$IGNORE" ]; then
  echo "❌  .assetsignore is MISSING — the whole repo (incl. .git + secrets) would deploy publicly."
  exit 1
fi

# Paths that must be present (exact-line match against .assetsignore).
REQUIRED=(.git .qa-credentials .claude .dev.vars .env .wrangler)

fail=0
for entry in "${REQUIRED[@]}"; do
  if grep -qxF "$entry" "$IGNORE"; then
    echo "  ✓  $entry excluded"
  else
    echo "  ✗  $entry NOT in .assetsignore — would be served publicly"
    fail=1
  fi
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌  .assetsignore is missing required exclusions. Add them before deploying."
  exit 1
fi
echo "✅  All sensitive paths are excluded from public deploy."
