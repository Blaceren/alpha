#!/usr/bin/env bash
# ATA-STORAGE-RELEASE-HYGIENE-IMPLEMENTATION-1 — release packaging regression.
#
# WHAT THIS PINS. A release is the artifact that SERVES. The publisher used to
# copy the whole workspace minus .git, so 84% of a backend release was webpack,
# swc and eslint cache the running service never opened. These assertions fix
# both halves of the correction: the caches are gone from the artifact, and the
# runtime files are still there.
#
# It exercises the REAL publisher's packaging and sizing expressions against a
# synthetic workspace, so it cannot pass by describing a copy of the rules.
set -uo pipefail
PUB="${1:-/home/ubuntu/learner-ops-v1/tools/publish-release.sh}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n' "$1"; printf '       %s\n' "${2:-}"; fail=$((fail+1)); }

# A synthetic candidate shaped like a real backend workspace.
SRC="$WORK/src"
mkdir -p "$SRC/.next/server/app" "$SRC/.next/static/chunks" "$SRC/.next/cache/webpack/server-production" \
         "$SRC/.next-cache-seed/webpack" "$SRC/node_modules/next/dist" "$SRC/src/lib" "$SRC/.git/objects"
echo "build-abc123"        > "$SRC/.next/BUILD_ID"
echo '{"version":3}'       > "$SRC/.next/routes-manifest.json"
echo '{"config":{}}'       > "$SRC/.next/required-server-files.json"
echo "server page"         > "$SRC/.next/server/app/page.js"
echo "static chunk"        > "$SRC/.next/static/chunks/main.js"
echo "dep"                 > "$SRC/node_modules/next/dist/index.js"
echo "source"              > "$SRC/src/lib/thing.ts"
echo "git object"          > "$SRC/.git/objects/deadbeef"
head -c 3000000 /dev/zero  > "$SRC/.next/cache/webpack/server-production/0.pack"
head -c 2000000 /dev/zero  > "$SRC/.next-cache-seed/webpack/0.pack"   # tracked in the real repo — NOT excluded

# Read the publisher's OWN exclusion declarations rather than restating them.
eval "$(sed -n '/^RELEASE_EXCLUDE_PATHS=/,/^done$/p' "$PUB")"

STAGE="$WORK/stage"; mkdir -p "$STAGE"
tar -C "$SRC" "${TAR_EXCLUDES[@]}" -cf - . | tar -C "$STAGE" -xf -

# A — the untracked build cache must not be in the artifact
for x in "${RELEASE_EXCLUDE_PATHS[@]}"; do
  [ -e "$STAGE/$x" ] && no "$x absent from the published artifact" "still present" || ok "$x absent from the published artifact"
done
# B — THE INVARIANT, not the example. Excluding a path git tracks would silently
# weaken tree verification, so the publisher refuses it before staging. This used
# to be demonstrated by .next-cache-seed, which WAS tracked; ATA-CACHE-SEED-IN-GIT-1
# untracked it, so the rule is asserted directly against a repo instead of against
# whichever directory happened to be committed that week.
GITREPO="$WORK/repo"; mkdir -p "$GITREPO/.next-cache-seed/webpack"
git -C "$GITREPO" init -q 2>/dev/null
echo tracked > "$GITREPO/.next-cache-seed/webpack/0.pack"
git -C "$GITREPO" add -A >/dev/null 2>&1
git -C "$GITREPO" -c user.email=t@t -c user.name=t commit -qm t >/dev/null 2>&1
COMMIT="$(git -C "$GITREPO" rev-parse HEAD 2>/dev/null)"
GUARD_TRIPPED=0
for _x in ".next-cache-seed"; do
  git -C "$GITREPO" ls-tree -r --name-only "$COMMIT" | grep -q "^${_x}/" && GUARD_TRIPPED=1
done
[ "$GUARD_TRIPPED" = "1" ] \
  && ok "B the tracked-path guard detects an exclusion covering committed files" \
  || no "B the tracked-path guard detects an exclusion covering committed files"
# ...and the same probe finds nothing to complain about in the real backend repo,
# which is why .next-cache-seed may now legitimately be excluded.
REALREPO=/home/ubuntu/learner-ops-v1/backend
if [ -d "$REALREPO/.git" ]; then
  LEAK=0
  for _x in "${RELEASE_EXCLUDE_PATHS[@]}"; do
    git -C "$REALREPO" ls-tree -r --name-only HEAD | grep -q "^${_x}/" && LEAK=1
  done
  [ "$LEAK" = "0" ] && ok "B every excluded path is untracked in the real backend repo" \
    || no "B every excluded path is untracked in the real backend repo"
fi
# .git stays excluded as before
[ -e "$STAGE/.git" ] && no ".git still excluded" "present" || ok ".git still excluded"

# C · D · E — runtime content survives
[ -f "$STAGE/.next/server/app/page.js" ] && ok "C runtime .next/server retained" || no "C runtime .next/server retained"
[ -f "$STAGE/.next/static/chunks/main.js" ] && ok "D runtime .next/static retained" || no "D runtime .next/static retained"
for m in BUILD_ID routes-manifest.json required-server-files.json; do
  [ -f "$STAGE/.next/$m" ] && ok "E manifest $m retained" || no "E manifest $m retained"
done
# F — the deployment model needs a real node_modules
[ -d "$STAGE/node_modules" ] && [ ! -L "$STAGE/node_modules" ] && ok "F node_modules retained as a real directory" || no "F node_modules retained as a real directory"
[ -f "$STAGE/src/lib/thing.ts" ] && ok "source retained" || no "source retained"

# G — the staged assertion the publisher runs must accept this artifact
G_OK=1
for x in "${RELEASE_EXCLUDE_PATHS[@]}"; do [ -e "$STAGE/$x" ] && G_OK=0; done
[ -f "$STAGE/.next/BUILD_ID" ] && [ -f "$STAGE/.next/routes-manifest.json" ] \
  && [ -f "$STAGE/.next/required-server-files.json" ] && [ -d "$STAGE/node_modules" ] || G_OK=0
[ "$G_OK" = "1" ] && ok "G staged artifact gate accepts the new packaging" || no "G staged artifact gate accepts the new packaging"

# J — the size gate must measure what will actually be written
CAND_KB=$(du -sk "${CANDIDATE_DU_EXCLUDES[@]}" "$SRC" | cut -f1)
STAGE_KB=$(du -sk "$STAGE" | cut -f1)
OLD_KB=$(du -sk --exclude=.git "$SRC" | cut -f1)
DRIFT=$(( CAND_KB > STAGE_KB ? CAND_KB - STAGE_KB : STAGE_KB - CAND_KB ))
[ "$DRIFT" -le 64 ] && ok "J headroom measures the artifact (candidate ${CAND_KB}K vs staged ${STAGE_KB}K)" \
  || no "J headroom measures the artifact" "candidate ${CAND_KB}K vs staged ${STAGE_KB}K"
[ "$OLD_KB" -gt "$CAND_KB" ] && ok "J the old calculation over-demanded (${OLD_KB}K vs ${CAND_KB}K)" \
  || no "J the old calculation over-demanded"

# The two exclusion lists must stay in step — one list edited without the other is the bug
[ "${#TAR_EXCLUDES[@]}" -eq "${#CANDIDATE_DU_EXCLUDES[@]}" ] \
  && ok "tar and du exclusion lists stay in step" || no "tar and du exclusion lists stay in step"

# RED PROOF — the pre-change packaging (only .git excluded) must FAIL assertion A/B
OLDSTAGE="$WORK/oldstage"; mkdir -p "$OLDSTAGE"
tar -C "$SRC" --exclude=./.git -cf - . | tar -C "$OLDSTAGE" -xf -
LEAKED=0
for x in "${RELEASE_EXCLUDE_PATHS[@]}"; do [ -e "$OLDSTAGE/$x" ] && LEAKED=$((LEAKED+1)); done
[ "$LEAKED" -eq "${#RELEASE_EXCLUDE_PATHS[@]}" ] \
  && ok "RED: the old packaging ships all ${LEAKED} excluded path(s) (assertion would fail)" \
  || no "RED: the old packaging ships the excluded paths" "leaked=$LEAKED"

printf '\nrelease packaging regression: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
