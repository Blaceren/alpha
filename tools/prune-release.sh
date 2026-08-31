#!/usr/bin/env bash
# RELEASE-TOOLING-UNIT-VALIDATION-1 — the prune gate, as a tool rather than a
# script typed at the prompt.
#
# The prune protocol was previously run from ad-hoc shell. It worked, but one of
# its eleven checks — "the running service is not inside the directory I am about
# to delete" — was written against the unit name `ata-academy`, which does not
# exist. `systemctl show` answered `MainPID=0`, the check skipped, and the run
# reported all-green. Nothing was lost, because the directories being removed
# had never been active. The check simply never ran.
#
# So the service question is no longer asked here at all. It is delegated to
# service-identity.sh, which refuses an unknown unit instead of defaulting, and
# which knows that the listening socket belongs to a cgroup descendant rather
# than to MainPID.
#
# This tool NEVER deletes. It verifies one release and prints a verdict. The
# removal stays a separate, explicit act by the operator, on the exact absolute
# path this prints — no glob, no age rule, no directory walk.
set -u
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/service-identity.sh"

COMPONENT="${1:?component}"
PREFIX="${2:?release prefix}"
REL_DIR="/srv/ata/releases/${COMPONENT}"
ata_unit_for "$COMPONENT" >/dev/null || die "unknown component '$COMPONENT'"
[ -d "$REL_DIR" ] || die "no release directory for $COMPONENT"

echo "=== prune gate: $COMPONENT $PREFIX"

# 1 — the prefix must resolve to exactly one absolute path inside REL_DIR.
mapfile -t HITS < <(find "$REL_DIR" -mindepth 1 -maxdepth 1 -name "${PREFIX}*" -print)
[ "${#HITS[@]}" -eq 1 ] || die "prefix matches ${#HITS[@]} paths, must be exactly 1"
P="${HITS[0]}"; SHA="$(basename "$P")"
case "$P" in "$REL_DIR"/*) ;; *) die "resolved path escapes $REL_DIR" ;; esac
[ "${#SHA}" -eq 40 ] || die "release name is not a 40-char commit"
echo "  1 exactly one path      : $P"

# 2/3 — manifest, read in full, provenance echoed.
M="$P/ATA_RELEASE_MANIFEST.json"
[ -f "$M" ] || die "no manifest in $P"
MC="$(grep -oE '"source_commit": *"[0-9a-f]{40}"' "$M" | grep -oE '[0-9a-f]{40}')"
MT="$(grep -oE '"source_tree": *"[0-9a-f]{40}"' "$M" | grep -oE '[0-9a-f]{40}')"
MB="$(grep -oE '"build_id": *"[^"]+"' "$M" | sed 's/.*: *"//;s/"//')"
echo "  2 manifest              : $M"
echo "  3 commit/tree/build     : ${MC:-<none>} / ${MT:-<none>} / ${MB:-<none>}"
[ "$MC" = "$SHA" ] || die "manifest source_commit $MC != directory name $SHA"

# 4 — never activated at publish time.
ACT="$(grep -oE '"activated_at_publish_time": *(true|false)' "$M" | grep -oE '(true|false)')"
echo "  4 activated_at_publish  : ${ACT:-<absent>}"
[ "$ACT" = "false" ] || die "activated_at_publish_time is not false"

# 5 — a real directory, not a symlink.
[ -L "$P" ] && die "release path is a symlink"
[ -d "$P" ] || die "release path is not a directory"
echo "  5 real directory        : yes"

# 6 — no live symlink for ANY component may point into it.
echo "  6 /srv/ata/current/*:"
for s in /srv/ata/current/*; do
  [ -e "$s" ] || continue
  T="$(readlink -f "$s")"
  printf '      %-9s -> %s\n' "$(basename "$s")" "$T"
  case "$T" in "$P"|"$P"/*) die "$s points into the prune target" ;; esac
done

# 7 — the running service of EVERY component must verify, and none may be
#     running out of this path. This is the check that used to skip.
echo "  7 live service identity:"
for c in $(ata_components); do
  ata_verify_service "$c" || die "service identity failed for $c — refusing to prune anything while the fleet is not verifiably healthy"
  RUNNING="$(_ata_proc_cwd "$(_ata_systemctl_show "$(ata_unit_for "$c")" MainPID)")"
  case "$RUNNING" in "$P"|"$P"/*) die "the running $c service is inside the prune target" ;; esac
done

# 8 — no live reference. A prune record is history; a cutover receipt is not.
echo "  8 references:"
if ata_release_is_referenced "$P" "$SHA"; then
  die "referenced by something live"
fi
echo "      no live references"

echo "  PRUNABLE: $P  ($(du -sm "$P" 2>/dev/null | cut -f1) MiB)"
echo "  This tool does not delete. Remove exactly that absolute path, and nothing else."
