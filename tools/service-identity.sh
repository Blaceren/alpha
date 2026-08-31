#!/usr/bin/env bash
# RELEASE-TOOLING-UNIT-VALIDATION-1 — one authority for "is this component
# actually running, out of the release we think it is".
#
# WHY THIS FILE EXISTS.
#
# `systemctl show ata-academy -p MainPID --value` does not fail for a unit that
# does not exist. It prints `0` and exits 0. Every field comes back empty and
# every string comparison against them quietly succeeds, so a gate written
# against the wrong unit name reports green while checking nothing at all. A
# prune gate shipped with exactly that defect: its "the service is not running
# out of the directory I am about to delete" check silently skipped on every
# run, because the units are named `ata-preprod-<component>`, not `ata-<component>`.
#
# Nothing was lost that time. The check that would have caught a real mistake
# had simply never executed.
#
# So the unit name is no longer spelled at the call site. It is looked up here,
# an unknown component is a refusal rather than a default, and every property
# that can come back empty is asserted to be non-empty BEFORE it is compared.
#
# THE PORT CHECK IS AGAINST THE CGROUP, NOT MainPID.
#
# Three of the four components are started through `npm run start`, so MainPID
# is the npm wrapper and the listening socket belongs to a grandchild. Asserting
# that MainPID owns the port would fail on academy, backend and crm and pass
# only on partner. The unit's cgroup is the thing that actually delimits "this
# service", so that is what the port is checked against.
#
# TESTABILITY. Every reading of the outside world goes through one of the
# `_ata_*` hooks below. The negative tests replace them to simulate a missing
# unit, a dead MainPID, a foreign cwd and a stolen port, so the refusals are
# proved by execution rather than by reading the source.

# --- the registry: the only place a unit name or port is written -------------
ata_unit_for() {
  case "$1" in
    academy) printf 'ata-preprod-academy.service' ;;
    backend) printf 'ata-preprod-backend.service' ;;
    crm)     printf 'ata-preprod-crm.service' ;;
    partner) printf 'ata-preprod-partner.service' ;;
    *) return 1 ;;
  esac
}

ata_port_for() {
  case "$1" in
    academy) printf '3050' ;;
    backend) printf '3100' ;;
    crm)     printf '3010' ;;
    partner) printf '3110' ;;
    *) return 1 ;;
  esac
}

ata_components() { printf 'academy backend crm partner'; }

# --- hooks (overridden by the tests) ----------------------------------------
_ata_systemctl_show() { systemctl show "$1" -p "$2" --value 2>/dev/null; }
_ata_proc_exists()    { [ -d "/proc/$1" ]; }
_ata_proc_cwd()       { readlink -f "/proc/$1/cwd" 2>/dev/null; }
_ata_symlink()        { readlink -f "/srv/ata/current/$1" 2>/dev/null; }
_ata_cgroup_pids()    {
  local cg; cg="$(_ata_systemctl_show "$1" ControlGroup)"
  [ -n "$cg" ] || return 0
  cat "/sys/fs/cgroup${cg}/cgroup.procs" 2>/dev/null
}
_ata_port_pids()      { ss -ltnp 2>/dev/null | grep -oE "127\.0\.0\.1:$1 .*" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u; }

# --- the gate ----------------------------------------------------------------
# ata_verify_service <component> [expected_release_dir]
# Prints one line per check. Returns non-zero on the FIRST failure: every one of
# these is a refusal, never a warning.
_ata_refuse() { printf '  REFUSING [%s]: %s\n' "$1" "$2" >&2; }

ata_verify_service() {
  local c="$1" expect="${2:-}"
  local unit port state pid cwd link

  unit="$(ata_unit_for "$c")" || { _ata_refuse "$c" "unknown component '$c' — not in the registry"; return 1; }
  port="$(ata_port_for "$c")" || { _ata_refuse "$c" "no port registered for '$c'"; return 1; }
  printf '  %-8s unit=%s port=%s\n' "$c" "$unit" "$port"

  state="$(_ata_systemctl_show "$unit" LoadState)"
  [ "$state" = "loaded" ] || { _ata_refuse "$c" "LoadState='$state', expected loaded (an unknown unit reports empty, not an error)"; return 1; }

  state="$(_ata_systemctl_show "$unit" ActiveState)"
  [ "$state" = "active" ] || { _ata_refuse "$c" "ActiveState='$state', expected active"; return 1; }

  state="$(_ata_systemctl_show "$unit" SubState)"
  [ "$state" = "running" ] || { _ata_refuse "$c" "SubState='$state', expected running"; return 1; }

  pid="$(_ata_systemctl_show "$unit" MainPID)"
  case "$pid" in
    ''|0|*[!0-9]*) _ata_refuse "$c" "MainPID='$pid' — 0 or empty means the unit is not running, or the name is wrong"; return 1 ;;
  esac

  _ata_proc_exists "$pid" || { _ata_refuse "$c" "/proc/$pid does not exist — MainPID names a process that is gone"; return 1; }

  cwd="$(_ata_proc_cwd "$pid")"
  [ -n "$cwd" ] || { _ata_refuse "$c" "/proc/$pid/cwd is unreadable"; return 1; }

  link="$(_ata_symlink "$c")"
  [ -n "$link" ] || { _ata_refuse "$c" "/srv/ata/current/$c does not resolve"; return 1; }

  [ "$cwd" = "$link" ] || { _ata_refuse "$c" "process cwd '$cwd' != live symlink '$link' — the service is serving a different release than the symlink claims"; return 1; }

  if [ -n "$expect" ] && [ "$cwd" != "$expect" ]; then
    _ata_refuse "$c" "process cwd '$cwd' != expected '$expect'"; return 1
  fi

  # The port must belong to THIS unit's cgroup. MainPID is usually the npm
  # wrapper, so the listener is a descendant, not MainPID itself.
  local owners cg_pids matched=""
  owners="$(_ata_port_pids "$port")"
  [ -n "$owners" ] || { _ata_refuse "$c" "nothing is listening on 127.0.0.1:$port"; return 1; }
  cg_pids=" $(_ata_cgroup_pids "$unit" | tr '\n' ' ') "
  local o
  for o in $owners; do
    case "$cg_pids" in *" $o "*) matched="$o" ;; esac
  done
  [ -n "$matched" ] || { _ata_refuse "$c" "port $port is held by pid(s) [$(echo $owners)] which are NOT in $unit's cgroup [$(echo $cg_pids)]"; return 1; }

  printf '    LoadState/ActiveState/SubState ok, MainPID=%s, cwd==symlink, port %s owned by pid %s in-cgroup\n' "$pid" "$port" "$matched"
  printf '    release: %s\n' "$cwd"
  return 0
}

# ata_wait_for_service <component> [expected_release_dir] [seconds]
# Verify, but allow for a service that has just been restarted.
#
# WHY THIS EXISTS. `systemctl restart` returns, and the unit reports
# active/running, BEFORE Next has bound its port — so a verification run
# immediately afterwards refuses on "nothing is listening", which is true at that
# instant and says nothing about the cutover. The first Academy cutover under the
# new gate hit exactly that: the symlink was swapped, the service came up
# healthy, and the gate reported failure because it asked too early.
#
# It waits for the LISTENER, not for a fixed sleep, and it still refuses on
# everything else immediately — a wrong cwd or a stolen port is not a race and
# is not worth waiting out.
ata_wait_for_service() {
  local c="$1" expect="${2:-}" budget="${3:-60}"
  local port unit i
  port="$(ata_port_for "$c")" || { _ata_refuse "$c" "unknown component"; return 1; }
  unit="$(ata_unit_for "$c")" || return 1

  for (( i = 0; i < budget; i++ )); do
    if [ -n "$(_ata_port_pids "$port")" ]; then break; fi
    sleep 1
  done

  ata_verify_service "$c" "$expect"
}

# ata_release_is_referenced <release_dir> <sha>
# Decides whether a release is still pointed at by something live. A prune
# record NAMES the release it removed — that is its purpose, and it is history.
# A cutover receipt names a release that was made active, which is a live
# reference and blocks a prune.
ata_release_is_referenced() {
  local dir="$1" sha="$2" hits=0 ref
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    case "$(basename "$ref")" in
      ATA_PRUNE_RECORD.jsonl|*-prune-*.json)
        printf '    [prune record, not a live reference] %s\n' "$ref" ;;
      ATA_RELEASE_MANIFEST.json)
        if grep -qE "\"parent_accepted_commit\": *\"$sha\"" "$ref" 2>/dev/null \
           && ! grep -qE "\"source_commit\": *\"$sha\"" "$ref" 2>/dev/null; then
          printf '    [provenance parent, not a live reference] %s\n' "$ref"
        else
          printf '    [LIVE] %s\n' "$ref"; hits=$((hits+1))
        fi ;;
      *cutover*|*CUTOVER*)
        printf '    [LIVE cutover receipt] %s\n' "$ref"; hits=$((hits+1)) ;;
      *)
        printf '    [LIVE] %s\n' "$ref"; hits=$((hits+1)) ;;
    esac
  done < <(_ata_refs_to "$dir" "$sha")
  [ "$hits" -eq 0 ] && return 1 || return 0
}

_ata_refs_to() {
  local dir="$1" sha="$2" d
  for d in /srv/ata/releases /srv/ata/config /home/ubuntu/ata-release-tooling /var/log/ata; do
    [ -d "$d" ] || continue
    grep -rl "$sha" "$d" 2>/dev/null | grep -viE "^$dir(/|$)"
  done
}
