#!/bin/bash
# Pre-deploy cache-version consistency check.
#
# Each app HTML cache-busts its assets with `?v=NNN` query strings and the rule
# is "bump ALL on every deploy" (see CLAUDE.md). Miss one tag and users get a
# half-stale app — new HTML with an old cached script, or vice versa. This asserts
# that within each HTML file, every `?v=` value is identical.
#
# Exit 1 if any file mixes versions. Files with no `?v=` tags are skipped (they
# don't use cache-busting — that's a choice, not an error).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# HTML files that carry versioned asset tags (served from public/).
FILES=(public/app.html public/schedule-app.html public/checkin-app.html public/referral-app.html public/dashboard.html public/login.html)

echo "=== Cache-version consistency check ==="

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

  # Extract every ?v=VALUE from src=/href= attributes.
  versions=$(grep -oE '(src|href)="[^"]*\?v=[^"&]+' "$f" 2>/dev/null \
    | sed -E 's/.*\?v=//' | sort -u)

  count=$(printf '%s\n' "$versions" | grep -c . || true)

  if [ "$count" -eq 0 ]; then
    echo "  –  $rel (no versioned tags, skipped)"
  elif [ "$count" -eq 1 ]; then
    echo "  ✓  $rel (all tags at ?v=$versions)"
  else
    echo "  ✗  $rel mixes versions:"
    printf '        %s\n' $versions
    fail=1
  fi
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌  Mismatched cache-bust versions. Bump ALL asset tags in the flagged file(s) to the same value before deploying."
  exit 1
fi
echo "✅  All versioned HTML files are internally consistent."
