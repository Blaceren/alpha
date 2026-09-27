#!/usr/bin/env bash
#
# ATA production build + release staging.
#
#   sudo bash deploy/aws/build.sh <backend|academy|crm>
#
# Produces a self-contained release at /srv/ata/releases/<repo>/<commit> that
# satisfies every precondition tools/cutover.sh checks, then tells you the
# BUILD_ID to hand to cutover.
#
# ===========================================================================
# WHY THIS EXISTS INSTEAD OF tools/build-release.sh
#
# The vendored tooling was written for a DIFFERENT REPOSITORY TOPOLOGY: three
# separate git repositories, each checked out at /home/ubuntu/learner-ops-v1/
# <component>. This project is a single monorepo with the three apps as
# subdirectories of one repository. Concretely:
#
#   * build-release.sh asserts `[ -d "$SRC/.git" ]`. For a subdirectory of a
#     monorepo that path does not exist, so it dies immediately with
#     "REFUSING: ... is not a git repository".
#
#   * publish-release.sh verifies the release against
#     `git ls-tree -r --name-only $COMMIT`, which for this repository
#     enumerates ALL THREE apps plus tools/ and _phase/. Comparing that against
#     one component's release directory cannot succeed.
#
# Making them work would mean either splitting the repository into three or
# rewriting the publisher's tree verification — both larger decisions than a
# first deploy should force. So the provenance pipeline is set aside here, and
# the part that is topology-independent is kept: the cutover step, which checks
# only the release directory, its BUILD_ID, node_modules and package.json, and
# performs the atomic symlink swap with a rollback receipt. It lives at
# deploy/aws/cutover.sh — a derivative of tools/cutover.sh; see that file's
# header for why it is a copy rather than a patch.
#
# WHAT IS THEREFORE GIVEN UP, STATED PLAINLY: the artifact→source provenance
# record that build-release.sh writes into .next. The guard this script keeps in
# its place is the clean-tree check below, so a release still corresponds to
# exactly one commit. It does NOT prove after the fact that a given .next came
# from that commit. See deploy/aws/README.md, "Known divergences".
# ===========================================================================

set -euo pipefail

die() { printf '\nREFUSING: %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

REPO="${1:?usage: build.sh <backend|academy|crm>}"
case "$REPO" in backend|academy|crm) ;; *) die "unknown component '$REPO'" ;; esac

[ "$(id -u)" -eq 0 ] || die "must run as root (writes under /srv/ata)"

SRC_ROOT="/home/ubuntu/learner-ops-v1"
SRC="$SRC_ROOT/$REPO"
CONFIG="/srv/ata/config/${REPO}.env"

[ -d "$SRC" ] || die "$SRC does not exist"
[ -d "$SRC_ROOT/.git" ] || die "$SRC_ROOT is not a git repository"
[ -f "$CONFIG" ] || die "$CONFIG does not exist — write the env file before building"

# A build of a dirty workspace corresponds to no commit at all, so there is
# nothing honest to record. Kept from build-release.sh, which is right about
# this even though the rest of it does not fit.
[ -z "$(git -C "$SRC_ROOT" status --porcelain --untracked-files=no)" ] \
  || die "workspace has uncommitted tracked changes — commit them first"

COMMIT="$(git -C "$SRC_ROOT" rev-parse HEAD)"
DEST="/srv/ata/releases/${REPO}/${COMMIT}"

step "Building $REPO @ ${COMMIT:0:12}"

if [ -d "$DEST" ]; then
  die "$DEST already exists. A release directory is immutable; remove it deliberately if you really mean to rebuild this commit."
fi

# ---------------------------------------------------------------------------
step "1/5  Staging source -> $DEST"
# ---------------------------------------------------------------------------
mkdir -p "$DEST"
# Copy the source in, then build IN PLACE in the release directory. The result
# is self-contained and the working checkout is never polluted with build
# output or production node_modules.
tar -C "$SRC" \
    --exclude='./node_modules' --exclude='./.next' --exclude='./.git' \
    --exclude='./screenshots' --exclude='./test-results' \
    -cf - . | tar -C "$DEST" -xf -

# ---------------------------------------------------------------------------
step "2/5  Loading build environment from $CONFIG"
# ---------------------------------------------------------------------------
# THIS IS THE STEP THAT MATTERS MOST, AND IT IS WHY THIS SCRIPT SOURCES CONFIG
# AT ALL.
#
# CRM needs CRM_MODE and CRM_BACKEND_ORIGIN at BUILD time, not just at runtime:
# crm/next.config.mjs builds its ~45-entry rewrite table inside `rewrites()`,
# which Next evaluates during `next build` and bakes into routes-manifest.json.
# Without them, buildRewrites() returns [] and the artifact has no proxy routes.
# The build succeeds, the service starts, and every CRM API call 404s with
# nothing in the logs to explain it.
#
# Academy resolves its config lazily at request time, so it does not need this —
# but sourcing uniformly costs nothing and removes a per-component rule that
# someone would eventually get wrong.
set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a
export NODE_ENV=production

if [ "$REPO" = "crm" ]; then
  [ "${CRM_MODE:-}" = "api" ] || die "CRM_MODE is '${CRM_MODE:-unset}', expected 'api' — building now would bake an empty rewrite table"
  [ -n "${CRM_BACKEND_ORIGIN:-}" ] || die "CRM_BACKEND_ORIGIN is unset — see the note above"
fi

# ---------------------------------------------------------------------------
step "3/5  npm ci"
# ---------------------------------------------------------------------------
cd "$DEST"
# engine-strict=true in .npmrc plus engines "22.14.x" means this fails loudly on
# any other Node version rather than producing a subtly wrong install.
npm ci --no-audit --no-fund

if [ "$REPO" = "backend" ]; then
  step "3b/5  prisma generate"
  npx prisma generate
fi

# ---------------------------------------------------------------------------
step "4/5  next build"
# ---------------------------------------------------------------------------
# Build one component at a time. Three concurrent `next build` runs will OOM a
# 4 GB instance; that is what the swapfile is insurance for, not a licence.
npm run build

[ -f "$DEST/.next/BUILD_ID" ] || die "build produced no .next/BUILD_ID"
BUILD_ID="$(cat "$DEST/.next/BUILD_ID")"

# ---------------------------------------------------------------------------
step "5/5  Pruning dev dependencies"
# ---------------------------------------------------------------------------
# Mirrors the Dockerfile's production-deps stage.
#
# NOTE: this removes `tsx` and `prisma`, so database migrations CANNOT be run
# from a release directory. Run them from the source checkout at $SRC, where
# devDependencies are installed. See README.md.
npm prune --omit=dev

chown -R ata:ata "$DEST"

cat <<EOF

------------------------------------------------------------------
Built: $REPO
  commit   : $COMMIT
  BUILD_ID : $BUILD_ID
  path     : $DEST

To activate:
  # first release only — cutover.sh requires an EXISTING symlink:
  ln -s "$DEST" /srv/ata/current/$REPO

  # every subsequent release:
  sudo bash $SRC_ROOT/deploy/aws/cutover.sh $REPO $COMMIT $BUILD_ID
------------------------------------------------------------------
EOF
