#!/bin/bash
#
# ATA canonical release BUILD — produce a release artifact and prove where it came from.
#
# WHY THIS SCRIPT EXISTS (RELEASE-BUILD-PROVENANCE-1)
#
# The publisher had two verification systems that never met.
#
#   TREE VERIFICATION iterates `git ls-tree -r --name-only $COMMIT`, which names
#   TRACKED files only. `.next` is gitignored in all four components, so the
#   generated artifact was never enumerated and never compared with anything.
#
#   THE ARTIFACT GATE proves `.next` IS a production build and SERVES. Every one
#   of its checks is satisfied by ANY valid production build of ANY revision.
#
# Nothing related `.next` to the commit being published. A Backend release
# therefore shipped correct source, a truthful manifest, a passing artifact gate
# and a compiled route that did not contain the code the source declared. It was
# found only by querying the live API.
#
# WHAT THIS SCRIPT ESTABLISHES
#
# It is the ONLY supported way to produce a publishable artifact. It captures the
# commit and tree BEFORE building, builds under the canonical environment, and
# then writes a provenance record binding the artifact it just produced to the
# source it was produced from. The publisher refuses anything without a matching
# record, so a stale `.next` cannot be published under a newer source revision.
#
# WHY THE RECORD LIVES INSIDE `.next`
#
# Because that is the thing whose provenance is in question. `next build` clears
# `.next`, so any rebuild destroys the record — a rebuild by other means leaves
# no record at all and the publisher refuses. It also travels with the artifact
# into the release, where the manifest can quote it.
#
# WHY THE PUBLISHER DOES NOT SIMPLY BUILD (evaluated first, per the brief)
#
# It would be the strongest model and it was rejected for one concrete reason:
# it would couple the publisher to each component's RUNTIME configuration. The
# Academy build fails without ACADEMY_MODE, the CRM needs its mode and origin,
# the Backend needs a DATABASE_URL for Prisma — and those live in root-owned
# files under /srv/ata/config. Making the publisher read them would mean a
# publisher that cannot run for a component whose runtime config is not
# installed on that host, and would drag secrets toward a step that has no need
# of them. Keeping the environment knowledge HERE, in one tooling place, and
# having the publisher verify only the RESULT keeps the publisher free of build
# and environment coupling while making stale artifacts impossible either way.
#
set -euo pipefail
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }

REPO="${1:?usage: build-release.sh <backend|academy|crm|partner>}"

# The same mapping the publisher uses. The regression asserts the two agree, so
# a component added to one and not the other is caught rather than discovered.
case "$REPO" in
  backend|crm|academy) SRC="/home/ubuntu/learner-ops-v1/${REPO}" ;;
  partner)             SRC="/home/ubuntu/affiliate-work/${REPO}" ;;
  *) die "unknown repo '$REPO'" ;;
esac
[ -d "$SRC" ] || die "candidate workspace $SRC does not exist"
[ -d "$SRC/.git" ] || die "$SRC is not a git repository"

PROVENANCE_FILE=".next/ATA_BUILD_PROVENANCE.json"
PROVENANCE_SCHEMA="ata.build.provenance/1"

# ---------------------------------------------------------------------------
# 1. The source must be committed BEFORE it is built.
# ---------------------------------------------------------------------------
# A build of a dirty workspace corresponds to no commit at all, so there is
# nothing honest to record. This is the same rule the publisher already applies
# to the tree; applying it here as well is what makes the recorded commit mean
# something.
[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ] \
  || die "workspace has uncommitted tracked changes — commit them before building a release artifact"

COMMIT="$(git -C "$SRC" rev-parse HEAD)"
TREE="$(git -C "$SRC" rev-parse HEAD^{tree})"
BRANCH="$(git -C "$SRC" rev-parse --abbrev-ref HEAD)"

# ---------------------------------------------------------------------------
# 2. The canonical BUILD environment.
# ---------------------------------------------------------------------------
# WHAT IS AND IS NOT READ HERE. Only variables that change what the COMPILER
# produces. The runtime env files under /srv/ata/config are NEVER sourced and
# never parsed wholesale: this reads an explicit per-component ALLOWLIST of
# non-secret keys with a line-anchored match, so a secret cannot be picked up
# even if one were added to the file later.
#
# The Academy is the reason this exists at all: a bare `next build` without
# ACADEMY_MODE fails prerendering `/showcase/video-player`, because the config
# contract deliberately refuses to guess a mode in production. Building without
# it would either fail or — worse, if the guard were ever relaxed — silently
# produce an artifact with different product semantics from the release.
#
# `read_env_key` never echoes a value it was not asked for, and no value reaches
# argv: the build runs with these exported into its own environment.
CONFIG_DIR="/srv/ata/config"

# The ONE set of keys this script may ever read from a runtime config file.
#
# It is a hard allowlist rather than a convention, because the read below can
# elevate: /srv/ata/config is `drwx------ ata:ata`, so a build running as an
# ordinary user cannot open it directly. Elevating to read an ARBITRARY key from
# a file that also contains secrets would be a credential-reading primitive
# wearing a build script's name. Enumerating the legal keys here means the worst
# an elevated read can do is fetch a mode or an origin.
#
# Every key on this list is non-secret and compile-relevant: it changes what the
# compiler produces. Nothing here is a password, a token or a signing key, and a
# key that became one would have to be added to this list in review first.
READABLE_CONFIG_KEYS=(
  ACADEMY_MODE BACKEND_ORIGIN
  CRM_MODE CRM_BACKEND_ORIGIN
  PARTNER_BACKEND_ORIGIN
)

is_readable_key() {
  local candidate="$1" k
  for k in "${READABLE_CONFIG_KEYS[@]}"; do [ "$k" = "$candidate" ] && return 0; done
  return 1
}

read_env_key() {
  local file="$1" key="$2"

  # The allowlist is checked BEFORE anything opens the file, so an unlisted key
  # is refused rather than merely absent.
  is_readable_key "$key" || die "internal: '$key' is not an allowlisted build config key"

  # Line-anchored, first match, VALUE ONLY. This is not a shell source: nothing
  # is evaluated, expanded or executed, and no other line of the file is read.
  local extract="s/^${key}=\(.*\)\$/\1/p"

  if [ -r "$file" ]; then
    sed -n "$extract" "$file" | head -1
    return 0
  fi

  # Narrow elevation. /srv/ata/config is `drwx------ ata:ata`, so an ordinary
  # build user cannot open it directly.
  #
  # Only the KEY NAME reaches argv — never a value; the value arrives on stdout
  # and is captured into a variable, never echoed and never logged. `-n` so a
  # build never blocks on a password prompt, and the result is simply "no value",
  # which the caller turns into an explicit refusal rather than a silent default.
  #
  # The read is ATTEMPTED rather than probed for: `sudo test -r` is not
  # necessarily permitted by the same policy that permits `sudo sed`, so probing
  # first reports "unreadable" for a file that is in fact readable — which is
  # exactly what happened, and cost a build.
  sudo -n sed -n "$extract" "$file" 2>/dev/null | head -1
}

declare -a BUILD_ENV=()
add_env() { BUILD_ENV+=("$1=$2"); }

require_from_config() {
  local component="$1" key="$2"
  local file="${CONFIG_DIR}/${component}.env" value
  value="$(read_env_key "$file" "$key" || true)"
  [ -n "$value" ] || die "canonical build env: ${key} is not set in ${file}
  The release build must use the same compile-time environment as the service.
  Refusing rather than building an artifact with different semantics."
  add_env "$key" "$value"
}

optional_from_config() {
  local component="$1" key="$2"
  local file="${CONFIG_DIR}/${component}.env" value
  value="$(read_env_key "$file" "$key" || true)"
  [ -n "$value" ] && add_env "$key" "$value" || true
}

# Common to every component. Declared explicitly rather than inherited, so the
# build does not depend on whatever happened to be in the operator's shell.
add_env NODE_ENV production
add_env NEXT_TELEMETRY_DISABLED 1

case "$REPO" in
  backend)
    # Prisma needs a DATABASE_URL to generate its client. It is deliberately a
    # THROWAWAY path and never the live preprod database: a build must not be
    # able to read, lock or migrate real data. The value is not a secret and is
    # not read from the runtime config for exactly that reason.
    add_env DATABASE_URL "file:/tmp/ata-release-build-${REPO}.sqlite"
    ;;
  academy)
    require_from_config academy ACADEMY_MODE
    require_from_config academy BACKEND_ORIGIN
    ;;
  crm)
    require_from_config crm CRM_MODE
    require_from_config crm CRM_BACKEND_ORIGIN
    ;;
  partner)
    # FE-8 — REQUIRED, not optional, and the distinction is the whole console.
    #
    # WHAT "OPTIONAL" COST. This read used to be `optional_from_config`, on the
    # reasoning that "with it absent the rewrite list is empty and the app still
    # builds and renders". Both halves are true and the conclusion was wrong: the
    # partner console reaches the Backend ONLY through the Next rewrites in
    # next.config.mjs, and `rewrites()` is evaluated at BUILD time and frozen
    # into .next/routes-manifest.json. An artifact built without this value has
    # ZERO rewrite rules for the rest of its life, so every one of the ten
    # partner API paths 404s at the partner origin and no partner can sign in.
    # The runtime env cannot repair it: `next start` never calls rewrites().
    #
    # That artifact shipped. PREPROD ran a console on which `POST
    # /api/partner/v1/session` answered 404 — not 401 — and the release record
    # said "passed: 8 compiled pages, next start served, critical route
    # answered", because /login renders perfectly with no rewrites at all.
    #
    # WHY IT WENT MISSING AT ALL. `read_env_key` elevates with `sudo -n`, which
    # yields empty output whenever no sudo credential happens to be cached.
    # Under `optional_from_config` that empty result was indistinguishable from
    # "the operator did not set it", and both were silently accepted — so
    # whether the console worked depended on the operator's sudo timestamp.
    # `require_from_config` collapses that ambiguity the way academy and crm
    # already do: a value that cannot be read is a refused build, not a quiet
    # change of semantics.
    require_from_config partner PARTNER_BACKEND_ORIGIN
    ;;
esac

# The env IDENTITY: a digest over the sorted KEY=VALUE set that defines the build
# CONTRACT. It lets an auditor tell whether two artifacts were built under the
# same contract without the record having to restate the values. Every value in
# the set is non-secret by allowlist construction.
#
# HOST TUNING IS DELIBERATELY OUTSIDE IT (see NODE_OPTIONS below). Two artifacts
# built from the same source under the same semantic contract must compare equal
# even if one host needed a bigger heap to get through static generation. So the
# identity is computed HERE, over the contract only, and the record names exactly
# the keys this digest covers — the two can never disagree about their own scope.
BUILD_ENV_IDENTITY="$(printf '%s\n' "${BUILD_ENV[@]}" | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
BUILD_ENV_KEYS="$(printf '%s\n' "${BUILD_ENV[@]}" | cut -d= -f1 | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"

printf 'canonical build: %s\n' "$REPO"
printf '  source   : %s\n' "$SRC"
printf '  commit   : %s\n' "$COMMIT"
printf '  tree     : %s\n' "$TREE"
printf '  env keys : %s\n' "$(printf '%s\n' "${BUILD_ENV[@]}" | cut -d= -f1 | LC_ALL=C sort | tr '\n' ' ')"
printf '  env id   : %s\n' "$BUILD_ENV_IDENTITY"

# ---------------------------------------------------------------------------
# 3. Build.
# ---------------------------------------------------------------------------
# The record is removed FIRST. A build that fails halfway must not leave the
# previous run's provenance sitting beside a half-written artifact — the
# publisher would then be looking at a record that describes something else.
rm -f "$SRC/$PROVENANCE_FILE"

# HOST TUNING, not part of the build contract. Node's default heap is not enough
# for the Backend's static generation on this host; it OOMs during "Generating
# static pages". Raised for every component so the build does not depend on which
# one happens to be near the limit today. It is applied to the build but is NOT
# in `build_env_identity`, because needing a bigger heap on one machine does not
# make the resulting artifact a different thing.
BUILD_HOST_TUNING="NODE_OPTIONS=--max-old-space-size=6144"
BUILD_ENV+=("$BUILD_HOST_TUNING")

# The env is applied to the build process only. `env -i` is deliberately NOT
# used: npm and node need PATH and HOME, and stripping them would break the
# build for no security gain — every value added above is non-secret.
(
  cd "$SRC"
  for kv in "${BUILD_ENV[@]}"; do export "${kv?}"; done
  npm run build
) || die "the canonical build failed — no provenance was written, so nothing is publishable"

# ---------------------------------------------------------------------------
# 4. Prove the build corresponds to the source it started from.
# ---------------------------------------------------------------------------
[ -d "$SRC/.next" ] || die "build produced no .next"
[ -f "$SRC/.next/BUILD_ID" ] || die "build produced no .next/BUILD_ID — this is not a production build"
BUILD_ID="$(cat "$SRC/.next/BUILD_ID")"
[ -n "$BUILD_ID" ] || die ".next/BUILD_ID is empty"

# THE WINDOW THIS CLOSES. A build takes minutes, and a workspace is a live
# directory. If the source moved while the compiler was running, the artifact
# corresponds to neither state — so the commit and tree are re-read and must be
# unchanged, and the workspace must still be clean.
AFTER_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
AFTER_TREE="$(git -C "$SRC" rev-parse HEAD^{tree})"
[ "$AFTER_COMMIT" = "$COMMIT" ] || die "source commit changed during the build ($COMMIT -> $AFTER_COMMIT) — rebuild"
[ "$AFTER_TREE" = "$TREE" ]     || die "source tree changed during the build — rebuild"
[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ] \
  || die "workspace became dirty during the build — the artifact matches no commit; rebuild"

cat > "$SRC/$PROVENANCE_FILE" <<JSON
{
  "schema": "${PROVENANCE_SCHEMA}",
  "component": "${REPO}",
  "source_repository": "${SRC}",
  "source_commit": "${COMMIT}",
  "source_tree": "${TREE}",
  "source_branch": "${BRANCH}",
  "build_id": "${BUILD_ID}",
  "build_env_identity": "${BUILD_ENV_IDENTITY}",
  "build_env_keys": "${BUILD_ENV_KEYS}",
  "build_host_tuning": "${BUILD_HOST_TUNING%%=*}",
  "builder": "tools/build-release.sh",
  "node_version": "$(node -v)",
  "npm_version": "$(npm -v)",
  "built_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

node -e "JSON.parse(require('fs').readFileSync('$SRC/$PROVENANCE_FILE','utf8'))" \
  || die "the provenance record this script just wrote is not valid JSON"

printf '\nbuild provenance written: %s\n' "$SRC/$PROVENANCE_FILE"
printf '  BUILD_ID : %s\n' "$BUILD_ID"
printf '  bound to : %s (tree %s)\n' "$COMMIT" "$TREE"
printf '\nthis artifact is now publishable as:\n  %s %s %s %s\n' \
  "tools/publish-release.sh" "$REPO" "$COMMIT" "$TREE"
