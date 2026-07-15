#!/bin/bash
# Security agent — deterministic deploy-exposure + allowlist checks.
#
# Ground truth is the LIVE site, not local repo state: a passing local
# .assetsignore check does not prove nothing leaked (the deploy asset dir
# used to be the whole repo root — see docs/security-agent-plan.md and
# the Jul 2026 incident it documents). Every path below curls
# https://cohortlogic.com directly and must resolve 404.
#
# Output: a single JSON array on stdout, one object per check —
#   { check_id, category, severity, title, detail, evidence, pass }
# Human-readable progress goes to stderr so stdout stays parseable.
# Exit code is always 0 — failures are reported as findings, not shell
# failures; the calling agent decides what to do with `pass: false`.
#
# Usage: bash scripts/security-audit.sh [base_url]
#   base_url defaults to https://cohortlogic.com

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${1:-https://cohortlogic.com}"

log() { echo "$@" >&2; }

log "=== Security audit: deploy exposure + allowlist ==="
log "Target: $BASE_URL"
log ""

results=()

# ─────────────────────────────────────────────────────────────────────
# Deploy exposure — every path below MUST 404 on the live site.
# ─────────────────────────────────────────────────────────────────────

EXPOSURE_PATHS=(
  "/.git/config"
  "/.qa-credentials"
  "/.claude/settings.json"
  "/CLAUDE.md"
  "/wrangler.toml"
  "/scripts/deploy.sh"
  "/supabase/migrations/school_admin_roles.sql"
  "/.env.security"
  "/.env"
  "/.dev.vars"
  "/security/rotation-manifest.json"
)

for path in "${EXPOSURE_PATHS[@]}"; do
  url="${BASE_URL}${path}"
  status=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
  slug=$(echo "$path" | sed 's/^\///; s/[\/\.]/-/g')
  check_id="deploy.exposure.${slug}"

  if [ "$status" = "404" ]; then
    pass=true
    log "  ✓  $path → 404"
  else
    pass=false
    log "  ✗  $path → $status (expected 404)"
  fi

  results+=("$(jq -n \
    --arg check_id "$check_id" \
    --arg title "Secret/infra path exposed: $path" \
    --arg detail "Expected 404 for $url, got HTTP $status. If this is not 404, treat as a live credential/source exposure incident — see docs/security-agent-plan.md." \
    --arg url "$url" \
    --arg status "$status" \
    --argjson pass "$pass" \
    '{
      check_id: $check_id,
      category: "deploy_exposure",
      severity: (if $pass then "info" else "critical" end),
      title: $title,
      detail: $detail,
      evidence: { url: $url, http_status: $status },
      pass: $pass
    }')")
done

# ─────────────────────────────────────────────────────────────────────
# Allowlist integrity — wrangler.toml must still deploy only public/,
# and no obviously-sensitive file should have crept into public/.
# ─────────────────────────────────────────────────────────────────────

log ""
log "=== Allowlist integrity ==="

WRANGLER_TOML="$ROOT/wrangler.toml"
if [ -f "$WRANGLER_TOML" ] && grep -q '^\s*directory\s*=\s*"public"' "$WRANGLER_TOML"; then
  wrangler_pass=true
  log "  ✓  wrangler.toml directory = \"public\""
else
  wrangler_pass=false
  log "  ✗  wrangler.toml does not deploy from public/ — full repo may be exposed again"
fi

results+=("$(jq -n \
  --argjson pass "$wrangler_pass" \
  '{
    check_id: "deploy.allowlist.wrangler-directory",
    category: "deploy_exposure",
    severity: (if $pass then "info" else "critical" end),
    title: "wrangler.toml asset directory",
    detail: "wrangler.toml [assets] directory must be \"public\" — reverting to \".\" deploys the whole repo (incl. .git, secrets) publicly, as happened in Jul 2026.",
    evidence: {},
    pass: $pass
  }')")

PUBLIC_DIR="$ROOT/public"
SENSITIVE_HITS=""
if [ -d "$PUBLIC_DIR" ]; then
  SENSITIVE_HITS=$(find "$PUBLIC_DIR" \( -name ".git" -o -name ".env*" -o -name "*.credentials" -o -name "CLAUDE.md" -o -name ".qa-credentials" \) 2>/dev/null || true)
fi

if [ -z "$SENSITIVE_HITS" ]; then
  sensitive_pass=true
  log "  ✓  no sensitive files found under public/"
else
  sensitive_pass=false
  log "  ✗  sensitive files found under public/:"
  log "$SENSITIVE_HITS"
fi

results+=("$(jq -n \
  --argjson pass "$sensitive_pass" \
  --arg hits "$SENSITIVE_HITS" \
  '{
    check_id: "deploy.allowlist.public-dir-clean",
    category: "deploy_exposure",
    severity: (if $pass then "info" else "high" end),
    title: "No secret/infra files under public/",
    detail: "public/ is the deploy allowlist — anything placed here is served publicly regardless of .gitignore.",
    evidence: { hits: $hits },
    pass: $pass
  }')")

log ""
log "=== Done — emitting JSON to stdout ==="

jq -n --argjson items "$(printf '%s\n' "${results[@]}" | jq -s '.')" '$items'
