#!/bin/bash
# Pre-deploy cache-version check: CONSISTENCY + COVERAGE.
#
# Each app HTML cache-busts its assets with `?v=NNN` query strings and the rule
# is "bump ALL on every deploy" (see CLAUDE.md). Miss one tag and users get a
# half-stale app — new HTML with an old cached script, or vice versa.
#
# Two assertions per file:
#   1. CONSISTENCY — every `?v=` value in the file is identical.
#   2. COVERAGE    — every LOCAL .js/.css tag actually carries a `?v=`.
#
# Coverage exists because consistency alone is vacuous: a file where only one tag
# is versioned trivially "passes" while every other asset rides default browser
# caching, so a JS change silently serves stale code to returning users. That was
# real — CICO/Referrals/Dashboard versioned only feedback.js (1 of 9/10/3 tags),
# app.html left auth-gate.js unversioned, and both admin panels weren't checked at
# all. Same failure class as the CSP-handler regression that sat dead in prod.
# Consistency without coverage is a green light on an unguarded app. Don't drop it.
#
# Absolute/CDN URLs (https://…) are exempt — they're versioned in the URL itself.
# Exit 1 if any file mixes versions or leaves a local asset unversioned.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Every served HTML that loads local js/css. Adding a new app? Add it here.
FILES=(public/app.html public/schedule-app.html public/checkin-app.html \
       public/referral-app.html public/dashboard.html public/login.html \
       public/admin/index.html public/school-admin/index.html)

echo "=== Cache-version check (consistency + coverage) ==="

fail=0
for rel in "${FILES[@]}"; do
  f="$ROOT/$rel"
  # Fail loudly on a missing expected file (e.g. a restructure moved it) instead
  # of silently skipping and reporting a false pass.
  if [ ! -f "$f" ]; then
    echo "  ‼  $rel — expected file not found"
    fail=1
    continue
  fi

  # COVERAGE: local .js/.css tags with no ?v= at all. Skip absolute/CDN URLs.
  unversioned=$(grep -oE '(src|href)="[^"]+\.(js|css)"' "$f" 2>/dev/null \
    | grep -v '://' | sed -E 's/^(src|href)="//; s/"$//' | sort -u || true)
  ucount=$(printf '%s\n' "$unversioned" | grep -c . || true)

  # CONSISTENCY: extract every ?v=VALUE from src=/href= attributes.
  versions=$(grep -oE '(src|href)="[^"]*\?v=[^"&]+' "$f" 2>/dev/null \
    | sed -E 's/.*\?v=//' | sort -u)
  count=$(printf '%s\n' "$versions" | grep -c . || true)

  if [ "$ucount" -ne 0 ]; then
    echo "  ✗  $rel — $ucount local asset(s) missing ?v= (would serve stale to cached users):"
    printf '        %s\n' $unversioned
    fail=1
  elif [ "$count" -eq 0 ]; then
    # No local js/css at all AND no versioned tags — nothing to cache-bust.
    echo "  –  $rel (no local js/css assets)"
  elif [ "$count" -eq 1 ]; then
    echo "  ✓  $rel (all tags versioned, at ?v=$versions)"
  else
    echo "  ✗  $rel mixes versions:"
    printf '        %s\n' $versions
    fail=1
  fi
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌  Cache-bust problem. Every local .js/.css tag in the flagged file(s) needs a"
  echo "    ?v=, and all of them must share the same value. Bump them together."
  exit 1
fi
echo "✅  Every local asset is versioned, and each file is internally consistent."
