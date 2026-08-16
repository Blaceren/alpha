#!/usr/bin/env bash
# ATA-PREPROD-RELEASE-TOOLING-SOURCE-OWNERSHIP-1 — the install contract regression.
#
# WHAT THIS PINS. The installer is now the only sanctioned way to change the
# active release tooling, which makes it release authority in its own right. So
# it is held to the same standard as the publisher it installs: an enumerated
# file set, fail-closed refusals, no wildcard writes, and no way to reach a path
# outside the destination scope.
#
# Every assertion runs the REAL installer against disposable directories. None of
# them touches the live tooling path.
set -uo pipefail
INSTALLER="${1:-/home/ubuntu/ata-release-tooling/install-release-tooling.sh}"
SRC_ROOT="$(cd "$(dirname "$(readlink -f "$INSTALLER")")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok(){ printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  FAIL %s\n' "$1"; printf '       %s\n' "${2:-}"; fail=$((fail+1)); }

# A disposable clone of the source repo, so negative cases can mutate it freely.
clone() {
  local dst="$1"
  git clone -q "$SRC_ROOT" "$dst" 2>/dev/null || return 1
  git -C "$dst" config user.email t@t; git -C "$dst" config user.name t
  cp "$SRC_ROOT/install-release-tooling.sh" "$dst/install-release-tooling.sh" 2>/dev/null || true
  chmod +x "$dst/install-release-tooling.sh"
}

run() { # run <clone> <dest> <args...> -> prints output, sets RC
  local c="$1" d="$2"; shift 2
  OUT="$("$c/install-release-tooling.sh" --dest "$d" "$@" 2>&1)"; RC=$?
}

REPO="$WORK/repo"
clone "$REPO" || { echo "cannot clone source repo"; exit 1; }
DEST="$WORK/dest"; mkdir -p "$DEST"

# ---------------------------------------------------------------------------
# POSITIVE — a clean source installs, and --check then agrees
# ---------------------------------------------------------------------------
run "$REPO" "$DEST" --install
[ "$RC" -eq 0 ] && ok "a clean source revision installs" || no "a clean source revision installs" "$OUT"

run "$REPO" "$DEST" --check
[ "$RC" -eq 0 ] && ok "--check agrees immediately after --install" || no "--check agrees after --install" "$OUT"

# The installed manifest must name the source revision and hash every file.
MAN="$DEST/ATA_TOOLING_INSTALLED.json"
[ -f "$MAN" ] && ok "an installed manifest is written" || no "an installed manifest is written"
node -e "JSON.parse(require('fs').readFileSync('$MAN','utf8'))" >/dev/null 2>&1 \
  && ok "the installed manifest is valid JSON" || no "the installed manifest is valid JSON"
MAN_COMMIT="$(node -pe "JSON.parse(require('fs').readFileSync('$MAN','utf8')).source_commit" 2>/dev/null)"
[ "$MAN_COMMIT" = "$(git -C "$REPO" rev-parse HEAD)" ] \
  && ok "the manifest names the exact source commit installed" || no "the manifest names the exact source commit"
FILE_COUNT="$(node -pe "Object.keys(JSON.parse(require('fs').readFileSync('$MAN','utf8')).files).length" 2>/dev/null)"
[ "$FILE_COUNT" -ge 6 ] && ok "the manifest hashes every installed file ($FILE_COUNT)" || no "the manifest hashes every installed file" "got $FILE_COUNT"

# Executable modes must survive the install, or the operator cannot run them.
MODE_OK=1
for f in tools/publish-release.sh tools/build-release.sh tools/verify-build-provenance.sh tools/cutover.sh; do
  [ -x "$DEST/$f" ] || MODE_OK=0
done
[ "$MODE_OK" = "1" ] && ok "executable modes are preserved" || no "executable modes are preserved"

# The manifest must carry no secret material.
grep -qiE '(password|secret|token|api[_-]?key|DATABASE_URL=)' "$MAN" \
  && no "the installed manifest carries no secret" "it does" \
  || ok "the installed manifest carries no secret"

# ---------------------------------------------------------------------------
# NEGATIVE — every one of these must refuse
# ---------------------------------------------------------------------------

# 1. SOURCE FILE MISSING — a partial tooling set is worse than none.
R1="$WORK/r1"; clone "$R1"
git -C "$R1" rm -q tools/verify-build-provenance.sh
git -C "$R1" commit -qm "drop the verifier"
D1="$WORK/d1"; mkdir -p "$D1"
run "$R1" "$D1" --install
[ "$RC" -ne 0 ] && case "$OUT" in *"source file missing"*) ok "missing source file is REFUSED" ;; *) no "missing source file refusal names the cause" "$OUT" ;; esac \
  || no "missing source file is refused" "$OUT"
[ ! -e "$D1/tools/publish-release.sh" ] && ok "...and nothing was installed before the refusal" \
  || no "nothing installed before the refusal"

# 2. DIRTY SOURCE — the recorded commit would be a lie.
R2="$WORK/r2"; clone "$R2"
printf '\n# uncommitted edit\n' >> "$R2/tools/cutover.sh"
D2="$WORK/d2"; mkdir -p "$D2"
run "$R2" "$D2" --install
[ "$RC" -ne 0 ] && case "$OUT" in *"uncommitted tracked changes"*) ok "a dirty source working tree is REFUSED" ;; *) no "dirty source refusal names the cause" "$OUT" ;; esac \
  || no "a dirty source working tree is refused" "$OUT"

# 3. SOURCE NOT A GIT REPOSITORY — no revision to record.
R3="$WORK/r3"; clone "$R3"; rm -rf "$R3/.git"
D3="$WORK/d3"; mkdir -p "$D3"
run "$R3" "$D3" --install
[ "$RC" -ne 0 ] && case "$OUT" in *"not a git repository"*) ok "a non-versioned source is REFUSED" ;; *) no "non-versioned source refusal names the cause" "$OUT" ;; esac \
  || no "a non-versioned source is refused" "$OUT"

# 4. NON-EXECUTABLE SOURCE FILE — would install something unrunnable.
R4="$WORK/r4"; clone "$R4"
chmod -x "$R4/tools/cutover.sh"
git -C "$R4" update-index --chmod=-x tools/cutover.sh 2>/dev/null
git -C "$R4" commit -qm "drop the exec bit" 2>/dev/null
D4="$WORK/d4"; mkdir -p "$D4"
run "$R4" "$D4" --install
[ "$RC" -ne 0 ] && case "$OUT" in *"not executable"*) ok "a non-executable source tool is REFUSED" ;; *) no "non-executable refusal names the cause" "$OUT" ;; esac \
  || no "a non-executable source tool is refused" "$OUT"

# 5. DESTINATION DOES NOT EXIST — a release-tooling path is not created implicitly.
R5="$WORK/r5"; clone "$R5"
run "$R5" "$WORK/does-not-exist" --install
[ "$RC" -ne 0 ] && case "$OUT" in *"does not exist"*) ok "a missing destination is REFUSED, not created" ;; *) no "missing destination refusal names the cause" "$OUT" ;; esac \
  || no "a missing destination is refused" "$OUT"

# 6. RELATIVE DESTINATION — scope must be unambiguous.
R6="$WORK/r6"; clone "$R6"
run "$R6" "relative/path" --install
[ "$RC" -ne 0 ] && case "$OUT" in *"absolute path"*) ok "a relative destination is REFUSED" ;; *) no "relative destination refusal names the cause" "$OUT" ;; esac \
  || no "a relative destination is refused" "$OUT"

# 7. UNKNOWN MODE / UNKNOWN TOOL NAME — the interface is closed.
R7="$WORK/r7"; clone "$R7"
D7="$WORK/d7"; mkdir -p "$D7"
run "$R7" "$D7" --deploy-everything
[ "$RC" -ne 0 ] && ok "an unknown mode is REFUSED" || no "an unknown mode is refused" "$OUT"
OUT="$("$R7/install-release-tooling.sh" 2>&1)"; RC=$?
[ "$RC" -ne 0 ] && ok "no mode at all is REFUSED (no implicit install)" || no "no mode is refused" "$OUT"

# 8. DRIFTED ACTIVE TOOLING — --check must notice a hand-edit and must not fix it.
R8="$WORK/r8"; clone "$R8"
D8="$WORK/d8"; mkdir -p "$D8"
run "$R8" "$D8" --install
printf '\n# hand edit in the live path\n' >> "$D8/tools/publish-release.sh"
BEFORE="$(sha256sum "$D8/tools/publish-release.sh" | cut -d' ' -f1)"
run "$R8" "$D8" --check
[ "$RC" -ne 0 ] && case "$OUT" in *DIFFERS*) ok "a hand-edited active file is reported as DIFFERS and REFUSED" ;; *) no "drift refusal names the file" "$OUT" ;; esac \
  || no "a hand-edited active file is refused" "$OUT"
[ "$(sha256sum "$D8/tools/publish-release.sh" | cut -d' ' -f1)" = "$BEFORE" ] \
  && ok "--check changed nothing" || no "--check changed nothing"

# 9. UNRELATED FILES IN THE DESTINATION MUST SURVIVE — no broad replacement.
R9="$WORK/r9"; clone "$R9"
D9="$WORK/d9"; mkdir -p "$D9/tools/tests"
echo "operator note" > "$D9/UNRELATED.txt"
echo "another tool"  > "$D9/tools/some-other-tool.sh"
run "$R9" "$D9" --install
[ "$RC" -eq 0 ] && ok "install succeeds alongside unrelated files" || no "install succeeds alongside unrelated files" "$OUT"
[ -f "$D9/UNRELATED.txt" ] && [ -f "$D9/tools/some-other-tool.sh" ] \
  && ok "unrelated files in the destination are untouched" || no "unrelated files are untouched"
[ "$(cat "$D9/UNRELATED.txt")" = "operator note" ] && ok "unrelated file contents are unchanged" || no "unrelated file contents unchanged"

# 10. NO BROAD DESTRUCTION PRIMITIVES ANYWHERE IN THE INSTALLER.
# Checked on CODE, not on prose: the installer's own comments legitimately say
# what it never does ("no rsync", "no `rm -rf`"), and a guard that cannot tell a
# description from an instruction is a guard that fails on honest documentation.
INSTALLER_CODE="$(sed 's/#.*$//' "$INSTALLER")"
printf '%s' "$INSTALLER_CODE" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r' \
  && no "the installer contains no recursive remove" "it does" \
  || ok "the installer contains no recursive remove"
printf '%s' "$INSTALLER_CODE" | grep -qE 'rsync|cp[[:space:]]+-[a-zA-Z]*r' \
  && no "the installer performs no recursive copy" "it does" \
  || ok "the installer performs no recursive copy"
# ...and the only removals it performs are of its own temporary files.
BAD_RM="$(printf '%s' "$INSTALLER_CODE" | grep -oE 'rm[[:space:]]+[^;&|]*' | grep -v 'tmp' || true)"
[ -z "$BAD_RM" ] && ok "every remove in the installer targets its own temp file" \
  || no "every remove targets its own temp file" "$BAD_RM"

# 11. THE FILE SET IS ENUMERATED, and matches what the repository actually ships.
LISTED="$(sed -n '/^TOOLING_FILES=(/,/^)/p' "$INSTALLER" | grep -oE '"[^"]+"' | tr -d '"' | sort)"
SHIPPED="$(cd "$SRC_ROOT" && find tools -type f -name '*.sh' | sort)"
[ "$LISTED" = "$SHIPPED" ] \
  && ok "the enumerated file set matches every shipped tool ($(printf '%s\n' "$LISTED" | wc -l) files)" \
  || no "the enumerated file set matches every shipped tool" "listed=[$LISTED] shipped=[$SHIPPED]"

# 12. PATH-ESCAPE REFUSAL is structural, not incidental.
grep -q '\*\.\.\*' "$INSTALLER" && ok "the installer refuses relative paths containing .." \
  || no "the installer refuses relative paths containing .."

# 13. THE SOURCE→DESTINATION MAPPING. The first installer reused one relative
# path under both roots, which silently produced <active>/tools/publish-release.sh
# — a parallel tree beside the real tooling, with the active tooling left
# untouched. Nothing was damaged (it only writes files it names) but nothing was
# updated either, and --check happily reported the parallel copy as correct.
D13="$WORK/d13"; mkdir -p "$D13"
R13="$WORK/r13"; clone "$R13"
run "$R13" "$D13" --install
[ -f "$D13/publish-release.sh" ] && ok "tools install at the TOP of the destination" \
  || no "tools install at the top of the destination" "$OUT"
[ -f "$D13/tests/build-provenance.test.sh" ] && ok "test suites install under destination/tests" \
  || no "test suites install under destination/tests"
[ ! -e "$D13/tools" ] && ok "no parallel tools/ tree is created inside the destination" \
  || no "no parallel tools/ tree is created" "found $D13/tools"
# The publisher finds its verifier as a SIBLING, so the flat layout is load-bearing.
[ -f "$D13/verify-build-provenance.sh" ] && [ -f "$D13/publish-release.sh" ] \
  && ok "publisher and verifier land as siblings, as the publisher resolves them" \
  || no "publisher and verifier land as siblings"

printf '\ninstall contract regression: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
