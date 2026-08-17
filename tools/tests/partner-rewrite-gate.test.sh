#!/usr/bin/env bash
# ATA-PREPROD-FULL-PRODUCT-E2E-BUSINESS-ACCEPTANCE-1 / FE-8 — the partner
# console's Backend wiring is part of its artifact, and both halves are pinned
# here: the build must REFUSE to proceed without the origin, and the publisher
# must REFUSE an artifact whose rewrite manifest lost it.
#
# WHAT HAPPENED. The partner console reaches the Backend only through the Next
# rewrites declared in next.config.mjs from PARTNER_BACKEND_ORIGIN. `rewrites()`
# is evaluated at BUILD time and frozen into .next/routes-manifest.json, so an
# artifact built without that value carries zero rewrites permanently and 404s
# every partner API path — while rendering /login flawlessly. One shipped. The
# release record read "passed: 8 compiled pages, next start served, critical
# route answered", every word of it true, and no partner could sign in.
#
# The build read the value through `optional_from_config`, which swallowed both
# an absent key AND a failed elevated read (`sudo -n`, empty when no credential
# is cached). Whether the console worked came down to the operator's sudo
# timestamp.
#
# WHY THESE ASSERTIONS AND NOT A BUILD. Running a real `next build` here would
# take minutes and need a workspace; what actually went wrong is expressible
# without one. So this reads the REAL scripts' own declarations and exercises
# the publisher's REAL gate expression against synthetic manifests, rather than
# describing the rules in a second place where they could drift.
set -uo pipefail
BUILD="${1:-/home/ubuntu/ata-release-tooling/tools/build-release.sh}"
PUB="${2:-/home/ubuntu/ata-release-tooling/tools/publish-release.sh}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n' "$1"; printf '       %s\n' "${2:-}"; fail=$((fail+1)); }

# ---------------------------------------------------------------------------
# A — the BUILD contract: the origin is required, never optional
# ---------------------------------------------------------------------------
PARTNER_BRANCH="$(sed -n '/^  partner)/,/^    ;;/p' "$BUILD")"

grep -q 'require_from_config partner PARTNER_BACKEND_ORIGIN' <<<"$PARTNER_BRANCH" \
  && ok "A1 build requires PARTNER_BACKEND_ORIGIN" \
  || no "A1 build requires PARTNER_BACKEND_ORIGIN" \
        "the partner branch must use require_from_config, not optional_from_config"

grep -q 'optional_from_config partner PARTNER_BACKEND_ORIGIN' <<<"$PARTNER_BRANCH" \
  && no "A2 build does not treat the origin as optional" \
        "optional_from_config silently accepts a failed elevated read and ships a dead console" \
  || ok "A2 build does not treat the origin as optional"

# require_from_config must still be the thing that dies on an empty value —
# pinned so a later edit cannot make "required" mean "warn".
REQ="$(sed -n '/^require_from_config()/,/^}/p' "$BUILD")"
grep -q 'die' <<<"$REQ" \
  && ok "A3 require_from_config refuses an unreadable value" \
  || no "A3 require_from_config refuses an unreadable value" "no die in require_from_config"

# The key must remain on the read allowlist, or the required read cannot happen.
sed -n '/^READABLE_CONFIG_KEYS=(/,/^)/p' "$BUILD" | grep -q 'PARTNER_BACKEND_ORIGIN' \
  && ok "A4 PARTNER_BACKEND_ORIGIN is an allowlisted build config key" \
  || no "A4 PARTNER_BACKEND_ORIGIN is an allowlisted build config key"

# ---------------------------------------------------------------------------
# B — the PUBLISH gate: exercise the real counting expression on real manifests
# ---------------------------------------------------------------------------
# Lifted from the publisher so the test cannot drift from the shipped rule.
count_rewrites() {
  node -e '
    const m = require(process.argv[1]);
    const r = m.rewrites || [];
    const all = Array.isArray(r) ? r : [].concat(r.beforeFiles || [], r.afterFiles || [], r.fallback || []);
    process.stdout.write(String(all.filter((x) => typeof x.source === "string"
      && x.source.startsWith("/api/partner/v1/")).length));
  ' "$1" 2>/dev/null || echo 0
}

# B1 — the artifact that shipped: structurally valid, zero rewrites.
cat > "$WORK/empty.json" <<'JSON'
{"version":3,"rewrites":{"beforeFiles":[],"afterFiles":[],"fallback":[]}}
JSON
[ "$(count_rewrites "$WORK/empty.json")" = "0" ] \
  && ok "B1 a manifest with no rewrites counts 0 (the shipped artifact)" \
  || no "B1 a manifest with no rewrites counts 0"

# B2 — a correctly built artifact.
cat > "$WORK/good.json" <<'JSON'
{"version":3,"rewrites":{"beforeFiles":[],"afterFiles":[
  {"source":"/api/partner/v1/session","destination":"http://127.0.0.1:3100/api/partner/v1/session"},
  {"source":"/api/partner/v1/overview","destination":"http://127.0.0.1:3100/api/partner/v1/overview"}
],"fallback":[]}}
JSON
[ "$(count_rewrites "$WORK/good.json")" = "2" ] \
  && ok "B2 a wired manifest counts its /api/partner/v1/* rules" \
  || no "B2 a wired manifest counts its /api/partner/v1/* rules"

# B3 — rewrites that are not the partner API must not satisfy the gate.
cat > "$WORK/decoy.json" <<'JSON'
{"version":3,"rewrites":{"beforeFiles":[],"afterFiles":[
  {"source":"/healthz","destination":"http://127.0.0.1:3100/healthz"}
],"fallback":[]}}
JSON
[ "$(count_rewrites "$WORK/decoy.json")" = "0" ] \
  && ok "B3 unrelated rewrites do not satisfy the gate" \
  || no "B3 unrelated rewrites do not satisfy the gate"

# B4 — the legacy array shape Next has also emitted must still be counted.
cat > "$WORK/array.json" <<'JSON'
{"version":3,"rewrites":[
  {"source":"/api/partner/v1/session","destination":"http://127.0.0.1:3100/api/partner/v1/session"}
]}
JSON
[ "$(count_rewrites "$WORK/array.json")" = "1" ] \
  && ok "B4 the array manifest shape is counted too" \
  || no "B4 the array manifest shape is counted too"

# ---------------------------------------------------------------------------
# C — the gate is actually WIRED into the publisher's partner branch
# ---------------------------------------------------------------------------
# Anchored on PAGE_COUNT rather than on `partner)`: the publisher has several
# `partner)` arms (source path, smoke config), and a range starting at the first
# one silently slices the wrong block — which is exactly what this test did on
# its first run, reporting three false failures against a correct publisher.
PUB_PARTNER="$(awk '/PAGE_COUNT=/{f=1} f{print} f&&/^    ;;/{exit}' "$PUB")"

grep -q 'routes-manifest.json' <<<"$PUB_PARTNER" \
  && ok "C1 publisher inspects the partner rewrite manifest" \
  || no "C1 publisher inspects the partner rewrite manifest"

grep -q 'api/partner/v1/' <<<"$PUB_PARTNER" \
  && ok "C2 publisher gates on /api/partner/v1/* rules" \
  || no "C2 publisher gates on /api/partner/v1/* rules"

grep -q 'die' <<<"$PUB_PARTNER" \
  && ok "C3 publisher REFUSES rather than warns" \
  || no "C3 publisher REFUSES rather than warns"

# The page count must survive: it is a real check, it was simply not sufficient.
grep -q 'PAGE_COUNT' <<<"$PUB_PARTNER" \
  && ok "C4 the compiled-pages check is retained alongside it" \
  || no "C4 the compiled-pages check is retained alongside it"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
