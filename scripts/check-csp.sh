#!/bin/bash
# Pre-deploy CSP check: finds inline event handlers injected via innerHTML/template strings.
# These are blocked by script-src 'self' (no unsafe-inline) and will silently fail in the browser.
# Run before `npx wrangler deploy`. Exit code 1 if violations found.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JS_DIR="$ROOT/public/js"

# Fail loudly if the scan target is missing (e.g. a repo restructure moved it),
# rather than scanning nothing and reporting a false pass.
if [ ! -d "$JS_DIR" ]; then
  echo "‼ CSP check: scan directory not found: $JS_DIR"
  exit 1
fi

# Patterns that are CSP violations when used inside template literals / innerHTML strings.
# We look for the attribute name followed by = inside a JS string context (after a backtick or quote).
PATTERN='onclick=|onchange=|oninput=|onsubmit=|onkeyup=|onkeydown=|onfocus=|onblur='

echo "=== CSP inline event handler check ==="
echo "Scanning: $JS_DIR"
echo ""

# Grep all JS files; exclude commented-out lines (lines starting with optional whitespace + //)
HITS=$(grep -rn --include="*.js" -E "$PATTERN" "$JS_DIR" \
  | grep -v '^\s*//' \
  | grep -v "//.*on(click|change|input|submit|keyup|keydown|focus|blur)=" \
  || true)

if [ -z "$HITS" ]; then
  echo "✅  No inline event handler violations found."
  exit 0
fi

echo "❌  Inline event handlers found (CSP will block these):"
echo ""
echo "$HITS"
echo ""
echo "Fix: use addEventListener() after setting innerHTML, with data-* attributes to pass args."
echo "See js/results.js (sep-card / tog-card / sort-chip) for the correct pattern."
echo ""
echo "Note: CICO files (checkin-*.js) still have violations — fix before enforcing CSP on CICO."
exit 1
