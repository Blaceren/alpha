#!/usr/bin/env bash
# RELEASE-TOOLING-UNIT-VALIDATION-1 — the refusals, proved by execution.
#
# The defect this pins is not a wrong comparison. It is a comparison that never
# ran: `systemctl show <nonexistent-unit> -p MainPID --value` prints `0` and
# exits 0, so a gate written against the wrong unit name reported green while
# checking nothing. Reading the source cannot tell you whether that happens —
# only running it can. So every case below drives the real function with the
# outside world replaced, and asserts a REFUSAL.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../service-identity.sh"

pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n' "$1"; printf '       %s\n' "${2:-}"; fail=$((fail+1)); }

# A healthy world, which each case then breaks in exactly one place.
GOOD_DIR=/srv/ata/releases/academy/aaaaaaaa
reset_world() {
  _ata_systemctl_show() {
    case "$1:$2" in
      ata-preprod-academy.service:LoadState)   printf 'loaded' ;;
      ata-preprod-academy.service:ActiveState) printf 'active' ;;
      ata-preprod-academy.service:SubState)    printf 'running' ;;
      ata-preprod-academy.service:MainPID)     printf '4001' ;;
      ata-preprod-crm.service:LoadState)       printf 'loaded' ;;
      ata-preprod-crm.service:ActiveState)     printf 'active' ;;
      ata-preprod-crm.service:SubState)        printf 'running' ;;
      ata-preprod-crm.service:MainPID)         printf '5001' ;;
      # An unknown unit: systemd prints nothing, and MainPID reads 0.
      *:MainPID) printf '0' ;;
      *) printf '' ;;
    esac
  }
  _ata_proc_exists() { case "$1" in 4001|4002|5001) return 0 ;; *) return 1 ;; esac; }
  _ata_proc_cwd()    { case "$1" in 4001) printf '%s' "$GOOD_DIR" ;; 5001) printf '/srv/ata/releases/crm/cccccccc' ;; *) printf '' ;; esac; }
  _ata_symlink()     { case "$1" in academy) printf '%s' "$GOOD_DIR" ;; crm) printf '/srv/ata/releases/crm/cccccccc' ;; *) printf '' ;; esac; }
  _ata_cgroup_pids() { case "$1" in ata-preprod-academy.service) printf '4001\n4002\n' ;; ata-preprod-crm.service) printf '5001\n' ;; *) printf '' ;; esac; }
  _ata_port_pids()   { case "$1" in 3050) printf '4002\n' ;; 3010) printf '5001\n' ;; *) printf '' ;; esac; }
}

# Sanity: the healthy world must PASS, or every refusal below proves nothing.
reset_world
if ata_verify_service academy >/dev/null 2>&1; then ok "0  a healthy academy verifies"
else no "0  a healthy academy verifies" "the fixture is wrong; the refusals below would be vacuous"; fi

# 1 — a unit name that does not exist
reset_world
if ata_verify_service nosuchcomponent >/dev/null 2>&1; then
  no "1  unknown component is refused" "an unregistered component must never resolve to a default unit"
else ok "1  unknown component is refused"; fi

# 1b — a REGISTERED component whose unit is absent from systemd: the exact
#      shape of the original defect, where every field reads empty.
reset_world
_ata_systemctl_show() { case "$2" in MainPID) printf '0' ;; *) printf '' ;; esac; }
if ata_verify_service academy >/dev/null 2>&1; then
  no "1b absent unit is refused" "empty LoadState was treated as loaded — this is the original bug"
else ok "1b absent unit is refused (empty LoadState, MainPID=0)"; fi

# 2 — the right unit, but MainPID is 0
reset_world
_ata_systemctl_show() {
  case "$2" in LoadState) printf 'loaded' ;; ActiveState) printf 'active' ;; SubState) printf 'running' ;; MainPID) printf '0' ;; *) printf '' ;; esac
}
if ata_verify_service academy >/dev/null 2>&1; then
  no "2  MainPID=0 is refused" "MainPID 0 must be a refusal, not a skipped check"
else ok "2  MainPID=0 is refused"; fi

# 2b — MainPID names a process that no longer exists
reset_world
_ata_proc_exists() { return 1; }
if ata_verify_service academy >/dev/null 2>&1; then
  no "2b missing /proc is refused" "a stale MainPID must not pass"
else ok "2b missing /proc entry is refused"; fi

# 3 — MainPID belongs to a different service
reset_world
_ata_proc_cwd() { printf '/srv/ata/releases/crm/cccccccc'; }   # academy's pid sitting in the crm release
if ata_verify_service academy >/dev/null 2>&1; then
  no "3  another service's PID is refused" "cwd of a foreign release must not verify"
else ok "3  a PID running out of another component's release is refused"; fi

# 4 — the symlink is right, but the process is running out of something else
reset_world
_ata_proc_cwd() { printf '/srv/ata/releases/academy/deadbeef'; }
if ata_verify_service academy >/dev/null 2>&1; then
  no "4  cwd != symlink is refused" "this is the drift a cutover must never leave behind"
else ok "4  correct symlink but foreign cwd is refused"; fi

# 5 — the right PID, but the port is held by something outside the cgroup
reset_world
_ata_port_pids() { printf '9999\n'; }
if ata_verify_service academy >/dev/null 2>&1; then
  no "5  foreign port owner is refused" "a port held outside the unit's cgroup must not verify"
else ok "5  port held by a PID outside the cgroup is refused"; fi

# 5b — nothing listening at all
reset_world
_ata_port_pids() { printf ''; }
if ata_verify_service academy >/dev/null 2>&1; then
  no "5c silent port is refused" "an unbound port must not verify"
else ok "5b nothing listening on the expected port is refused"; fi

# 6 — Academy mistakenly verified as CRM. Both are healthy; the mix-up must
#     still fail, because academy's release is not where crm is running.
reset_world
if ata_verify_service crm "$GOOD_DIR" >/dev/null 2>&1; then
  no "6  academy checked as crm is refused" "the crm unit verified against the academy release directory"
else ok "6  academy's release checked against the crm unit is refused"; fi

# 6b — and the registry must not let the two share a port or a unit.
[ "$(ata_port_for academy)" != "$(ata_port_for crm)" ] \
  && ok "6b academy and crm have distinct ports ($(ata_port_for academy) vs $(ata_port_for crm))" \
  || no "6b academy and crm have distinct ports"
[ "$(ata_unit_for academy)" != "$(ata_unit_for crm)" ] \
  && ok "6c academy and crm have distinct units" \
  || no "6c academy and crm have distinct units"

# 7 — reference classification: a prune record is history, a cutover receipt is live.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SHA=1111111111111111111111111111111111111111
mkdir -p "$TMP/rel/$SHA"
printf '{"path":"%s"}\n' "$SHA" > "$TMP/ATA_PRUNE_RECORD.jsonl"
_ata_refs_to() { printf '%s\n' "$TMP/ATA_PRUNE_RECORD.jsonl"; }
if ata_release_is_referenced "$TMP/rel/$SHA" "$SHA" >/dev/null 2>&1; then
  no "7  prune record is not a live reference" "the record naming the release it removed blocked its own prune"
else ok "7  a prune record is NOT counted as a live reference"; fi

printf '{"activated":"%s"}\n' "$SHA" > "$TMP/cutover-receipt.json"
_ata_refs_to() { printf '%s\n' "$TMP/cutover-receipt.json"; }
if ata_release_is_referenced "$TMP/rel/$SHA" "$SHA" >/dev/null 2>&1; then
  ok "7b a cutover receipt IS counted as a live reference"
else no "7b a cutover receipt IS counted as a live reference" "a receipt naming this release must block the prune"; fi

# 7c — a newer manifest naming it as parent is provenance, not a live pointer.
printf '{"source_commit": "2222", "parent_accepted_commit": "%s"}\n' "$SHA" > "$TMP/ATA_RELEASE_MANIFEST.json"
_ata_refs_to() { printf '%s\n' "$TMP/ATA_RELEASE_MANIFEST.json"; }
if ata_release_is_referenced "$TMP/rel/$SHA" "$SHA" >/dev/null 2>&1; then
  no "7c parent_accepted_commit is not a live reference" "provenance history must not block a prune"
else ok "7c parent_accepted_commit is NOT a live reference"; fi

# 7d — but a manifest whose OWN source_commit is this sha is the release itself.
printf '{"source_commit": "%s"}\n' "$SHA" > "$TMP/ATA_RELEASE_MANIFEST.json"
_ata_refs_to() { printf '%s\n' "$TMP/ATA_RELEASE_MANIFEST.json"; }
if ata_release_is_referenced "$TMP/rel/$SHA" "$SHA" >/dev/null 2>&1; then
  ok "7d a manifest whose source_commit IS this sha counts as live"
else no "7d a manifest whose source_commit IS this sha counts as live"; fi

# 8 — the authority must actually be WIRED IN. A library nothing calls fixes
#     nothing, and the original defect was precisely a check that did not run.
CUT="$HERE/../cutover.sh"; PRUNE="$HERE/../prune-release.sh"

grep -q 'service-identity.sh' "$CUT" \
  && ok "8  cutover.sh sources the authority" \
  || no "8  cutover.sh sources the authority" "a library nothing calls fixes nothing"

grep -q 'ata_verify_service "$REPO" "$DEST"' "$CUT" \
  && ok "8b cutover.sh asserts identity against the directory it swapped to" \
  || no "8b cutover.sh asserts identity against the directory it swapped to"

grep -q 'service identity check failed' "$CUT" \
  && ok "8c cutover.sh REFUSES on mismatch rather than printing it" \
  || no "8c cutover.sh REFUSES on mismatch rather than printing it"

[ -f "$PRUNE" ] \
  && ok "9  the prune gate exists as a tool, not as typed shell" \
  || no "9  the prune gate exists as a tool, not as typed shell"

grep -q 'service-identity.sh' "$PRUNE" \
  && ok "9b prune gate sources the authority" \
  || no "9b prune gate sources the authority"

grep -q 'ata_verify_service' "$PRUNE" \
  && ok "9c prune gate verifies every component before allowing a prune" \
  || no "9c prune gate verifies every component before allowing a prune"

if grep -qE '(^|[^a-zA-Z])rm[[:space:]]' "$PRUNE"; then
  no "9d the prune gate contains no deletion at all" "verification and removal must stay separate"
else
  ok "9d the prune gate contains no deletion at all"
fi

# 10 — no tool may spell a unit name itself; that is what went wrong.
BAD=0
for f in "$HERE/../"*.sh; do
  case "$(basename "$f")" in service-identity.sh) continue ;; esac
  if grep -qE 'ata-preprod-[a-z]+|ata-[a-z]+\.service' "$f"; then
    BAD=1; printf '       spells a unit: %s\n' "$f"
  fi
done
[ "$BAD" -eq 0 ] \
  && ok "10 no other tool hardcodes a unit name" \
  || no "10 no other tool hardcodes a unit name" "the registry must be the only place a unit is written"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
