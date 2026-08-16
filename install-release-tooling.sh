#!/bin/bash
#
# ATA release-tooling INSTALLER — put a known source revision into the active path.
#
# WHY THIS EXISTS (RELEASE-TOOLING-SOURCE-OWNERSHIP-1)
#
# The canonical release tooling owns build provenance, artifact verification,
# publishing, cutover, rollback receipts, source selection, cache exclusions and
# release manifests — and it lived only as mutable, unversioned files in
# /home/ubuntu/learner-ops-v1/tools. Corrections to it had no commit, no review
# trail, no rollback, and no reconstruction point beyond the live filesystem.
#
# This script is the deliberate step between the two:
#
#   VERSION-CONTROLLED SOURCE  ->  install  ->  ACTIVE TOOLING PATH
#
# not "edit the active path forever".
#
# WHAT IT IS NOT. It is not an rsync of a directory. Every file it will write is
# ENUMERATED below, and a path outside the active tooling scope is refused before
# anything is read. There is no wildcard, no recursive copy, and no `rm -rf`: it
# writes exactly the files on its list and touches nothing else, so an unrelated
# file that happens to live in the destination cannot be destroyed by it.
#
# FAIL-CLOSED, AND ATOMIC PER FILE. Every source file is verified to exist, to be
# non-empty and to match the manifest hash BEFORE any destination is touched. Each
# file is then written via a temporary file in the destination directory and moved
# into place with `mv`, which is atomic within a filesystem — so a reader can never
# observe a half-written publisher.
#
# THE SOURCE MUST BE CLEAN AND COMMITTED. An install records the source commit in
# the installed manifest, and that record is worthless if the working tree had
# uncommitted edits. A dirty tree is refused, which is the same rule the release
# publisher applies to a candidate.
set -euo pipefail
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }

SRC_ROOT="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

# THE ACTIVE TOOLING PATH. Kept where it already is on purpose: nothing on this
# host references it by any other name, the publisher resolves its verifier as a
# sibling, and moving a live release path to gain tidiness would be operational
# risk bought with no benefit. Version control and the install location are
# deliberately different directories.
DEST_ROOT_DEFAULT="/home/ubuntu/learner-ops-v1/tools"
DEST_ROOT="${ATA_TOOLING_DEST:-$DEST_ROOT_DEFAULT}"

# THE ENUMERATED FILE SET. This list IS the contract: a file not named here is
# neither installed nor verified, and adding one is a reviewable edit.
#
# Relative paths only, and each is resolved under both roots. A path containing
# `..` or starting with `/` is refused below, so this list cannot be made to
# write outside the destination scope.
TOOLING_FILES=(
  "tools/publish-release.sh"
  "tools/build-release.sh"
  "tools/verify-build-provenance.sh"
  "tools/cutover.sh"
  "tools/tests/build-provenance.test.sh"
  "tools/tests/release-packaging.test.sh"
)

INSTALLED_MANIFEST="ATA_TOOLING_INSTALLED.json"

usage() {
  cat >&2 <<USAGE
usage: install-release-tooling.sh [--check|--install] [--dest <path>]

  --check     verify the active tooling matches this source revision, change nothing
  --install   install this source revision into the active tooling path
  --dest      override the destination (tests only; must still be an absolute path)

The active tooling path defaults to $DEST_ROOT_DEFAULT
USAGE
  exit 1
}

MODE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check)   MODE="check"; shift ;;
    --install) MODE="install"; shift ;;
    --dest)    DEST_ROOT="${2:?--dest needs a path}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$MODE" ] || usage

case "$DEST_ROOT" in
  /*) ;;
  *) die "destination must be an absolute path, got '$DEST_ROOT'" ;;
esac

# ---------------------------------------------------------------------------
# The source must be a clean git checkout, so the recorded commit means something
# ---------------------------------------------------------------------------
[ -d "$SRC_ROOT/.git" ] || die "$SRC_ROOT is not a git repository — this installer only installs from version control"
SRC_COMMIT="$(git -C "$SRC_ROOT" rev-parse HEAD 2>/dev/null)" \
  || die "cannot resolve HEAD in $SRC_ROOT — the source revision is not available"
SRC_TREE="$(git -C "$SRC_ROOT" rev-parse HEAD^{tree})"
SRC_BRANCH="$(git -C "$SRC_ROOT" rev-parse --abbrev-ref HEAD)"
[ -z "$(git -C "$SRC_ROOT" status --porcelain --untracked-files=no)" ] \
  || die "source working tree has uncommitted tracked changes.
  An install records the commit it came from, and that record would be a lie.
  Commit the tooling change first, then install it."

# ---------------------------------------------------------------------------
# Verify every source file before touching any destination
# ---------------------------------------------------------------------------
declare -a SRC_HASHES=()
for rel in "${TOOLING_FILES[@]}"; do
  # Structural refusal of anything that could escape the destination scope.
  case "$rel" in
    /*|*..*) die "tooling file '$rel' is not a safe relative path" ;;
  esac

  src="$SRC_ROOT/$rel"
  [ -f "$src" ] || die "source file missing: $rel
  The manifest names a file this revision does not contain. Refusing to install a
  partial tooling set — a publisher without its verifier is worse than neither."
  [ -s "$src" ] || die "source file is empty: $rel"

  # Every canonical tool is a script and must be executable in the source, or the
  # install would silently produce something the operator cannot run.
  [ -x "$src" ] || die "source file is not executable: $rel"

  SRC_HASHES+=("$(sha256sum "$src" | cut -d' ' -f1)")
done

# The source files must be exactly what git has committed. This is what stops an
# install from carrying an edit that was made in the checkout and never committed
# — `git status` above catches tracked edits, and this catches the rest.
i=0
for rel in "${TOOLING_FILES[@]}"; do
  git_hash="$(git -C "$SRC_ROOT" cat-file blob "${SRC_COMMIT}:${rel}" 2>/dev/null | sha256sum | cut -d' ' -f1)" \
    || die "source file '$rel' is not tracked at $SRC_COMMIT"
  [ "$git_hash" = "${SRC_HASHES[$i]}" ] \
    || die "source file '$rel' differs from its committed content — refusing"
  i=$((i+1))
done

printf 'source: %s\n' "$SRC_ROOT"
printf '  commit : %s (%s)\n' "$SRC_COMMIT" "$SRC_BRANCH"
printf '  tree   : %s\n' "$SRC_TREE"
printf '  files  : %s\n' "${#TOOLING_FILES[@]}"
printf 'destination: %s\n' "$DEST_ROOT"

# ---------------------------------------------------------------------------
# CHECK — compare, change nothing
# ---------------------------------------------------------------------------
if [ "$MODE" = "check" ]; then
  drift=0
  i=0
  for rel in "${TOOLING_FILES[@]}"; do
    dest="$DEST_ROOT/$rel"
    if [ ! -f "$dest" ]; then
      printf '  MISSING  %s\n' "$rel"; drift=$((drift+1))
    elif [ "$(sha256sum "$dest" | cut -d' ' -f1)" != "${SRC_HASHES[$i]}" ]; then
      printf '  DIFFERS  %s\n' "$rel"; drift=$((drift+1))
    else
      printf '  ok       %s\n' "$rel"
    fi
    i=$((i+1))
  done
  if [ -f "$DEST_ROOT/$INSTALLED_MANIFEST" ]; then
    installed_commit="$(node -pe "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).source_commit||''" "$DEST_ROOT/$INSTALLED_MANIFEST" 2>/dev/null || echo '')"
    printf '  installed manifest records: %s\n' "${installed_commit:-<unreadable>}"
    [ "$installed_commit" = "$SRC_COMMIT" ] || printf '  NOTE: installed manifest names a different commit than this source HEAD\n'
  else
    printf '  installed manifest: ABSENT\n'; drift=$((drift+1))
  fi
  [ "$drift" -eq 0 ] || die "active tooling does not match this source revision ($drift item(s))"
  printf 'active tooling matches %s\n' "$SRC_COMMIT"
  exit 0
fi

# ---------------------------------------------------------------------------
# INSTALL — enumerated files only, each written atomically
# ---------------------------------------------------------------------------
[ -d "$DEST_ROOT" ] || die "destination $DEST_ROOT does not exist — refusing to create a release-tooling path implicitly"

i=0
for rel in "${TOOLING_FILES[@]}"; do
  src="$SRC_ROOT/$rel"
  dest="$DEST_ROOT/$rel"
  destdir="$(dirname "$dest")"

  # The destination directory must already be inside the scope we were given.
  case "$destdir" in
    "$DEST_ROOT"|"$DEST_ROOT"/*) ;;
    *) die "computed destination '$destdir' is outside $DEST_ROOT — refusing" ;;
  esac
  [ -d "$destdir" ] || install -d -m 0755 "$destdir"

  # Temp file in the SAME directory, so the move is a rename within one
  # filesystem and therefore atomic. A reader never sees a partial script.
  tmp="$(mktemp "$destdir/.ata-tooling-install-XXXXXX")"
  cat "$src" > "$tmp"
  chmod 0755 "$tmp"
  [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "${SRC_HASHES[$i]}" ] \
    || { rm -f "$tmp"; die "staged copy of '$rel' does not match the source hash — refusing"; }
  mv -f "$tmp" "$dest"
  printf '  installed %s\n' "$rel"
  i=$((i+1))
done

# ---------------------------------------------------------------------------
# The installed manifest — how the active tooling names its own source revision
# ---------------------------------------------------------------------------
# WHY THIS EXISTS AND WHAT IT MAY CONTAIN. Without it, "which revision is
# running?" is answerable only by comparing hashes by hand, and mtimes are not
# evidence of anything. It carries the repository, the commit, the tree and a
# hash per installed file — and no secret: nothing here is read from a runtime
# config, and the installer never opens one.
{
  printf '{\n'
  printf '  "schema": "ata.tooling.installed/1",\n'
  printf '  "source_repository": "%s",\n' "$SRC_ROOT"
  printf '  "source_commit": "%s",\n' "$SRC_COMMIT"
  printf '  "source_tree": "%s",\n' "$SRC_TREE"
  printf '  "source_branch": "%s",\n' "$SRC_BRANCH"
  printf '  "installed_at_utc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "installer": "install-release-tooling.sh",\n'
  printf '  "files": {\n'
  i=0
  last=$(( ${#TOOLING_FILES[@]} - 1 ))
  for rel in "${TOOLING_FILES[@]}"; do
    sep=","; [ "$i" -eq "$last" ] && sep=""
    printf '    "%s": "%s"%s\n' "$rel" "${SRC_HASHES[$i]}" "$sep"
    i=$((i+1))
  done
  printf '  }\n'
  printf '}\n'
} > "$DEST_ROOT/$INSTALLED_MANIFEST.tmp"
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$DEST_ROOT/$INSTALLED_MANIFEST.tmp" \
  || { rm -f "$DEST_ROOT/$INSTALLED_MANIFEST.tmp"; die "the installed manifest this script just wrote is not valid JSON"; }
mv -f "$DEST_ROOT/$INSTALLED_MANIFEST.tmp" "$DEST_ROOT/$INSTALLED_MANIFEST"
chmod 0644 "$DEST_ROOT/$INSTALLED_MANIFEST"

printf '\nactive tooling now corresponds to %s\n' "$SRC_COMMIT"
printf 'manifest: %s\n' "$DEST_ROOT/$INSTALLED_MANIFEST"
printf '\nverify with:\n  %s --check\n' "$(readlink -f "$0")"
