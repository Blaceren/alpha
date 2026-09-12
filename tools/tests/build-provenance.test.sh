#!/usr/bin/env bash
# ATA-PREPROD-RELEASE-BUILD-PROVENANCE-CORRECTION-1 — the provenance regression.
#
# WHAT THIS PINS, AND WHY IT EXISTS.
#
# A Backend release was published whose SOURCE was correct, whose manifest was
# truthful, whose artifact gate passed and whose service started — and whose
# compiled route did not contain the code the source declared. It was found only
# by querying the live API.
#
# The mechanism is in this file's first assertion, and it is worth stating
# plainly because it is not a bug in any single line: the publisher had two
# verification systems that never met.
#
#   TREE VERIFICATION  iterates `git ls-tree -r --name-only $COMMIT`, which
#                      enumerates TRACKED files only. `.next` is gitignored in
#                      all four components, so the generated artifact is never
#                      enumerated and never compared with anything.
#
#   ARTIFACT GATE      proves `.next` IS a production build and SERVES. Every
#                      one of its checks is satisfied by ANY valid production
#                      build, of ANY source revision.
#
# Neither crosses the gap. Nothing related `.next` to $COMMIT.
#
# The RED assertions below reproduce that gap against the real publisher's own
# expressions. The GREEN assertions prove the provenance contract closes it.
set -uo pipefail
PUB="${1:-/home/ubuntu/learner-ops-v1/tools/publish-release.sh}"
BUILDER="${2:-/home/ubuntu/learner-ops-v1/tools/build-release.sh}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n' "$1"; printf '       %s\n' "${2:-}"; fail=$((fail+1)); }

# The provenance file name and the verifier are read from the publisher itself,
# so this test cannot pass by restating rules the publisher does not implement.
PROV_NAME="$(sed -n 's/^PROVENANCE_FILE="\([^"]*\)".*/\1/p' "$PUB" | head -1)"
[ -n "$PROV_NAME" ] && ok "publisher declares a provenance file ($PROV_NAME)" \
  || { no "publisher declares a provenance file"; PROV_NAME=".next/ATA_BUILD_PROVENANCE.json"; }

# ---------------------------------------------------------------------------
# A synthetic component workspace with a real git repo.
# ---------------------------------------------------------------------------
mk_repo() {
  local d="$1"
  mkdir -p "$d/src" "$d/.next/server/app" "$d/.next/static" "$d/node_modules/next"
  printf 'node_modules/\n.next/\n' > "$d/.gitignore"
  echo 'export const V = "A";' > "$d/src/thing.ts"
  echo '{}' > "$d/package.json"
  git -C "$d" init -q
  git -C "$d" add -A >/dev/null 2>&1
  git -C "$d" -c user.email=t@t -c user.name=t commit -qm A >/dev/null 2>&1
}

# A "build": whatever `.next` state a build would have left behind.
mk_build() {
  local d="$1" build_id="$2" compiled="$3"
  echo "$build_id" > "$d/.next/BUILD_ID"
  echo "$compiled" > "$d/.next/server/app/route.js"
  for f in routes-manifest.json required-server-files.json prerender-manifest.json \
           app-path-routes-manifest.json build-manifest.json; do
    echo '{}' > "$d/.next/$f"
  done
}

# The provenance record a canonical build writes.
mk_prov() {
  local d="$1" component="$2" commit="$3" tree="$4" build_id="$5"
  cat > "$d/$PROV_NAME" <<JSON
{
  "schema": "ata.build.provenance/1",
  "component": "$component",
  "source_commit": "$commit",
  "source_tree": "$tree",
  "build_id": "$build_id",
  "build_env_identity": "test",
  "built_at_utc": "2026-08-16T00:00:00Z"
}
JSON
}

SRC="$WORK/comp"; mk_repo "$SRC"
COMMIT_A="$(git -C "$SRC" rev-parse HEAD)"
TREE_A="$(git -C "$SRC" rev-parse HEAD^{tree})"
mk_build "$SRC" "build-from-A" 'const V = "A";'
mk_prov  "$SRC" "backend" "$COMMIT_A" "$TREE_A" "build-from-A"

# Move the source on WITHOUT rebuilding — the exact incident.
echo 'export const V = "B";' > "$SRC/src/thing.ts"
git -C "$SRC" add -A >/dev/null 2>&1
git -C "$SRC" -c user.email=t@t -c user.name=t commit -qm B >/dev/null 2>&1
COMMIT_B="$(git -C "$SRC" rev-parse HEAD)"
TREE_B="$(git -C "$SRC" rev-parse HEAD^{tree})"

# ---------------------------------------------------------------------------
# RED — the gap, reproduced against the publisher's own verification expression
# ---------------------------------------------------------------------------
# R1. Tree verification passes for commit B while `.next` holds A's output.
bad=0
while IFS= read -r f; do
  gh="$(git -C "$SRC" cat-file blob "${COMMIT_B}:$f" | sha256sum | cut -d' ' -f1)"
  dh="$(sha256sum "$SRC/$f" 2>/dev/null | cut -d' ' -f1)"
  [ "$gh" = "$dh" ] || bad=$((bad+1))
done < <(git -C "$SRC" ls-tree -r --name-only "$COMMIT_B")
[ "$bad" -eq 0 ] && ok "RED tree verification passes for B while .next is from A" \
  || no "RED tree verification passes for B while .next is from A" "bad=$bad"

# R2. ...because the enumeration never names the artifact at all.
git -C "$SRC" ls-tree -r --name-only "$COMMIT_B" | grep -q '^\.next/' \
  && no "RED tree verification never enumerates .next" "it did" \
  || ok "RED tree verification never enumerates .next (so it cannot check it)"

# R3. And the artifact still LOOKS like a valid production build.
LOOKS_VALID=1
[ -f "$SRC/.next/BUILD_ID" ] || LOOKS_VALID=0
for f in routes-manifest.json required-server-files.json prerender-manifest.json; do
  [ -f "$SRC/.next/$f" ] || LOOKS_VALID=0
done
[ "$(find "$SRC/.next/server/app" -name 'route.js' | wc -l)" -ge 1 ] || LOOKS_VALID=0
[ "$LOOKS_VALID" = "1" ] \
  && ok "RED the stale artifact satisfies every structural artifact check" \
  || no "RED the stale artifact satisfies every structural artifact check"

# R4. The compiled output demonstrably lags the source — the shipped defect.
grep -q '"B"' "$SRC/src/thing.ts" && grep -q '"A"' "$SRC/.next/server/app/route.js" \
  && ok "RED source says B, compiled artifact says A" \
  || no "RED source says B, compiled artifact says A"

# ---------------------------------------------------------------------------
# GREEN — the provenance contract must refuse every one of these
# ---------------------------------------------------------------------------
# THE REAL VERIFIER, invoked exactly as the publisher invokes it. Nothing below
# reimplements the rule: if the shipped script stops refusing, these fail.
VERIFIER="${3:-/home/ubuntu/learner-ops-v1/tools/verify-build-provenance.sh}"
[ -x "$VERIFIER" ] && ok "shipped verifier is executable ($VERIFIER)" \
  || no "shipped verifier is executable" "$VERIFIER"

# usage: verify <workspace> <component> <commit> <tree>  -> ACCEPT | REFUSE:<reason>
verify() {
  local d="$1" comp="$2" commit="$3" tree="$4" out rc build_id
  build_id="$(cat "$d/.next/BUILD_ID" 2>/dev/null || echo '')"
  out="$("$VERIFIER" "$comp" "$d" "$commit" "$tree" "$build_id" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then echo "ACCEPT"; return; fi
  # Classify the refusal from the shipped script's own message.
  case "$out" in
    *"has no build provenance"*)        echo "REFUSE:missing" ;;
    *"not valid JSON"*)                 echo "REFUSE:malformed" ;;
    *"schema"*)                         echo "REFUSE:schema" ;;
    *"is for component"*)               echo "REFUSE:component" ;;
    *"STALE ARTIFACT"*)                 echo "REFUSE:commit" ;;
    *"records source tree"*)            echo "REFUSE:tree" ;;
    *"records BUILD_ID"*)               echo "REFUSE:build_id" ;;
    *"build_env_identity"*)             echo "REFUSE:env" ;;
    *)                                  echo "REFUSE:other" ;;
  esac
}

# 1. STALE ARTIFACT — provenance records A, publishing B.
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:commit" ] && ok "GREEN stale artifact (built at A, publishing B) is REFUSED [$r]" \
  || no "GREEN stale artifact is refused" "got $r"

# 2. WRONG SOURCE TREE — commit patched to look right, tree still A's.
mk_prov "$SRC" backend "$COMMIT_B" "$TREE_A" "build-from-A"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:tree" ] && ok "GREEN wrong source tree is REFUSED [$r]" \
  || no "GREEN wrong source tree is refused" "got $r"

# 3. WRONG COMPONENT — a valid record from another app.
mk_prov "$SRC" academy "$COMMIT_B" "$TREE_B" "build-from-A"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:component" ] && ok "GREEN wrong component provenance is REFUSED [$r]" \
  || no "GREEN wrong component provenance is refused" "got $r"

# 4. STALE RECORD, NEWER ARTIFACT — someone rebuilt without the canonical
#    builder, so `.next` moved on and the record did not. The other direction,
#    and the one a commit/tree check alone would miss.
mk_prov  "$SRC" backend "$COMMIT_B" "$TREE_B" "build-from-A"
mk_build "$SRC" "build-from-somewhere-else" 'const V = "?";'
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:build_id" ] && ok "GREEN record not matching the present artifact is REFUSED [$r]" \
  || no "GREEN record not matching the present artifact is refused" "got $r"

# 4b. NO BUILD_ID AT ALL — a dev build or a wiped artifact beside a live record.
mk_prov "$SRC" backend "$COMMIT_B" "$TREE_B" "build-from-B"
mv "$SRC/.next/BUILD_ID" "$SRC/.next/BUILD_ID.away"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:build_id" ] && ok "GREEN a record with no artifact BUILD_ID is REFUSED [$r]" \
  || no "GREEN a record with no artifact BUILD_ID is refused" "got $r"
mv "$SRC/.next/BUILD_ID.away" "$SRC/.next/BUILD_ID"

# 4c. MISSING build_env_identity — an incomplete record is not a valid one.
# The commit, tree and BUILD_ID are made to agree first, so the refusal that
# fires is unambiguously the missing field and not an earlier binding.
mk_prov "$SRC" backend "$COMMIT_B" "$TREE_B" "$(cat "$SRC/.next/BUILD_ID")"
node -e "
const fs=require('fs');const p='$SRC/$PROV_NAME';
const j=JSON.parse(fs.readFileSync(p,'utf8'));delete j.build_env_identity;
fs.writeFileSync(p,JSON.stringify(j));"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:env" ] && ok "GREEN a record without build_env_identity is REFUSED [$r]" \
  || no "GREEN a record without build_env_identity is refused" "got $r"

# 5. MISSING PROVENANCE — a workspace built before this contract existed.
rm -f "$SRC/$PROV_NAME"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:missing" ] && ok "GREEN missing provenance is REFUSED [$r]" \
  || no "GREEN missing provenance is refused" "got $r"

# 6. MALFORMED PROVENANCE — truncated or hand-edited into invalid JSON.
printf '{ not json' > "$SRC/$PROV_NAME"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:malformed" ] && ok "GREEN malformed provenance is REFUSED [$r]" \
  || no "GREEN malformed provenance is refused" "got $r"

# 7. WRONG SCHEMA — a future or foreign record shape is not assumed compatible.
mk_prov "$SRC" backend "$COMMIT_B" "$TREE_B" "build-from-somewhere-else"
node -e "
const fs=require('fs');const p='$SRC/$PROV_NAME';
const j=JSON.parse(fs.readFileSync(p,'utf8'));j.schema='ata.build.provenance/99';
fs.writeFileSync(p,JSON.stringify(j));"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "REFUSE:schema" ] && ok "GREEN unknown provenance schema is REFUSED [$r]" \
  || no "GREEN unknown provenance schema is refused" "got $r"

# 8. THE POSITIVE PATH — a canonical build at B, published at B.
mk_build "$SRC" "build-from-B" 'const V = "B";'
mk_prov  "$SRC" backend "$COMMIT_B" "$TREE_B" "build-from-B"
r="$(verify "$SRC" backend "$COMMIT_B" "$TREE_B")"
[ "$r" = "ACCEPT" ] && ok "GREEN a canonical build of the published commit is ACCEPTED" \
  || no "GREEN a canonical build of the published commit is accepted" "got $r"

# 9. ...and the artifact then genuinely matches the source.
grep -q '"B"' "$SRC/src/thing.ts" && grep -q '"B"' "$SRC/.next/server/app/route.js" \
  && ok "GREEN the accepted artifact's compiled output matches the published source" \
  || no "GREEN the accepted artifact's compiled output matches the published source"

# ---------------------------------------------------------------------------
# The publisher must actually CONTAIN the checks asserted above.
# ---------------------------------------------------------------------------
for needle in 'PROVENANCE_FILE' 'verify-build-provenance.sh'; do
  grep -q "$needle" "$PUB" && ok "publisher invokes the provenance contract ($needle)" \
    || no "publisher invokes the provenance contract ($needle)"
done
# The rule itself lives in ONE place, and that place must state every binding.
for needle in 'ata.build.provenance/1' 'source_commit' 'source_tree' 'build_id' 'build_env_identity' 'component'; do
  grep -q "$needle" "$VERIFIER" && ok "verifier binds $needle" || no "verifier binds $needle"
done
grep -q 'die ' "$PUB" && ok "publisher fails closed via die()" || no "publisher fails closed via die()"

# The canonical builder must exist and must own provenance creation.
if [ -f "$BUILDER" ]; then
  ok "canonical build script exists ($BUILDER)"
  grep -q 'rev-parse HEAD' "$BUILDER" && ok "builder captures the source commit" || no "builder captures the source commit"
  grep -q 'HEAD^{tree}\|HEAD\^{tree}' "$BUILDER" && ok "builder captures the source tree" || no "builder captures the source tree"
  grep -q 'status --porcelain' "$BUILDER" && ok "builder refuses a dirty tracked workspace" || no "builder refuses a dirty tracked workspace"
  grep -q 'BUILD_ID' "$BUILDER" && ok "builder binds the record to the produced BUILD_ID" || no "builder binds the record to the produced BUILD_ID"
  # §10 — no environment file may be sourced, and no secret may reach argv.
  grep -qE '(^|[^#])\s*(\.|source)\s+/srv/ata/config/' "$BUILDER" \
    && no "builder does not source a runtime env file" "it does" \
    || ok "builder does not source a runtime env file"
  grep -q 'xargs' "$BUILDER" \
    && no "builder does not use env \$(cat ... | xargs)" "it does" \
    || ok "builder does not use env \$(cat ... | xargs)"
else
  no "canonical build script exists" "$BUILDER not found"
fi

# The publisher and the builder must agree about where each component lives; a
# component added to one and not the other would be a silent gap.
PUB_MAP="$(sed -n '/^case "\$REPO" in$/,/^esac$/p' "$PUB" | grep -E 'SRC=' | tr -d ' ' | sort)"
BLD_MAP="$(sed -n '/^case "\$REPO" in$/,/^esac$/p' "$BUILDER" | grep -E 'SRC=' | tr -d ' ' | sort)"
[ -n "$PUB_MAP" ] && [ "$PUB_MAP" = "$BLD_MAP" ] \
  && ok "publisher and builder resolve the same source workspaces" \
  || no "publisher and builder resolve the same source workspaces" "publisher=[$PUB_MAP] builder=[$BLD_MAP]"

# All four release components must be handled by the builder.
# The builder has two `case "$REPO"` blocks: the workspace mapping and the
# per-component build environment. Both must cover all four components, so each
# block is extracted by ordinal rather than by a line offset that drifts.
case_block() { awk -v n="$2" '/^case "\$REPO" in$/{c++} c==n{print} /^esac$/{if(c==n) exit}' "$1"; }
BLD_MAP_CASE="$(case_block "$BUILDER" 1)"
BLD_ENV_CASE="$(case_block "$BUILDER" 2)"
for c in backend academy crm partner; do
  printf '%s' "$BLD_MAP_CASE" | grep -qE "(^|[[:space:]|])${c}[|)]" \
    && ok "builder resolves a workspace for $c" || no "builder resolves a workspace for $c"
done
# ...and each one declares its own build environment, since that — not the mere
# presence of a .next — is what makes the artifact semantically correct.
for c in backend academy crm partner; do
  printf '%s' "$BLD_ENV_CASE" | grep -qE "^[[:space:]]*${c}\)" \
    && ok "builder declares a canonical build env for $c" || no "builder declares a canonical build env for $c"
done
[ -n "$BLD_ENV_CASE" ] && ok "builder has a distinct per-component build-env block" \
  || no "builder has a distinct per-component build-env block"

# The provenance record must not be excluded from the artifact by packaging.
eval "$(sed -n '/^RELEASE_EXCLUDE_PATHS=/,/^done$/p' "$PUB")"
EXCLUDED=0
for x in "${RELEASE_EXCLUDE_PATHS[@]}"; do
  case "$PROV_NAME" in "$x"/*|"$x") EXCLUDED=1 ;; esac
done
[ "$EXCLUDED" = "0" ] && ok "the provenance record is not excluded from the artifact" \
  || no "the provenance record is not excluded from the artifact"

# The publisher must re-assert provenance on the STAGED copy, as it does BUILD_ID.
grep -q 'staged release lost \$PROVENANCE_FILE\|staged release lost .*PROVENANCE' "$PUB" \
  && ok "publisher re-asserts provenance on the staged copy" \
  || no "publisher re-asserts provenance on the staged copy"

# ...and the manifest must record it.
grep -q 'build_provenance' "$PUB" && ok "release manifest records build provenance" \
  || no "release manifest records build provenance"

printf '\nbuild provenance regression: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
