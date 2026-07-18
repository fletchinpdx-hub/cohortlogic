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

# Supabase REST target for the anonymous RLS probe. The publishable key is
# designed to be public (it ships in every client JS file — RLS is the
# protection, not key secrecy); hardcoding it here is intentional, NOT a leak.
# Both are overridable via env for a staging run.
SB_URL="${SUPABASE_URL:-https://dlqnzlwuzktcljxxxlit.supabase.co}"
ANON_KEY="${SUPABASE_ANON_KEY:-sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe}"

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

# ─────────────────────────────────────────────────────────────────────
# Security headers — the _headers file sets these, but Cloudflare config
# drift or a bad deploy can silently drop them. Verify they're actually on
# the LIVE response (same ground-truth-is-prod principle as the exposure
# checks above). One request, several assertions.
# ─────────────────────────────────────────────────────────────────────

log ""
log "=== Security headers (live response) ==="

HDRS=$(curl -sSL -o /dev/null -D - --max-time 10 "$BASE_URL/" 2>/dev/null | tr -d '\r' || true)
get_header() { echo "$HDRS" | grep -i "^$1:" | head -1 | sed "s/^[^:]*:[[:space:]]*//I"; }

# name|severity-if-missing|human title
HEADER_CHECKS=(
  "content-security-policy|high|Content-Security-Policy present"
  "x-frame-options|high|X-Frame-Options present (clickjacking)"
  "x-content-type-options|medium|X-Content-Type-Options: nosniff present"
  "referrer-policy|medium|Referrer-Policy present"
  "permissions-policy|medium|Permissions-Policy present"
)

for entry in "${HEADER_CHECKS[@]}"; do
  IFS='|' read -r hname hsev htitle <<< "$entry"
  hval=$(get_header "$hname")
  slug=$(echo "$hname" | sed 's/[^a-z0-9]/-/g')
  if [ -n "$hval" ]; then
    hpass=true
    log "  ✓  $hname present"
  else
    hpass=false
    log "  ✗  $hname MISSING on live response"
  fi
  results+=("$(jq -n \
    --arg check_id "headers.${slug}" \
    --arg title "$htitle" \
    --arg sev "$hsev" \
    --arg detail "Security header '$hname' must be present on the live response (set via public/_headers, applied by Cloudflare). Missing = the header silently dropped in prod." \
    --arg val "$hval" \
    --argjson pass "$hpass" \
    '{
      check_id: $check_id,
      category: "security_headers",
      severity: (if $pass then "info" else $sev end),
      title: $title,
      detail: $detail,
      evidence: { header: $check_id, present: $pass },
      pass: $pass
    }')")
done

# CSP script-src must NOT carry unsafe-inline (style-src intentionally does —
# documented as permanent in CLAUDE.md; this check is script-src ONLY).
CSP=$(get_header content-security-policy)
SCRIPT_SRC=$(echo "$CSP" | tr ';' '\n' | grep -i 'script-src' || true)
if echo "$SCRIPT_SRC" | grep -qi "unsafe-inline"; then
  csp_pass=false
  log "  ✗  CSP script-src contains 'unsafe-inline' — XSS protection defeated"
else
  csp_pass=true
  log "  ✓  CSP script-src has no 'unsafe-inline'"
fi
results+=("$(jq -n \
  --argjson pass "$csp_pass" \
  --arg script_src "$SCRIPT_SRC" \
  '{
    check_id: "headers.csp-script-no-unsafe-inline",
    category: "security_headers",
    severity: (if $pass then "info" else "high" end),
    title: "CSP script-src excludes unsafe-inline",
    detail: "script-src must never include unsafe-inline — the whole site was migrated off inline handlers to allow this. style-src unsafe-inline is intentional and NOT checked here.",
    evidence: { script_src: $script_src },
    pass: $pass
  }')")

# ─────────────────────────────────────────────────────────────────────
# Anonymous RLS effectiveness probe — reading policy DEFINITIONS (agent
# step 2) proves they're configured; this proves they WORK. Hit the REST
# API with the public publishable key as an unauthenticated caller and
# assert every PII table returns zero rows. A row here = a live student-data
# leak, the worst-case FERPA failure. Count-only (Content-Range) so no PII
# is ever pulled into the body or stored in a finding.
# ─────────────────────────────────────────────────────────────────────

log ""
log "=== Anonymous RLS probe (public key must see zero PII rows) ==="

PII_TABLES=(
  students cico_checkins cico_period_scores cico_incidents profiles
  referral_referrals audit_log feedback contact_submissions
  newsletter_subscribers subscriptions security_findings
)

for t in "${PII_TABLES[@]}"; do
  tmp=$(mktemp)
  code=$(curl -s -o /dev/null -D "$tmp" -w '%{http_code}' --max-time 10 \
    "$SB_URL/rest/v1/$t?select=id" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null || echo "000")
  cr=$(grep -i '^content-range:' "$tmp" | tr -d '\r' | sed 's/.*\///')
  rm -f "$tmp"

  if [ "$code" = "200" ] && [[ "$cr" =~ ^[0-9]+$ ]] && [ "$cr" -eq 0 ]; then
    ap_pass=true; ap_sev="info"; ap_note="anon read returned 0 rows (RLS blocks)"
    log "  ✓  $t → 0 rows"
  elif [ "$code" = "200" ] && [[ "$cr" =~ ^[0-9]+$ ]] && [ "$cr" -gt 0 ]; then
    ap_pass=false; ap_sev="critical"; ap_note="anon read returned $cr row(s) — PII readable with the PUBLIC key"
    log "  ✗  $t → $cr rows EXPOSED to anon (critical)"
  elif [ "$code" = "401" ] || [ "$code" = "403" ]; then
    ap_pass=true; ap_sev="info"; ap_note="anon read rejected (HTTP $code — RLS/permission blocks)"
    log "  ✓  $t → HTTP $code (blocked)"
  else
    ap_pass=false; ap_sev="medium"; ap_note="anon probe inconclusive (HTTP $code, count '$cr') — table may be renamed or 'id' column changed; verify manually"
    log "  ⚠  $t → inconclusive (HTTP $code, count '$cr')"
  fi

  results+=("$(jq -n \
    --arg check_id "rls.anon-read.$t" \
    --arg title "Anon cannot read $t" \
    --arg detail "With the public publishable key and no auth, $t must return zero rows. $ap_note." \
    --arg sev "$ap_sev" \
    --arg code "$code" \
    --arg cr "$cr" \
    --argjson pass "$ap_pass" \
    '{
      check_id: $check_id,
      category: "rls_audit",
      severity: (if $pass then "info" else $sev end),
      title: $title,
      detail: $detail,
      evidence: { table: ($check_id | sub("rls.anon-read."; "")), http_status: $code, anon_row_count: $cr },
      pass: $pass
    }')")
done

log ""
log "=== Done — emitting JSON to stdout ==="

jq -n --argjson items "$(printf '%s\n' "${results[@]}" | jq -s '.')" '$items'
