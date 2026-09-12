#!/bin/bash
#
# ATA release publisher — publish ONE candidate as an immutable release.
#
# This is the ACCEPTED publisher (G3 -> CUTOVER-1 -> closure -> Pocket REG
# ingress) with the POCKET-REG-SECURITY-CLOSURE-1 hardening added. The original
# safety model is unchanged and is restated below; what is new is §B, the
# PRODUCTION ARTIFACT GATE, and §A, the disk headroom preflight.
#
# WHY §B EXISTS (F4/P3). The Pocket REG ingress phase published a Backend
# release whose `.next` had been overwritten by `next dev` — a development
# build with no BUILD_ID. It was caught only at activation, when `next start`
# exited 1 with "Could not find a production build". The publisher had verified
# the tracked TREE against git, which was correct, and had checked
# `.next/routes-manifest.json`, which a dev build also emits. The one field that
# would have caught it was read as `$(cat .next/BUILD_ID || echo unknown)` — a
# missing production build became the string "unknown" in the manifest instead
# of a refusal.
#
# So the artifact is now proven to BE a production build and to SERVE, not
# merely to exist.
#
# SAFETY MODEL (unchanged)
#   * The destination is built from a commit SHA that must match the candidate's
#     own HEAD, so a mistyped SHA cannot create a mislabelled release.
#   * It REFUSES to touch an existing release directory.
#   * It never removes anything. There is no `rm` in this script at all.
#   * Content is staged into a .partial directory and moved into place only after
#     every gate passes, so a half-verified release can never be symlinked to.
set -euo pipefail
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }

REPO="${1:?repo name}"        # backend | crm | academy | partner

# WHERE EACH COMPONENT'S SOURCE ACTUALLY LIVES.
#
# This used to be one hardcoded `/home/ubuntu/learner-ops-v1/${REPO}`, which is
# right for three of the four components and has never been right for the
# partner console — its repository is in the affiliate workspace and always has
# been. The consequence was not a wrong release but NO release: the publisher
# refused with "candidate workspace does not exist", so the one Partner release
# on the box predates that path and Partner never entered the canonical flow.
# Every other partner branch in this file (the compiled-pages gate, the /login
# readiness probe) was already written; only the source lookup was missing.
case "$REPO" in
  backend|crm|academy) SRC="/home/ubuntu/learner-ops-v1/${REPO}" ;;
  partner)             SRC="/home/ubuntu/affiliate-work/${REPO}" ;;
  *) die "unknown repo '$REPO'" ;;
esac
[ -d "$SRC" ] || die "candidate workspace $SRC does not exist"

COMMIT="$(git -C "$SRC" rev-parse HEAD)"
TREE="$(git -C "$SRC" rev-parse HEAD^{tree})"
EXPECTED_COMMIT="${2:?expected commit}"
EXPECTED_TREE="${3:?expected tree}"

[ "$COMMIT" = "$EXPECTED_COMMIT" ] || die "candidate HEAD $COMMIT != expected $EXPECTED_COMMIT"
[ "$TREE"   = "$EXPECTED_TREE" ]   || die "candidate tree $TREE != expected $EXPECTED_TREE"
[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ] || die "candidate has uncommitted tracked changes"

DEST="/srv/ata/releases/${REPO}/${COMMIT}"
STAGE="/srv/ata/releases/${REPO}/.partial-${COMMIT}"

[ -e "$DEST" ] && die "release $DEST already exists — refusing to mutate a published release"
[ -e "$STAGE" ] && die "stage $STAGE already exists — a previous run left it behind; investigate"
[ -d "/srv/ata/releases/${REPO}" ] || die "release parent for ${REPO} is missing"

# node_modules must be a REAL directory, never a symlink.
[ -L "$SRC/node_modules" ] && die "candidate node_modules is a symlink — refusing to publish it"
[ -d "$SRC/node_modules" ] || die "candidate has no node_modules"

# ---------------------------------------------------------------------------
# WHAT A RELEASE IS NOT — the build caches (ATA-STORAGE-RELEASE-HYGIENE-IMPLEMENTATION-1)
# ---------------------------------------------------------------------------
# A release is the artifact that SERVES. `next start` reads `.next/server`,
# `.next/static`, `BUILD_ID` and the manifests; it never opens `.next/cache`,
# which holds only the webpack, swc and eslint caches that make the NEXT build
# faster. Measured on this host: a backend release was 1306 MiB, of which 650
# MiB was `.next/cache` — half an immutable artifact in which the running service
# held zero open file descriptors.
#
# Shipping them cost three ways: the releases themselves, the headroom the gate
# demanded before each publish, and the DISK-HEADROOM stops that followed. So
# the packaging step drops them, and — just as importantly — the size gate
# measures the SAME thing the packaging step will write, so the guard can no
# longer refuse a publish because of bytes that were never going to be published.
#
# The 2 GiB margin is untouched. This narrows what we copy, never how much room
# we insist on having afterwards.
#
# THE SOURCE WORKSPACE KEEPS ITS CACHES. Nothing is deleted from $SRC; a
# developer's next build is exactly as fast as before. This is a packaging rule,
# not a cleanup.
#
# WHY BOTH LISTS EXIST, AND WHY THEY ARE SPELLED DIFFERENTLY. `tar --exclude`
# matches the archive member path, so `./.next/cache` is right. GNU `du
# --exclude` matches a glob against the name as encountered during the walk: a
# bare `.next/cache` matches NOTHING, because no single component is ever spelled
# that way. It fails silently — the walk simply keeps counting — so the size gate
# would have gone on demanding room for bytes the tar no longer copies. That was
# caught by assertion J in the regression, not by reading, which is why J
# compares the measured candidate against the actually-staged tree rather than
# trusting either flag. The `*/` prefix is what makes the du pattern match a
# nested path.
# ONLY UNTRACKED BUILD OUTPUT MAY BE EXCLUDED. The tree verification below proves
# every file `git ls-tree` names is present in the artifact byte for byte, and
# that guarantee is why a release can be trusted at all. `.next/cache` has ZERO
# tracked files, so dropping it changes nothing git knows about.
#
# `.next-cache-seed` was NOT here at first, and the reason is worth keeping: 18 of
# its files were COMMITTED, so excluding it made the publisher refuse the artifact,
# exactly as it should have. It is here now because ATA-CACHE-SEED-IN-GIT-1
# untracked it at the repository level — the correct place — and the guard below
# re-proves that on every publish. Packaging still copies the FILESYSTEM, so a
# workspace that keeps the directory for local build speed no longer ships it.
RELEASE_EXCLUDE_PATHS=(".next/cache" ".next-cache-seed")
TAR_EXCLUDES=(--exclude=./.git)
CANDIDATE_DU_EXCLUDES=(--exclude=.git)
for _x in "${RELEASE_EXCLUDE_PATHS[@]}"; do
  TAR_EXCLUDES+=("--exclude=./${_x}")
  CANDIDATE_DU_EXCLUDES+=("--exclude=*/${_x}")
done

# ---------------------------------------------------------------------------
# §A  DISK HEADROOM PREFLIGHT  (F5/P1)
# ---------------------------------------------------------------------------
# The Pocket REG ingress phase ran to ~1.2 GB free with three ~1 GB release
# trees in flight, and lost two builds to it. Headroom is now a gate rather than
# operator intuition: measure what THIS candidate actually needs, add a margin,
# and refuse before doing any work if the filesystem cannot take it.
#
# It never deletes anything. Reclaiming space is a human decision with the
# retention policy in front of them.
CANDIDATE_KB="$(du -sk "${CANDIDATE_DU_EXCLUDES[@]}" "$SRC" | cut -f1)"
MARGIN_KB=$((2 * 1024 * 1024))          # 2 GiB of working room after the copy
NEEDED_KB=$((CANDIDATE_KB + MARGIN_KB))
AVAIL_KB="$(df -Pk /srv/ata/releases | awk 'NR==2 {print $4}')"

printf 'headroom: candidate=%s MiB  margin=%s MiB  needed=%s MiB  available=%s MiB\n' \
  "$((CANDIDATE_KB/1024))" "$((MARGIN_KB/1024))" "$((NEEDED_KB/1024))" "$((AVAIL_KB/1024))"

if [ "$AVAIL_KB" -lt "$NEEDED_KB" ]; then
  die "insufficient disk headroom: need $((NEEDED_KB/1024)) MiB, have $((AVAIL_KB/1024)) MiB.
  Publishing would risk a truncated release and a failed activation.
  Reclaim space DELIBERATELY (see docs/RELEASE_RETENTION.md) — this script will
  not delete anything for you. Never reclaim an active release, a rollback
  release, a forensic release or audit evidence."
fi

# ---------------------------------------------------------------------------
# §B  PRODUCTION ARTIFACT GATE  (F4/P3)  — before staging anything
# ---------------------------------------------------------------------------
NEXT_DIR="$SRC/.next"
[ -d "$NEXT_DIR" ] || die "candidate has no .next — build it before publishing"

# B1. BUILD_ID: the single field that most cleanly separates a production build
#     from a dev one. Read strictly; no `|| echo unknown` fallback ever again.
[ -f "$NEXT_DIR/BUILD_ID" ] || die "no .next/BUILD_ID — this is a DEV build, not a production build"
BUILD_ID="$(cat "$NEXT_DIR/BUILD_ID")"
[ -n "$BUILD_ID" ] || die ".next/BUILD_ID is empty"
printf '%s' "$BUILD_ID" | grep -qE '^[A-Za-z0-9_-]{8,64}$' \
  || die ".next/BUILD_ID has an implausible shape"

# ---------------------------------------------------------------------------
# B1b. BUILD PROVENANCE  (RELEASE-BUILD-PROVENANCE-1)
# ---------------------------------------------------------------------------
# WHY THIS GATE EXISTS. Everything above and below it proves the artifact IS a
# production build that serves. Nothing proved WHICH SOURCE produced it — and
# the tree verification further down cannot, because it iterates
# `git ls-tree -r --name-only $COMMIT`, which enumerates TRACKED files only.
# `.next` is gitignored in all four components, so the generated artifact was
# never enumerated and never compared with anything.
#
# The consequence was a real published release: correct source, truthful
# manifest, passing artifact gate, and a compiled route that did not contain the
# code the source declared. It was found by querying the live API, not by any
# gate. See tools/tests/build-provenance.test.sh, which reproduces the gap
# against these very expressions.
#
# THE INVARIANT NOW ENFORCED:
#
#   the artifact in .next was produced by tools/build-release.sh
#   FROM EXACTLY the commit and tree being published
#
# TWO BINDINGS, BECAUSE THERE ARE TWO WAYS TO DRIFT.
#
#   commit/tree  catches a STALE ARTIFACT — source moved on after the build.
#                This is the incident.
#   build_id     catches a STALE RECORD — `.next` was rebuilt by other means
#                (a bare `npm run build`, an IDE, a dev server) after a
#                canonical build, leaving a record describing an artifact that
#                is no longer there.
#
# Together they say: this record describes THIS artifact, and this artifact was
# built from THIS source.
#
# WHAT IS DELIBERATELY NOT ACCEPTED AS PROOF: mtimes, "the build directory is
# newer than the source", a clean workspace, or an operator's recollection. A
# clean workspace was true throughout the incident.
PROVENANCE_FILE=".next/ATA_BUILD_PROVENANCE.json"
PROVENANCE_VERIFIER="$(dirname "$(readlink -f "$0")")/verify-build-provenance.sh"
[ -x "$PROVENANCE_VERIFIER" ] || die "build-provenance verifier is missing or not executable: $PROVENANCE_VERIFIER"

# The verifier is a separate script for one reason: this publisher resolves $SRC
# from a fixed per-component mapping and must keep doing so, which means it cannot
# be pointed at a synthetic workspace. A regression that wanted to exercise the
# refusal path would otherwise have had to reimplement the rule, and a test that
# restates its subject proves nothing. One implementation, called from both.
PROVENANCE_SUMMARY="$("$PROVENANCE_VERIFIER" "$REPO" "$SRC" "$COMMIT" "$TREE" "$BUILD_ID")" \
  || die "build provenance verification failed — see the refusal above"
printf '%s\n' "$PROVENANCE_SUMMARY"

prov_field() {
  node -pe "const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]]; typeof v==='string'?v:''" \
    "$SRC/$PROVENANCE_FILE" "$1" 2>/dev/null
}
PROV_SCHEMA="$(prov_field schema)"
PROV_ENV_ID="$(prov_field build_env_identity)"
PROV_BUILT_AT="$(prov_field built_at_utc)"

# B2. Manifests a production build emits and a dev server does not.
for f in required-server-files.json prerender-manifest.json routes-manifest.json \
         app-path-routes-manifest.json build-manifest.json; do
  [ -f "$NEXT_DIR/$f" ] || die "no .next/$f — not a complete production build"
  node -e "JSON.parse(require('fs').readFileSync('$NEXT_DIR/$f','utf8'))" \
    || die ".next/$f is not valid JSON"
done

# B3. Compiled server output must exist and be non-trivial.
[ -d "$NEXT_DIR/server" ] || die "no .next/server — not a production build"
[ -d "$NEXT_DIR/static" ] || die "no .next/static — not a production build"
# WHAT "NON-TRIVIAL" MEANS IS PER-COMPONENT, for the same reason the readiness
# probe below is. The Backend and the CRM are API-bearing and must have compiled
# route handlers. The PARTNER console has NO API routes at all by design — it
# proxies an explicit path list to the Backend — so demanding `route.js` there
# would be a false refusal of a perfectly good build, which is exactly the
# failure mode this gate's own comments warn about. It must instead have
# compiled PAGES.
case "$REPO" in
  partner)
    PAGE_COUNT="$(find "$NEXT_DIR/server/app" -name 'page.js' 2>/dev/null | wc -l)"
    [ "$PAGE_COUNT" -ge 1 ] || die "no compiled pages under .next/server/app"

    # FE-8 — THE REWRITE MANIFEST IS PART OF THE ARTIFACT, so it is gated here.
    #
    # Counting pages proved the console RENDERS. It cannot prove the console
    # WORKS, because the partner app talks to the Backend exclusively through
    # Next rewrites that are resolved at build time and frozen into
    # routes-manifest.json. A build that lost PARTNER_BACKEND_ORIGIN produces a
    # manifest with zero rewrites, renders /login flawlessly, satisfies every
    # other check in this gate — and 404s every partner API path forever.
    # That artifact reached PREPROD and no partner could sign in.
    #
    # So the gate asserts the thing that actually distinguishes a working
    # console from a dead one: the manifest must carry a rewrite for the session
    # endpoint, which is the path every other partner path depends on reaching.
    PARTNER_MANIFEST="$NEXT_DIR/routes-manifest.json"
    [ -f "$PARTNER_MANIFEST" ] || die "partner artifact has no .next/routes-manifest.json"
    REWRITE_COUNT="$(node -e '
      const m = require(process.argv[1]);
      const r = m.rewrites || [];
      const all = Array.isArray(r) ? r : [].concat(r.beforeFiles || [], r.afterFiles || [], r.fallback || []);
      process.stdout.write(String(all.filter((x) => typeof x.source === "string"
        && x.source.startsWith("/api/partner/v1/")).length));
    ' "$PARTNER_MANIFEST" 2>/dev/null || echo 0)"
    [ "${REWRITE_COUNT:-0}" -ge 1 ] || die "partner artifact has NO /api/partner/v1/* rewrites in routes-manifest.json
  The console would render and then 404 every Backend call, which is how a
  sign-in-impossible build shipped before. This almost always means the build
  ran without PARTNER_BACKEND_ORIGIN; rebuild with tools/build-release.sh."
    printf 'partner rewrite gate: %s /api/partner/v1/* rules\n' "$REWRITE_COUNT"
    ;;
  *)
    ROUTE_COUNT="$(find "$NEXT_DIR/server/app" -name 'route.js' 2>/dev/null | wc -l)"
    [ "$ROUTE_COUNT" -ge 1 ] || die "no compiled route handlers under .next/server/app"
    ;;
esac

# B4. The candidate must SERVE. A build can satisfy every file check and still
#     be unservable; the parent incident was discovered by exactly this command.
# Deliberately OUTSIDE 39xx: curriculum suites assert no listener remains in
# that range, and a publisher smoke that borrowed one would fail them.
SMOKE_PORT="$((4310 + RANDOM % 60))"
SMOKE_DB="$(mktemp -u /tmp/ata-publish-smoke-XXXXXX.db)"
SMOKE_LOG="$(mktemp /tmp/ata-publish-smoke-XXXXXX.log)"
printf 'production smoke: port %s\n' "$SMOKE_PORT"

# `setsid` puts the server in its OWN process group so the whole tree can be
# signalled. Killing only the shell's child leaves `next start`'s worker holding
# the port — a leaked listener that later fails the curriculum suites' port
# hygiene assertion, which is exactly how this was discovered.
# EACH COMPONENT DECLARES ITS OWN READINESS PROBE AND ITS OWN SMOKE CONFIG.
#
# This gate was written against the Backend and probed `/api/health`, which only
# the Backend serves. Pointed at the Academy it reported "the candidate does not
# serve" for a perfectly good production build — a false refusal, and the kind
# that gets a gate switched off. The fix is to make the contract explicit per
# component rather than to relax it.
#
# The Academy refuses to start without ACADEMY_MODE, and refuses `api` mode
# without a Backend origin. `fixture` is the right choice HERE precisely because
# it needs no live Backend: the gate is proving that the ARTIFACT is a
# production build and serves, not that the environment around it is wired up.
case "$REPO" in
  backend) SMOKE_ENV=(); SMOKE_READY_PATH="/api/health" ;;
  academy) SMOKE_ENV=(ACADEMY_MODE=fixture); SMOKE_READY_PATH="/" ;;
  crm)     SMOKE_ENV=(); SMOKE_READY_PATH="/" ;;
  # The partner console needs no Backend to SERVE, so `/login` is the right
  # probe: it is the only page that does not first ask the Backend who the
  # caller is, and this gate proves the artifact, not the wiring.
  #
  # FE-8 — AND THAT IS EXACTLY WHY THIS PROBE IS NOT SUFFICIENT ON ITS OWN.
  # `/login` renders identically whether the rewrite manifest is complete or
  # empty, so a console nobody can sign in to passes this smoke unchanged. The
  # rewrite assertion in B3 above is the half of the contract this probe cannot
  # see; neither check replaces the other.
  partner) SMOKE_ENV=(); SMOKE_READY_PATH="/login" ;;
esac
printf 'readiness probe: %s\n' "$SMOKE_READY_PATH"

setsid bash -c 'cd "$1"; shift; DB="$1"; shift; PORT="$1"; shift; \
  exec env "$@" DATABASE_URL="file:$DB" NODE_ENV=production PORT="$PORT" npx next start -p "$PORT"' \
  _ "$SRC" "$SMOKE_DB" "$SMOKE_PORT" "${SMOKE_ENV[@]}" >"$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!

smoke_stop() {
  # Negative pid = the whole process group.
  kill -TERM -"$SMOKE_PID" 2>/dev/null || kill -TERM "$SMOKE_PID" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$SMOKE_PID" 2>/dev/null || break
    sleep 1
  done
  kill -KILL -"$SMOKE_PID" 2>/dev/null || true
  # Fail closed on a leaked listener rather than leaving one behind.
  if ss -ltn 2>/dev/null | grep -q ":${SMOKE_PORT}\b"; then
    printf 'WARNING: smoke port %s still bound after stop\n' "$SMOKE_PORT" >&2
  fi
}
trap smoke_stop EXIT

SMOKE_OK=0
for _ in $(seq 1 40); do
  if curl -fsS -m 3 "http://127.0.0.1:${SMOKE_PORT}${SMOKE_READY_PATH}" >/dev/null 2>&1; then
    SMOKE_OK=1; break
  fi
  # If the server already exited, stop waiting — that IS the dev-build symptom.
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 1
done

if [ "$SMOKE_OK" -ne 1 ]; then
  printf -- '--- smoke log tail ---\n' >&2
  tail -20 "$SMOKE_LOG" >&2 || true
  smoke_stop
  die "the candidate does not serve with 'next start'. A dev-mode .next fails
  here with 'Could not find a production build' — which is exactly the release
  that reached activation in the parent phase."
fi

# B5. A critical route must answer from the candidate itself. Fail-closed
#     statuses are expected and fine; what is being proven is that the compiled
#     handler is present and reachable, not that the feature is enabled.
CB_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -m 5 \
  "http://127.0.0.1:${SMOKE_PORT}/api/postbacks/pocket?goal=reg" || echo 000)"
case "$REPO" in
  backend)
    case "$CB_STATUS" in
      200|400|403|503) printf 'critical route /api/postbacks/pocket -> %s (handler present)\n' "$CB_STATUS" ;;
      *) smoke_stop; die "critical route /api/postbacks/pocket answered $CB_STATUS from the candidate" ;;
    esac
    ;;
  academy)
    # The learner-facing curriculum route. In fixture mode it renders without a
    # Backend, so a non-2xx here means the compiled page is missing or broken,
    # which is exactly what this gate is for.
    AC_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -m 5 \
      "http://127.0.0.1:${SMOKE_PORT}/lessons" || echo 000)"
    case "$AC_STATUS" in
      200|307|308) printf 'critical route /lessons -> %s (page present)\n' "$AC_STATUS" ;;
      *) smoke_stop; die "critical route /lessons answered $AC_STATUS from the candidate" ;;
    esac
    ;;
  *) printf 'critical-route probe: not applicable for %s\n' "$REPO" ;;
esac

smoke_stop
trap - EXIT
# The compiled-artifact count reported here is whichever one B3 measured for
# this component: route handlers for an API-bearing app, pages for the partner
# console. Naming it in the message keeps the manifest line honest about what
# was actually counted.
case "$REPO" in
  partner) ARTIFACT_COUNT_DESC="${PAGE_COUNT} compiled pages" ;;
  *)       ARTIFACT_COUNT_DESC="${ROUTE_COUNT} compiled routes" ;;
esac
printf 'production artifact gate: PASSED (BUILD_ID %s, %s)\n' "$BUILD_ID" "$ARTIFACT_COUNT_DESC"

# ---------------------------------------------------------------------------
# Stage, verify against git, publish
# ---------------------------------------------------------------------------
echo "publishing ${REPO} ${COMMIT}"
echo "  source : $SRC"
echo "  dest   : $DEST"

install -d -m 0755 -o ata -g ata "$STAGE"
tar -C "$SRC" "${TAR_EXCLUDES[@]}" -cf - . | tar -C "$STAGE" -xf -
chown -R ata:ata "$STAGE"
find "$STAGE" -type d -exec chmod 0755 {} +

# An exclusion that hid a TRACKED file would silently weaken the tree
# verification below. Refuse before staging rather than discover it as a wall of
# mysterious DIFFERS lines.
for _x in "${RELEASE_EXCLUDE_PATHS[@]}"; do
  if git -C "$SRC" ls-tree -r --name-only "$COMMIT" | grep -q "^${_x}/"; then
    die "packaging exclusion '$_x' covers git-tracked files — that would break tree verification"
  fi
done

cd "$SRC"
ok=0; bad=0
while IFS= read -r f; do
  gh="$(git cat-file blob "${COMMIT}:$f" | sha256sum | cut -d' ' -f1)"
  dh="$(sha256sum "$STAGE/$f" 2>/dev/null | cut -d' ' -f1)"
  if [ "$gh" = "$dh" ]; then ok=$((ok+1)); else bad=$((bad+1)); echo "  DIFFERS: $f" >&2; fi
done < <(git ls-tree -r --name-only "$COMMIT")
[ "$bad" -eq 0 ] || die "$bad staged file(s) differ from git — not publishing"
echo "  tree-verified: $ok/$ok files match git"

# The artifact gate ran against $SRC; re-assert the decisive markers on the
# STAGED copy, so a truncated or partial copy cannot slip through either.
[ -f "$STAGE/.next/BUILD_ID" ] || die "staged release lost .next/BUILD_ID"
[ "$(cat "$STAGE/.next/BUILD_ID")" = "$BUILD_ID" ] || die "staged BUILD_ID differs from the verified candidate"
# The provenance record must survive packaging too, for the same reason BUILD_ID
# is re-checked here: a truncated or partial copy must not become a release. It
# also means the published release CARRIES its own provenance, so the question
# "what source produced this running artifact?" can be answered from the release
# directory alone, without the manifest and without this script.
[ -f "$STAGE/$PROVENANCE_FILE" ] || die "staged release lost $PROVENANCE_FILE"
[ "$(node -pe "JSON.parse(require('fs').readFileSync('$STAGE/$PROVENANCE_FILE','utf8')).source_commit" 2>/dev/null)" = "$COMMIT" ] \
  || die "staged build provenance does not name the published commit"
[ "$(node -pe "JSON.parse(require('fs').readFileSync('$STAGE/$PROVENANCE_FILE','utf8')).build_id" 2>/dev/null)" = "$BUILD_ID" ] \
  || die "staged build provenance does not name the published BUILD_ID"
[ -f "$STAGE/.next/required-server-files.json" ] || die "staged release has no required-server-files.json"
[ -f "$STAGE/.next/routes-manifest.json" ] || die "staged release has no routes-manifest.json"
node -e "JSON.parse(require('fs').readFileSync('$STAGE/.next/routes-manifest.json','utf8'))" \
  || die "staged routes-manifest.json is not valid JSON"
# The exclusion is a promise about the artifact, so it is verified on the artifact
# rather than trusted from the tar flags.
for _x in "${RELEASE_EXCLUDE_PATHS[@]}"; do
  [ -e "$STAGE/$_x" ] && die "staged release still contains $_x — the packaging exclusion did not hold"
done
[ -d "$STAGE/node_modules" ] || die "staged release has no node_modules"
[ -L "$STAGE/node_modules" ] && die "staged node_modules is a symlink"

cat > "$STAGE/ATA_RELEASE_MANIFEST.json" <<JSON
{
  "component": "${REPO}",
  "phase": "ATA-PREPROD-AFFILIATE-PLATFORM-END-TO-END-1",
  "source_repository": "${SRC}",
  "source_commit": "${COMMIT}",
  "source_tree": "${TREE}",
  "source_branch": "$(git -C "$SRC" rev-parse --abbrev-ref HEAD)",
  "parent_accepted_commit": "$(git -C "$SRC" rev-parse --verify -q HEAD~1 || echo none)",
  "build_id": "${BUILD_ID}",
  "production_artifact_gate": "passed: BUILD_ID present, production manifests valid, ${ARTIFACT_COUNT_DESC}, next start served, critical route answered",
  "build_provenance": {
    "schema": "${PROV_SCHEMA}",
    "verified": "the artifact was produced by tools/build-release.sh from source_commit/source_tree above; BUILD_ID matches the record",
    "build_env_identity": "${PROV_ENV_ID}",
    "built_at_utc": "${PROV_BUILT_AT}",
    "record_in_release": "${PROVENANCE_FILE}"
  },
  "node_version": "$(node -v)",
  "npm_version": "$(npm -v)",
  "package_lock_sha256": "$(sha256sum "$SRC/package-lock.json" | cut -d' ' -f1)",
  "published_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tree_verification": "staged release tree matches git tree ${TREE} with zero differences (${ok} files)",
  "activated_at_publish_time": false,
  "activation_authority": "the current symlink and the running process cwd, never this file"
}
JSON
chown ata:ata "$STAGE/ATA_RELEASE_MANIFEST.json"
chmod 0644 "$STAGE/ATA_RELEASE_MANIFEST.json"

mv "$STAGE" "$DEST"
echo "  published: $DEST"
stat -c '  mode=%a owner=%U:%G' "$DEST"
