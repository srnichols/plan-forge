#!/usr/bin/env bash
# Memory-QA smoke test — verifies v2.95.0 memory-upgrade tools are present and wired.
# Exit code = number of failing checks.
# Output format: [OK|FAIL|SKIP] <check-name> [- <reason>]
#
# Env overrides:
#   PFORGE_MCP_PORT  — MCP server port (default: 3100)
#   OPENBRAIN_URL    — if set, checks OpenBrain /health for provenance capability

set -uo pipefail

PASS=0
FAIL=0
SKIP=0
FAIL_NAMES=()

ok()   { echo "[OK]   $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1 - $2"; FAIL=$((FAIL+1)); FAIL_NAMES+=("$1"); }
skip() { echo "[SKIP] $1 - $2"; SKIP=$((SKIP+1)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║   Plan Forge — Memory QA Smoke (v2.95.0)           ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# ── MCP server availability ───────────────────────────────────────────
MCP_PORT="${PFORGE_MCP_PORT:-3100}"
MCP_AVAILABLE=false
if curl -sf --max-time 2 "http://localhost:${MCP_PORT}/api/health" >/dev/null 2>&1; then
    MCP_AVAILABLE=true
fi

# ── Check 1: pforge anvil stat ────────────────────────────────────────
if $MCP_AVAILABLE; then
    if bash "$REPO_ROOT/pforge.sh" anvil stat >/dev/null 2>&1; then
        ok "pforge-anvil-stat"
    else
        fail "pforge-anvil-stat" "pforge anvil stat exited non-zero"
    fi
else
    skip "pforge-anvil-stat" "MCP server not running on port $MCP_PORT"
fi

# ── Check 2: pforge hallmark show ────────────────────────────────────
if $MCP_AVAILABLE; then
    if bash "$REPO_ROOT/pforge.sh" hallmark show >/dev/null 2>&1; then
        ok "pforge-hallmark-show"
    else
        fail "pforge-hallmark-show" "pforge hallmark show exited non-zero"
    fi
else
    skip "pforge-hallmark-show" "MCP server not running on port $MCP_PORT"
fi

# ── Check 3: pforge lattice stat ─────────────────────────────────────
if $MCP_AVAILABLE; then
    if bash "$REPO_ROOT/pforge.sh" lattice stat >/dev/null 2>&1; then
        ok "pforge-lattice-stat"
    else
        fail "pforge-lattice-stat" "pforge lattice stat exited non-zero"
    fi
else
    skip "pforge-lattice-stat" "MCP server not running on port $MCP_PORT"
fi

# ── Check 4: tools.json lists the 15 v2.95.0 tools ───────────────────
TOOLS_JSON="$REPO_ROOT/pforge-mcp/tools.json"
EXPECTED_TOOLS=(
    forge_testbed_run forge_testbed_findings forge_testbed_happypath
    forge_anvil_stat forge_anvil_clear forge_anvil_rebuild
    forge_anvil_dlq_list forge_anvil_dlq_drain
    forge_hallmark_show forge_hallmark_verify
    forge_lattice_index forge_lattice_stat forge_lattice_query
    forge_lattice_callers forge_lattice_blast
)
if [ -f "$TOOLS_JSON" ]; then
    MISSING=()
    for tool in "${EXPECTED_TOOLS[@]}"; do
        if ! grep -q "\"$tool\"" "$TOOLS_JSON" 2>/dev/null; then
            MISSING+=("$tool")
        fi
    done
    if [ ${#MISSING[@]} -eq 0 ]; then
        ok "forge-capabilities-15-tools"
    else
        fail "forge-capabilities-15-tools" "missing: ${MISSING[*]}"
    fi
else
    fail "forge-capabilities-15-tools" "pforge-mcp/tools.json not found"
fi

# ── Check 5: .gitignore template includes .forge/anvil/ ──────────────
GITIGNORE_TMPL="$REPO_ROOT/templates/.gitignore"
if [ -f "$GITIGNORE_TMPL" ]; then
    if grep -q '\.forge/anvil/' "$GITIGNORE_TMPL" 2>/dev/null; then
        ok "gitignore-anvil-entry"
    else
        fail "gitignore-anvil-entry" ".forge/anvil/ not found in templates/.gitignore"
    fi
else
    fail "gitignore-anvil-entry" "templates/.gitignore not found"
fi

# ── Check 6: .gitignore template includes .forge/lattice/ ────────────
if [ -f "$GITIGNORE_TMPL" ]; then
    if grep -q '\.forge/lattice/' "$GITIGNORE_TMPL" 2>/dev/null; then
        ok "gitignore-lattice-entry"
    else
        fail "gitignore-lattice-entry" ".forge/lattice/ not found in templates/.gitignore"
    fi
else
    fail "gitignore-lattice-entry" "templates/.gitignore not found"
fi

# ── Check 7 & 8: OpenBrain /health + provenance capability ───────────
if [ -n "${OPENBRAIN_URL:-}" ]; then
    HEALTH_RESP=$(curl -sf --max-time 5 "$OPENBRAIN_URL/health" 2>/dev/null || echo "")
    if [ -z "$HEALTH_RESP" ]; then
        fail "openbrain-health" "$OPENBRAIN_URL/health did not respond"
        skip "openbrain-provenance-capability" "openbrain-health check failed"
    else
        ok "openbrain-health"
        if echo "$HEALTH_RESP" | grep -q '"provenance"'; then
            ok "openbrain-provenance-capability"
        else
            fail "openbrain-provenance-capability" \
                "response does not include provenance capability (requires OpenBrain >= 0.7.0)"
        fi
    fi
else
    skip "openbrain-health" "OPENBRAIN_URL not set"
    skip "openbrain-provenance-capability" "OPENBRAIN_URL not set"
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────"
printf "  %d passed | %d failed | %d skipped\n" "$PASS" "$FAIL" "$SKIP"
echo "────────────────────────────────────────────────────"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "❌ Smoke FAILED — ${FAIL_NAMES[*]}"
    exit "$FAIL"
fi
echo "✅ Smoke passed."
exit 0
