#!/bin/bash
#
# ATA build-provenance verifier — the ONE implementation of the rule.
#
# WHY IT IS ITS OWN SCRIPT. The publisher resolves its source workspace from a
# fixed per-component mapping, deliberately: the caller may name a component, never
# a path. That is a safety property and it is not being relaxed. But it also means
# the publisher cannot be pointed at a synthetic workspace, so a regression that
# tried to exercise its refusal path would have had to REIMPLEMENT the rule — and a
# test that restates the logic it is testing proves nothing about the shipped code.
#
# So the rule lives here, the publisher calls it, and the regression calls the same
# script with synthetic inputs. There is exactly one implementation and it is the
# one that runs in production.
#
# WHAT IT PROVES
#
#   the artifact in <src>/.next was produced by tools/build-release.sh
#   FROM EXACTLY <commit>/<tree>, and is still the artifact that record describes
#
# It fails closed on every other case: missing record, malformed record, unknown
# schema, another component's record, another commit, another tree, and a record
# whose BUILD_ID no longer matches what is actually in .next.
#
# Usage:  verify-build-provenance.sh <component> <src> <commit> <tree> <build_id>
# Exit 0 and print a one-line summary on success; exit 1 with REFUSING: on failure.
set -euo pipefail
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }

[ "$#" -eq 5 ] || die "usage: verify-build-provenance.sh <component> <src> <commit> <tree> <build_id>"
COMPONENT="${1:?component}"
SRC="${2:?source workspace}"
COMMIT="${3:?expected commit}"
TREE="${4:?expected tree}"
# Deliberately allowed to be EMPTY. An absent .next/BUILD_ID is a real state —
# a dev build, a wiped artifact, a half-finished build — and it must produce the
# BUILD_ID refusal below, which names the actual problem, rather than a usage
# error that tells the operator nothing about their release.
BUILD_ID="${5-}"

PROVENANCE_FILE=".next/ATA_BUILD_PROVENANCE.json"
PROVENANCE_SCHEMA="ata.build.provenance/1"
PROV_PATH="$SRC/$PROVENANCE_FILE"

REBUILD_HINT="tools/build-release.sh $COMPONENT"

[ -f "$PROV_PATH" ] || die "no $PROVENANCE_FILE — this artifact has no build provenance.
  A .next directory is not evidence that the current source has been built: the
  release that prompted this gate had a perfectly valid .next built from an
  EARLIER commit. Build it canonically and publish again:

      $REBUILD_HINT"

node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$PROV_PATH" >/dev/null 2>&1 \
  || die "$PROVENANCE_FILE is not valid JSON — refusing to guess what it meant"

prov_field() {
  node -pe "const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]]; typeof v==='string'?v:''" \
    "$PROV_PATH" "$1" 2>/dev/null
}

PROV_SCHEMA="$(prov_field schema)"
PROV_COMPONENT="$(prov_field component)"
PROV_COMMIT="$(prov_field source_commit)"
PROV_TREE="$(prov_field source_tree)"
PROV_BUILD_ID="$(prov_field build_id)"
PROV_ENV_ID="$(prov_field build_env_identity)"

# An unknown schema is refused rather than read optimistically: a future record
# shape may mean something different by the same field names.
[ "$PROV_SCHEMA" = "$PROVENANCE_SCHEMA" ] \
  || die "build provenance schema '$PROV_SCHEMA' is not '$PROVENANCE_SCHEMA' — refusing"

[ "$PROV_COMPONENT" = "$COMPONENT" ] \
  || die "build provenance is for component '$PROV_COMPONENT', publishing '$COMPONENT' — refusing"

# THE INCIDENT. Source moved on; the artifact did not.
[ "$PROV_COMMIT" = "$COMMIT" ] \
  || die "STALE ARTIFACT. The artifact in .next was built from $PROV_COMMIT, but
  $COMMIT is being published. This is the exact defect this gate exists for: the
  source is correct and the compiled output is from an earlier revision.

      $REBUILD_HINT"

[ "$PROV_TREE" = "$TREE" ] \
  || die "build provenance records source tree $PROV_TREE, publishing $TREE — refusing"

# THE OTHER DIRECTION. `.next` was rebuilt by something that is not the canonical
# builder (a bare `npm run build`, an IDE, a dev server), so the record survives
# but no longer describes what is present.
[ -n "$PROV_BUILD_ID" ] && [ "$PROV_BUILD_ID" = "$BUILD_ID" ] \
  || die "build provenance records BUILD_ID '$PROV_BUILD_ID' but .next/BUILD_ID is
  '$BUILD_ID'. The artifact has been rebuilt by something other than the canonical
  builder since this record was written, so the record no longer describes what is
  here.

      $REBUILD_HINT"

[ -n "$PROV_ENV_ID" ] || die "build provenance carries no build_env_identity — refusing"

printf 'build provenance: %s built %s from %s (env %s)\n' \
  "$PROV_COMPONENT" "$PROV_BUILD_ID" "${PROV_COMMIT:0:12}" "${PROV_ENV_ID:0:12}"
