#!/usr/bin/env bash
#
# ATA production cutover — repoint ONE component's `current` symlink at a
# published release and restart its service.
#
#   sudo bash deploy/aws/cutover.sh <backend|academy|crm> <commit> <build-id>
#
# ---------------------------------------------------------------------------
# PROVENANCE. This is a derivative of tools/cutover.sh, which is vendored from
# an external repository (see tools/ATA_TOOLING_INSTALLED.json — source
# /home/ubuntu/ata-release-tooling @ 632ec277). The safety model below is that
# script's, essentially unchanged.
#
# IT IS A SEPARATE FILE RATHER THAN A PATCH, DELIBERATELY. The original hardcodes
# `UNIT="ata-preprod-${REPO}"`, and this deployment's units are `ata-prod-*`.
# Editing the vendored copy in place would leave the SHA-256 recorded for it in
# ATA_TOOLING_INSTALLED.json silently untrue — nothing in this repository
# verifies that manifest today, which is exactly what makes a quiet divergence
# easy to create and hard to notice later. tools/ is left byte-identical to
# upstream; this file is ours and is the one to maintain.
#
# CHANGES FROM THE ORIGINAL
#   1. Unit prefix is configurable (ATA_UNIT_PREFIX, default ata-prod).
#   2. `partner` is not accepted — that component is not in this repository.
#   3. The final diagnostic no longer shells out to `sudo`; this runs as root.
# ---------------------------------------------------------------------------
#
# SAFETY MODEL (unchanged)
#   * Refuses unless the destination release exists, is a real directory, and
#     carries a built .next with the expected BUILD_ID.
#   * Refuses unless the current symlink is a symlink pointing at an existing
#     release, so the rollback point is real and recorded before anything moves.
#   * The swap is an atomic rename, never "delete then create". At no instant is
#     /srv/ata/current/<c> missing or dangling.
#   * It never removes a release directory.

set -euo pipefail
die() { printf 'REFUSING: %s\n' "$1" >&2; exit 1; }

REPO="${1:?usage: cutover.sh <backend|academy|crm> <commit> <build-id>}"
COMMIT="${2:?commit}"
EXPECT_BUILD_ID="${3:?build id}"

UNIT_PREFIX="${ATA_UNIT_PREFIX:-ata-prod}"

case "$REPO" in
  backend|academy|crm) ;;
  partner) die "'partner' is not part of this repository — see README.md, Known divergences" ;;
  *) die "unknown repo '$REPO'" ;;
esac

[ "$(id -u)" -eq 0 ] || die "must run as root"

LINK="/srv/ata/current/${REPO}"
DEST="/srv/ata/releases/${REPO}/${COMMIT}"
UNIT="${UNIT_PREFIX}-${REPO}"

[ -L "$LINK" ] || die "$LINK is not a symlink — refusing to touch it. For the FIRST release, create it by hand: ln -s $DEST $LINK"
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
echo "  unit           : $UNIT"

mkdir -p /srv/ata-data/access-control
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
for _ in $(seq 1 60); do
  st="$(systemctl show "$UNIT" -p ActiveState --value)"
  sub="$(systemctl show "$UNIT" -p SubState --value)"
  [ "$st" = "active" ] && [ "$sub" = "running" ] && break
  [ "$st" = "failed" ] && die "$UNIT entered failed state after restart"
  sleep 1
done

st="$(systemctl show "$UNIT" -p ActiveState --value)"
[ "$st" = "active" ] || die "$UNIT is $st after restart"

PID="$(systemctl show "$UNIT" -p ExecMainPID --value)"
echo "  unit: $st/$(systemctl show "$UNIT" -p SubState --value) pid=$PID NRestarts=$(systemctl show "$UNIT" -p NRestarts --value)"
echo "  cwd : $(readlink "/proc/$PID/cwd" 2>/dev/null || echo '?')"

echo
echo "Rollback if needed:"
echo "  $0 $REPO \$(basename \"$PREV\") \$(cat \"$PREV/.next/BUILD_ID\")"
