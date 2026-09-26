#!/usr/bin/env bash
# H-6 — one Node version, written down, and enforced before a build starts.
#
# WHY THIS EXISTS. Nothing in the three repositories said which Node they run
# on. The box happens to have exactly one install and every unit execs it, so
# the pin was true and unwritten — which is the state a machine cannot check and
# a new machine cannot reproduce. `.nvmrc` tells a developer and a CI runner
# which version to fetch; `engines.node` makes npm refuse the wrong one; this
# file makes them agree with each other and with the runtime that is actually
# building.
#
# IT INSTALLS NOTHING. Every check reads a manifest or asks the running Node
# what version it is.
set -u
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n' "$1"; printf '       %s\n' "${2:-}"; fail=$((fail+1)); }

REPOS="academy backend crm partner"
# partner lives in the affiliate workspace, and always has.
repo_dir() { case "$1" in partner) echo /home/ubuntu/affiliate-work/partner ;; *) echo /home/ubuntu/learner-ops-v1/$1 ;; esac; }
ROOT=/home/ubuntu/learner-ops-v1

# --- A. every repo declares both, and they agree ----------------------------
declare -A NVMRC ENGINES
for r in $REPOS; do
  d="$(repo_dir "$r")"
  NVMRC[$r]="$(tr -d ' \n' < "$d/.nvmrc" 2>/dev/null || echo MISSING)"
  ENGINES[$r]="$(node -p "JSON.parse(require('fs').readFileSync('$d/package.json','utf8')).engines?.node ?? 'MISSING'" 2>/dev/null)"
  [ "${NVMRC[$r]}" != "MISSING" ] && ok "A $r has .nvmrc (${NVMRC[$r]})" || no "A $r has .nvmrc"
  [ "${ENGINES[$r]}" != "MISSING" ] && ok "A $r declares engines.node (${ENGINES[$r]})" || no "A $r declares engines.node"
done

# The .nvmrc version must SATISFY the engines range — not merely look similar.
for r in $REPOS; do
  if node -e "
    const v='${NVMRC[$r]}'.split('.').map(Number);
    const range='${ENGINES[$r]}';
    const m=range.match(/^(\d+)\.(\d+)\.x$/);
    if(!m) process.exit(2);
    process.exit(v[0]===Number(m[1]) && v[1]===Number(m[2]) ? 0 : 1);
  " 2>/dev/null; then
    ok "B $r .nvmrc ${NVMRC[$r]} satisfies engines ${ENGINES[$r]}"
  else
    no "B $r .nvmrc ${NVMRC[$r]} satisfies engines ${ENGINES[$r]}" "the pinned version must fall inside the declared range"
  fi
done

# --- C. all three repositories agree on one major.minor ---------------------
UNIQ_NVMRC="$(for r in $REPOS; do echo "${NVMRC[$r]}"; done | sort -u | wc -l)"
UNIQ_ENG="$(for r in $REPOS; do echo "${ENGINES[$r]}"; done | sort -u | wc -l)"
[ "$UNIQ_NVMRC" -eq 1 ] && ok "C all three .nvmrc agree" || no "C all three .nvmrc agree" "found $UNIQ_NVMRC distinct values"
[ "$UNIQ_ENG" -eq 1 ] && ok "C all three engines ranges agree" || no "C all three engines ranges agree" "found $UNIQ_ENG distinct values"

# --- D. the Node that is RUNNING satisfies the pin --------------------------
RUNNING="$(node -v | sed 's/^v//')"
REF="${NVMRC[academy]}"
if [ "$(echo "$RUNNING" | cut -d. -f1,2)" = "$(echo "$REF" | cut -d. -f1,2)" ]; then
  ok "D the running Node ($RUNNING) satisfies the pin ($REF)"
else
  no "D the running Node ($RUNNING) satisfies the pin ($REF)" \
     "a build started on this runtime would not be the pinned one"
fi

# --- E. the lockfiles carry the same root engines ---------------------------
for r in $REPOS; do
  LOCK="$(node -p "JSON.parse(require('fs').readFileSync('$(repo_dir "$r")/package-lock.json','utf8')).packages['']?.engines?.node ?? 'MISSING'" 2>/dev/null)"
  [ "$LOCK" = "${ENGINES[$r]}" ] && ok "E $r lockfile root engines match package.json" \
    || no "E $r lockfile root engines match package.json" "lock says '$LOCK', package.json says '${ENGINES[$r]}'"
done

# --- F. the refusal is real: npm must reject a wrong runtime ----------------
# `engines-strict` is what turns the declaration into a refusal. Assert the
# mechanism exists rather than trusting that npm happens to enforce it.
for r in $REPOS; do
  NPMRC="$(repo_dir "$r")/.npmrc"
  if [ -f "$NPMRC" ] && grep -qE '^engine-strict *= *true' "$NPMRC"; then
    ok "F $r sets engine-strict=true, so a wrong Node fails before install"
  else
    no "F $r sets engine-strict=true" "without it npm only warns, and the pin is advisory"
  fi
done

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
