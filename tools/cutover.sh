#!/bin/bash
#
# G3 cutover — repoint ONE component's `current` symlink at a published release
# and restart its service.
#
# SAFETY MODEL
#   * Refuses unless the destination release exists, is a real directory, and
#     carries a built .next with the expected BUILD_ID.
#   * Refuses unless the current symlink is a symlink pointing at an existing
#     release (so the rollback point is real and recorded before anything moves).
#   * The swap is an atomic rename, never "delete then create". At no instant is
#     /srv/ata/current/<c> missing or dangling.
#   * It never removes a release directory. There is no rm of any release here.
#
set -euo pipefail
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }

REPO="${1:?repo}"; COMMIT="${2:?commit}"; EXPECT_BUILD_ID="${3:?build id}"
# `partner` was missing here, and that omission — not any property of the
# console itself — is why Partner is the one component with no canonical
# rollback receipt. The receipt is written by this script and only by this
# script, so a component it refuses to run for can never acquire one. Nothing
# below is component-specific: the same symlink, BUILD_ID, node_modules and
# unit checks apply unchanged (ROLLBACK-ANCHOR-DRIFT-1 / PARTNER-ROLLBACK-CONSISTENCY-1).
case "$REPO" in backend|academy|crm|partner) ;; *) die "unknown repo '$REPO'" ;; esac

LINK="/srv/ata/current/${REPO}"
DEST="/srv/ata/releases/${REPO}/${COMMIT}"
UNIT="ata-preprod-${REPO}"

[ -L "$LINK" ] || die "$LINK is not a symlink — refusing to touch it"
PREV="$(readlink "$LINK")"
[ -d "$PREV" ] || die "current target $PREV is not an existing directory"
[ -d "$DEST" ] || die "destination release $DEST does not exist"
[ -L "$DEST" ] && die "destination $DEST is a symlink, expected a real directory"
[ "$PREV" = "$DEST" ] && die "already pointing at $DEST — nothing to do"

ACTUAL_BUILD_ID="$(cat "$DEST/.next/BUILD_ID" 2>/dev/null || echo MISSING)"
[ "$ACTUAL_BUILD_ID" = "$EXPECT_BUILD_ID" ] || die "BUILD_ID $ACTUAL_BUILD_ID != expected $EXPECT_BUILD_ID"
[ -d "$DEST/node_modules" ] || die "destination has no node_modules"
[ -f "$DEST/package.json" ] || die "destination has no package.json"

# stat does not follow symlinks unless -L is given, so this is the link's own owner.
OWNER="$(stat -c '%U:%G' "$LINK")"

echo "cutover ${REPO}"
echo "  rollback point : $PREV"
echo "  new target     : $DEST"
echo "  BUILD_ID       : $ACTUAL_BUILD_ID"
printf '%s\n' "$PREV" > "/srv/ata-data/access-control/.cutover-rollback-${REPO}"
chmod 0600 "/srv/ata-data/access-control/.cutover-rollback-${REPO}"

# Atomic swap: build the new link beside the old one, then rename over it.
TMPLINK="/srv/ata/current/.cutover-${REPO}.$$"
ln -s "$DEST" "$TMPLINK"
chown -h "$OWNER" "$TMPLINK"
mv -T "$TMPLINK" "$LINK"

NOW="$(readlink "$LINK")"
[ "$NOW" = "$DEST" ] || die "post-swap symlink reads $NOW, expected $DEST"
echo "  symlink swapped: $LINK -> $NOW"

systemctl restart "$UNIT"

# Wait for the unit to come up and settle, rather than assuming.
for i in $(seq 1 60); do
  st="$(systemctl show "$UNIT" -p ActiveState --value)"
  sub="$(systemctl show "$UNIT" -p SubState --value)"
  [ "$st" = "active" ] && [ "$sub" = "running" ] && break
  [ "$st" = "failed" ] && die "$UNIT entered failed state after restart"
  sleep 1
done
st="$(systemctl show "$UNIT" -p ActiveState --value)"
[ "$st" = "active" ] || die "$UNIT is $st after restart"

echo "  unit: $st/$(systemctl show "$UNIT" -p SubState --value) pid=$(systemctl show "$UNIT" -p ExecMainPID --value) NRestarts=$(systemctl show "$UNIT" -p NRestarts --value)"
echo "  cwd : $(sudo readlink /proc/$(systemctl show "$UNIT" -p ExecMainPID --value)/cwd 2>/dev/null || echo '?')"
