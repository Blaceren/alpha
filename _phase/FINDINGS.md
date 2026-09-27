# ATA-PREPROD-LEARNER-OPERATIONS-CRM-END-TO-END-1 — Findings Register

## SOURCE-MIRROR-DRIFT-1
**Class:** OBSERVATION (infrastructure / source-provenance). Non-blocking.
**Scope:** NOT Learner Operations product scope. Does NOT reopen Affiliate Platform V1.

**Observed:** the bare mirrors under `/srv/ata/repos/` do not contain the currently
accepted deployed commits:

| Mirror | Mirror HEAD | Deployed commit | Contains it? |
|---|---|---|---|
| /srv/ata/repos/backend | 38d107b | 18050be | NO |
| /srv/ata/repos/crm     | 8328903 | 4819518 | NO |
| /srv/ata/repos/academy | 4c4ced3 | 7501411 | NO |

**Consequence:** `/srv/ata/repos/*` is NOT authoritative for this phase. Authoritative
sources for the accepted baseline are:
- backend  -> /home/ubuntu/affiliate-work/backend      (HEAD 18050be)
- crm      -> /home/ubuntu/affiliate-work/crm          (HEAD 4819518)
- academy  -> /home/ubuntu/pocket-reg-work/academy     (HEAD 7501411)
- partner  -> /home/ubuntu/affiliate-work/partner      (HEAD 68ade76)

**Action:** none in this phase. Do not synchronize the mirrors unless this phase proves
they are part of the actual release contract. Release publication on this host operates
from the working trees + /srv/ata/releases, not from these mirrors.

## DISK-HEADROOM-1
**Class:** BLOCKER (infrastructure) — **RESOLVED** under explicit user authorization.

**Observed:** `/` at 99% (1619 MiB free). The release publisher's §A preflight requires
`candidate + 2 GiB`, so every one of the three publishes was refused (backend needed 2676
MiB, crm 3017, academy 2979). That preflight exists because an earlier phase lost two
builds to a truncated copy.

**Inventory (read-only, before any deletion):** `/srv/ata/releases/backend` held **27
entries, all real directories, 0 symlinks**. Two protected: current
`18050bee…` and previous/rollback `4208e719…`. One additional artifact excluded from
candidacy: `rollback-d12ab14c-verified-20260812`, a named verified rollback point.

**Reference proof:** no candidate was named by `/srv/ata/current/*`, `/srv/ata/previous/*`,
any systemd unit, or any nginx config (units reference only the `current` symlinks). `lsof`
over the whole release root showed open handles under exactly one directory — the running
current release. The live backend process cwd resolves to `18050bee…`, matching accepted
deployment state.

**Reclaimed — 9 oldest candidates, 10,974 MiB**, each with a fail-closed guard immediately
before it (re-read current + previous, assert path is neither, assert directory exists,
assert containment under `/srv/ata/releases/backend/`, assert not a rollback artifact,
assert no open handles) and a full literal path:

```
/srv/ata/releases/backend/734e632ea450cdd8a3662afe2eb1dcd7b0935607   1392 MiB
/srv/ata/releases/backend/b437629c1493231d7f3e22c7126237814f6d6816   1397 MiB
/srv/ata/releases/backend/629dc5653d46810071ae420e2c295754b9140357   1398 MiB
/srv/ata/releases/backend/008fa9dbb81a2b40071df792553dc030e805004e   1399 MiB
/srv/ata/releases/backend/6d35e697a1024c1c6be9c3dd1cbb7a628af6ac23   1443 MiB
/srv/ata/releases/backend/25b9387caa5a7edd078cd013bba78d98b73a74e7   1444 MiB
/srv/ata/releases/backend/a88bc9f3f5ce7b8b21b94932d536f7d916eee682   1384 MiB
/srv/ata/releases/backend/4aace03d797d16281a7885f056429f2d5a1cfdf3    552 MiB
/srv/ata/releases/backend/5fc23fa06b66e266b33172a2fbd65086a4e0a270    565 MiB
```

`d12ab14c0d52…` (1447 MiB) was the 2nd-oldest and provably unreferenced, but was
**deliberately skipped**: the sibling `rollback-d12ab14c-verified-20260812` exists as its
verified rollback point, so nothing associated with a named rollback was touched. Taking
the next candidates instead cost one extra deletion.

**Result:** 12.29 GiB free (13,198,209,024 bytes). Deletion stopped the moment the 12 GiB
target was met — 15 candidates totalling ~13.7 GiB were left in place. Backend releases
27 → 18. crm, academy, partner, `/home/ubuntu/audits`, `learner-ops-work`,
`learner-ops-v1` and `ata-g2-editorial` all untouched. All four services active; backend
cwd still `18050bee…`.

## ACADEMY-ROLLBACK-ANCHOR-1
**Class:** HIGH (infrastructure). Must be closed before the Academy candidate is activated.

**Observed:** `/srv/ata/previous/` contains anchors for `backend` and `crm` only. There is
**no `/srv/ata/previous/academy`**. Academy has been deployed through at least four
releases with no rollback anchor at any point, so an activation failure had no recorded
predecessor to return to.

**Required before Academy activation:** establish an anchor to the currently accepted
release `7501411ebb5b5f76bb237adf883764f8318e0bd2` through the canonical deployment owner,
not by improvising a symlink by hand.

## DISK-HEADROOM-1a — a gap in my own reference scan
**Class:** MEDIUM (infrastructure). Self-caught, immediately after reclamation. Not
user-reported.

**What I missed.** My pre-deletion reference scan covered exactly the five sources named in
the authorization — `/srv/ata/current/*`, `/srv/ata/previous/*`, systemd, nginx, and open
file handles — and every candidate was clean against all five. It did **not** cover
`/srv/ata-data/access-control/`, where the canonical `cutover.sh` writes its rollback
receipts. One deleted path was named there.

**Exactly one artifact is affected:**

```
/srv/ata-data/access-control/.cutover-rollback-backend
  written 2026-08-12, contains
  /srv/ata/releases/backend/a88bc9f3f5ce7b8b21b94932d536f7d916eee682   -> now MISSING
```

crm and academy receipts are equally stale (both 2026-08-12) but their targets happen to
still exist and were not candidates.

**Impact assessment — no live rollback capability was lost.**

That receipt was already unusable as a rollback target before anything was deleted. It
records the rollback point of a cutover performed on 2026-08-12; backend has been cut over
again on 08-13, 08-14 and 08-15 since, and the database has advanced through migrations
48, 49 and 50. Rolling today's backend back to an 08-12 build against a migration-50
database would have been an incorrect rollback whether or not the directory existed.

The LIVE backend rollback anchor is `/srv/ata/previous/backend` →
`4208e719c9ed77e72f3f387cebdcaa882c6dc772`, which is **present** and is the correct
one-release-back target. It was protected throughout.

**Resolution — through the canonical owner, not by hand.** `cutover.sh` rewrites
`.cutover-rollback-<repo>` with the correct rollback point every time it runs. Activating
the Learner Operations backend candidate in this phase therefore repairs the receipt as a
side effect, correctly and through the mechanism that owns it. The receipt is deliberately
NOT edited by hand.

**Standing correction to the reclamation procedure:** a release-reference scan must include
`/srv/ata-data/access-control/` alongside the five sources above.

## LO-FIXTURE-PROVISIONER-1 — built, proven, awaiting its human step
**Class:** OBSERVATION (tooling). Complete.

`scripts/ops/learnerOpsAcceptanceFixture.ts` + `scripts/ops/learner-ops-fixture/`.

**Nine principals, closed allowlist in source.** Three staff and six learners. No
`--email`, no `--role`, no `--permission`; the CLI names a KEY from a reviewed table.
Membership is by exact string, not domain suffix.

| key | email | StaffRole | User.role | exists to prove |
|---|---|---|---|---|
| operator | lo-operator@learner-ops.invalid | support | user | a frontline operator CANNOT approve educational work |
| reviewer | lo-reviewer@learner-ops.invalid | mentor | mentor | both LO-AUTH-AXIS-1 axes satisfied — the positive control |
| admin | lo-admin@learner-ops.invalid | crm_admin | user | the CRM review permission ALONE is not sufficient |

Six learners, one per journey (support, report, mentor, escalation, complaint, external),
so no fixture is walked through contradictory states.

**Refusals proven — 19 unit + 5 live on the real PREPROD deployment:**

| # | condition | result |
|---|---|---|
| R1 | `inspect` | read-only, no gate, no password |
| R2/R3 | non-staging environment | `environment` |
| R4 | unknown verb | `unknown_verb` |
| R5 | real PREPROD, no acknowledgement | `missing_confirmation` |
| R6 | real PREPROD, the **QA operator's** sentinel | `missing_confirmation` — cross-tool sentinel isolation holds |
| R7 | correct acknowledgement, no `--apply` | dry run, no prompt, no write |
| R8 | correct acknowledgement + `--apply`, no TTY | `no_controlling_tty` |

Unit regressions additionally assert the allowlist refuses
`preprod-qa-operator@ata.invalid`, users 66/67, every real address, and
`attacker@learner-ops.invalid`.

**Database unchanged by all of it:** 54 users before and after, 0 rows in the fixture
domain, 0 fixture audit rows, negative control still `moderator + admin`.

**Two incidental fixes made while building it:**
- importing the module ran `main()`, so importing the provisioner tried to provision;
- `/home/ubuntu` was temporarily widened 750 → 755 so the `ata` user could read the
  working tree during refusal testing, and was **restored to 750** immediately after.

## LO-ENV-HANDLING-1 — a correction to my own operator instruction
**Class:** MEDIUM (procedure). Caught by the user before execution. Not executed.

I proposed running the provisioner as:

```
env $(sudo cat /srv/ata/config/backend.env | grep -v '^#' | xargs) ...
```

**That is wrong and must never be used.** It parses the EnvironmentFile into shell argv,
which (a) exposes every value — `SESSION_SECRET`, `POSTBACK_SECRET`,
`TURNSTILE_SECRET_KEY` — in `ps` output and `/proc/<pid>/cmdline` to any local reader,
and (b) word-splits and glob-expands values, so a secret containing shell-sensitive
characters is silently mangled into something other than what the file says.

`systemd-run --property=EnvironmentFile=` hands the path to the service manager, which
reads it directly. No shell sees the contents, nothing appears in argv, and the file's
quoting semantics are honoured.

**The rule:** `backend.env` is read by the service manager, never by a shell. No `source`,
no `export $(cat ...)`, no `xargs`, no `env $(...)`. Only the non-secret acknowledgement
sentinel is ever passed with `--setenv`.

## Backend release fdc44c5b — the provisioner, published and deployed
Delta from the accepted `af07f658` is **exactly one commit**: the provisioner, its
allowlist, its TTY password intake and its 19-assertion refusal regression, plus one added
npm script line. `git diff --name-only af07f658..HEAD` matches nothing under `src/` or
`prisma/` — runtime and schema are byte-identical to the accepted release.

Gate: typecheck clean, 270 unit tests, 31 domain regressions, artifact gate PASSED
(BUILD_ID `JydxKjNi_VqS9oW5pKZrR`, 250 routes, live smoke). The 10 remaining `require()`
lint errors are pre-existing at `af07f658`, unchanged, in regression scripts this commit
never touched; the new files are lint-clean.

Post-deploy: service active, 0 restarts; rollback anchor `af07f658` present; migration
still **51**, 0 unfinished, integrity `ok`, **0 FK violations**; users still **54**;
**0 fixture rows** created by deploying; negative control still `moderator + admin`; all
learner-ops endpoints still fail-closed 401.

## BROWSER ACCEPTANCE — BATCH 1: the frontline operator (lo-operator, support/user)
Real Chrome, real PREPROD, Basic Auth + Turnstile satisfied by the human. Every claim
below is backed by a captured client request or a database read.

### Routing and real data requests (§12 — the Affiliate lesson)
Every surface was reached by CLICKING, and each issued a real client fetch:

| clicked | request | status |
|---|---|---|
| Операции с учениками | `GET /learner-ops/config` + `GET /learner-ops/cases?assignment=any&breached=any` | 200 |
| tab База знаний | `GET /learner-ops/knowledge` | 200 |
| tab Сигналы (VOC) | `GET /learner-ops/voc` | 200 |
| Поддержка | `GET /learner-ops/config` + `GET /learner-ops/cases?assignment=any&breached=any&type=support_request` | 200 |
| case row | `/cases/{caseId}` deep route mounts the detail workspace | 200 |

`/support` issues the SAME queue read with `type=support_request` — a server-side filter of
one queue, not a second product. No 200-shell, no prefetch, no manifest inference.

### Session contract and server-side authorization (§7)
`GET /crm/v1/session` → role `support`, **6 permissions**: the three note permissions plus
`learner_ops_view`, `learner_ops_handle`, `learner_ops_escalate`. Contract v3 parsed
without error, so the 24-entry closed vocabulary is live.

Affordances withheld: the Качество and Аналитика tabs are not rendered. **Confirmed
server-side rather than trusted:**

| probe | result |
|---|---|
| `GET /learner-ops/analytics` | **403** `LEARNER_OPS_FORBIDDEN` |
| `GET /learner-ops/qa` | **403** `LEARNER_OPS_FORBIDDEN` |
| `GET /curriculum/v2/report-reviews/queue` | **403** `FORBIDDEN` |
| `GET /curriculum/v2/mentor-reviews/queue` | **403** `FORBIDDEN` |
| `GET /learner-ops/cases`, `/knowledge` | 200 |

The two canonical review queues refuse this frontline operator **by direct URL**. All are
403 (app), never 401 (nginx), so the Basic Auth cache was never disturbed.

### Journey E — complaint / service recovery (complete)
LO-000001: created → claimed (status auto-promoted `new`→`in_progress`, assignee set) →
learner-visible reply → internal note → `waiting_learner` → `resolved`.

### Journey D — educational escalation (first half)
LO-000002: escalated with class `educational_methodology`, reason recorded, case →
`escalated`, timeline shows `Смена статуса · Новое → Эскалировано · причина:
escalation:educational_methodology` with `Создано` still present. Left OPEN for the
qualified owner — resolution is batch 3.

### Journey F — external / Pocket (complete on the operator side)
LO-000003: learner-visible reply stating only what ATA canonically knows, then
`waiting_external`. Learner 360 reports `pocket.trader_identity` → `state: "pending"`,
`playerId: null`, with the UI text "Это каноническое состояние. Подтвердить регистрацию
вручную нельзя." No fabricated callback, no deposit, no balance.

### SLA semantics, proven live in the browser (§9)
- First response flipped **Идёт → Выполнено** the instant the first STAFF message was sent.
- `waiting_learner` → resolution **На паузе**, first response stays **Выполнено**.
- `waiting_external` → resolution **На паузе** while first response stayed **Идёт** on a
  case with no staff message yet, then flipped to Выполнено when one was sent. The two
  clocks are independent exactly as designed: a learner waiting for their first reply is
  waiting on us whatever we are waiting on.
- Every SLA figure rendered with `PREPROD-фикстура (не бизнес-политика)`; the panel states
  the product owner supplied no business targets.

### Assignment concurrency (§9/§25)
Two **simultaneous** claims on LO-000003 from `assignmentVersion=0`:
`200` and `409 LEARNER_OPS_ASSIGNMENT_CONFLICT`; final `assignmentVersion=1` (one bump,
not two), one owner. No double-exclusive ownership.

### Internal-note isolation (§15)
`LearnerOpsMessage` = 2, `LearnerOpsNote` = 1, and **0** message rows contain the note's
text. The two composers are separate controls in separate panels with headings that state
the audience; there is no visibility toggle on the screen.

### Audit and progression (§24, §2)
13 timeline events, every one attributed to a named actor, **0 duplicate
`(caseId, caseVersion)`** pairs. After the whole batch: `UserLevelProgress` 57,
`XPTransaction` 13, `ReportSubmission` 7 — **all unchanged**. Migration 51, FK 0.

## LO-UI-CASE-CREATE-1 — no way to create a case in the CRM
**Class: HIGH.** Found in the browser.

`POST /learner-ops/cases` accepts a staff-created case (verified: 201, LO-000001), but the
CRM renders **no create affordance anywhere** — searched the live DOM, `uiHasCreateAffordance: false`.

Four of the seven case types can only originate with staff — `complaint`,
`service_recovery`, `educational_escalation`, `operational_followup`. §6 requires the
unified queue to represent them, and today an operator cannot create one. The four cases
used for this acceptance had to be created through the authenticated API.

**Fix in the consolidated wave:** a create form on the inbox, gated on `learner_ops_handle`,
offering the queue/type/priority/reason vocabulary already returned by `/config`.

## LO-360-PROGRESS-DENOMINATOR-1 — "0 из 0 уровней"
**Class: MEDIUM (product truth).** Found in the browser.

Learner 360 renders `0 из 0 уровней` for a freshly enrolled learner. The denominator counts
`UserLevelProgress` ROWS, which are created as levels are started — not the curriculum's
level count. It is not false, but it reads as "this curriculum has no levels" rather than
"this learner has not started any of 100". Fix: source the denominator from the enrolled
curriculum version's level count, or label it "начато N уровней".

## LO-HARNESS-FORMINPUT-1 — a harness artifact, not a product defect
`form_input` sets a DOM value without dispatching the event React's controlled components
listen for, so a textarea filled that way stays empty in React state and its submit button
stays disabled. One reply appeared to send and did not. Typing with `computer type` works.
Recorded so it is not mistaken for a product bug later; no code change.

## LO-UI-CASE-CREATE-1 = **CLOSED**

**Original failing evidence.** In the live CRM, `uiHasCreateAffordance: false` against the
rendered DOM while `POST /learner-ops/cases` returned 201. Four of seven types are
staff-originated, so the unified queue could not be populated through the product; the four
acceptance cases had to be created with fetch.

**Root cause.** The endpoint shipped without any client affordance. Not a permission or
routing defect — the control simply did not exist.

**Implementation.** `Создать кейс` on the unified queue, gated on `learner_ops_handle`,
calling the canonical endpoint that already existed. No second route, no client-side draft,
no separate complaints or escalation app. Five types offered, derived from the domain's
anchor rule: `report_review` and `mentor_review` require a `ReportSubmission` /
`UserLevelProgress` and are never offered, because a blank form cannot supply one. Queues,
reason codes and priorities all come from `/config`. The learner picker is a search against
the existing Users v1 read — nothing fetched under two characters, `limit=10`, masked
addresses shown with `(скрыт)`, stale responses discarded by a token.

**Regression.** 15 CRM tests, all of which fail against the pre-fix build because the
component did not exist: vocabulary offered, anchor-required types never offered, canonical
endpoint called with exactly what was chosen, validation gating, double-click producing ONE
case, server refusals surfaced rather than a fake success, navigation to the canonical
detail route, affordance hidden without `learner_ops_handle` — plus a backend assertion
that `read_only`/`analyst`/`moderator`/`content_manager` never hold `learner_ops_handle`,
because hiding a button is not the boundary.

**Release.** CRM `00934c88`, BUILD_ID `YNhU3zrV3A1Ekg_u4f9E6`.

**Post-fix browser evidence.** Clicked `Создать кейс`; the form rendered exactly five types
with `report_review`/`mentor_review` absent, four seeded queues and thirteen seeded reason
codes; the learner search issued
`GET /api/crm/v1/users?limit=10&search=Escalation` → 200; submit produced
`POST /learner-ops/cases` → **201** and navigated to `/cases/cmsv11prh0001t5xexl7qombf`.
Result **LO-000005**, `operational_followup`, priority `high`, queue `support`, reason
`followup`, learner `lo-learner-escalation`, `version=1`. Creation event records
`actor = LO Оператор (synthetic)` and `origin: "staff"`; AuditLog carries
`learner_ops.case.created`. Case count 4 → **5** — exactly one, no double submit. The row
appears in the unified queue. No API seeding was used.

## LO-360-PROGRESS-DENOMINATOR-1 = **CLOSED**

**Original failing evidence.** Learner 360 rendered `0 из 0 уровней` for every freshly
enrolled fixture.

**Root cause.** `totalLevels: progress.length` — the count of MATERIALISED
`UserLevelProgress` rows, which are created as levels are started, rather than the
curriculum's level count.

**Implementation.** The total is now `levelDefinition.count()` for the curriculum version
the ENROLMENT names — per-version by construction, because `ata-v2` v1/v2 carry 4 levels
and v4 carries 100. Nothing hardcoded; no progress row created to obtain a number.
`startedLevels` is exposed separately and rendered as `начато: N`, because "0 из 100" and
"has not begun" are different facts.

**Regression.** Three backend checks, each **proven RED** against the pre-fix code by
restoring `progress.length` and re-running (32 passed / 3 failed), then green again on
restore: fresh learner reads 0/7 not 0/0; the denominator is unmoved by materialising two
progress rows; and it follows the learner's own curriculum version rather than a constant.

**Release.** Backend `68b443f4`, BUILD_ID `KHqRM3EMzfzr2zJVLeIbh`.

**Post-fix browser evidence.** Learner 360 for `lo-learner-escalation` renders
**`0 из 100 уровней`** with `начато: 0`, sourced `curriculum.progression`; the underlying
client response carries `totalLevels: 100`, `startedLevels: 0`, enrolment `ata-v2`
version 4. This was a presentation defect and was confirmed visually, not only by API.

## Deploy verification for the correction wave
backend `68b443f4` / crm `00934c88` / academy `6ee50cd5` / partner `68ade762`, all
active/running with **0 restarts**. Rollback anchors `4e91858b` (backend) and `5696c31f`
(crm). Migration still **51** — no migration was required. Integrity `ok`, **0 FK
violations**. Commercial fixtures 66/67 present and unchanged; 12 affiliate conversions and
2 commissions unchanged. Progression untouched: `UserLevelProgress` 57, `XPTransaction` 13,
`ReportSubmission` 7. Negative control still `moderator + admin`. nginx boundaries
unchanged (401/401, deliberate 404 on `/api/health`).

## LO-ACADEMY-SUPPORT-UNREACHABLE-1 = **CLOSED**
**Class: HIGH.** Found in the browser while preparing Journey A.

**Failing evidence.** The Academy accessibility tree offered only Главная, Путь, Уроки,
Инструменты. `/support` rendered perfectly, was proxied correctly and answered 200 — and
nothing in the product could reach it.

**Root cause, two halves of one shape.** Each navigation component carried its own copied
`BUILT_ROUTES` set and neither learned that `/support` had shipped. Both bars rendered
`MOBILE_NAV`, whose «Ещё» overflow entry was itself a DISABLED button because its own id
was absent from that set — so `MORE_MENU`, where Поддержка was listed, could never be
opened at all.

**Implementation.** Both bars render the BUILT sections of the canonical `PRIMARY_NAV` from
ONE shared list (`config/built-routes.ts`). Today that is exactly five, preserving the
designed five-item bar without any component hardcoding which five. Unbuilt sections are
now absent rather than shown as "Скоро" controls — a control advertising a section that
does not exist is a promise the product cannot keep, and here it actively concealed a
shipped one.

**Regression.** Six new tests pin reachability; three existing tests asserted the old rule
and were updated to the new one rather than relaxed.

**Release.** Academy `854e46e6`, BUILD_ID `DEOITP5uSThDZjuR8IAKe`.

**Post-fix browser evidence.** Поддержка appears in the learner navigation and opens
`/support`.

## LO-SLA-WAITING-RESUME-1 = **CLOSED**
**Class: HIGH (product truth).** Found in the browser during Journey A6.

**Failing evidence.** Operator set `waiting_learner` → resolution clock `paused`. The
learner then replied: `lastActivityAt` moved, `messages` grew to 3, and the case remained
`waiting_learner` with the clock still **`paused`**.

**Why it matters.** The pause exists because that delay is the learner's. Once they answer
it is ours — so the clock stayed stopped while the ball was back in ATA's court,
understating our own delay in the flattering direction. It also parked the case in the one
bucket an operator stops looking at.

**Implementation.** A learner message on a `waiting_learner` case returns it to
`in_progress` in the SAME transaction, folding the pause into `pausedMs` with the same
helper every other transition uses, and writing its own timeline event carrying
previousStatus/nextStatus — no silent mutation. `waiting_internal` and `waiting_external`
are untouched: neither was ever waiting on the learner.

**Regression.** Two checks; the primary one proven **RED** against the pre-fix behaviour
(36 passed / 1 failed) and green with the fix.

**Release.** Backend `e8972172`, BUILD_ID `LWGye2VMjbr8tccvz5ZNI`.

**Post-fix browser evidence.** Live: `waiting_learner` → learner reply → status
`in_progress`, resolution clock `running`, first response still `met`, and the timeline
carries the `waiting_learner → in_progress` transition.

## JOURNEY A — SUPPORT E2E: **PASSED**

| step | evidence |
|---|---|
| A1 learner creates | Real Academy UI. **LO-000006**, `support_request`, learner 71, exactly one row, SLA `preprod_fixture_normal` (`preprod_acceptance_fixture`) auto-applied. Creation event `origin: "learner"` with **null staff actor** — provenance distinguishes it from staff-created cases. |
| A2 CRM arrival | Appears in the SAME unified queue beside staff-created LO-000005. No second support product. Claimed through the UI; status auto-promoted to `in_progress`. |
| **A3 note isolation** | Note `NOTE-CANARY-8815` added in CRM. From the learner's own authenticated session: thread `messageCount: 0` at that point, staff note route **404**, CRM staff API **404** on the learner origin, notifications route **404**, canary in **zero** surfaces, `domHasCanary: false`. DB: 0 message rows contain the note text. |
| A4 staff reply | `REPLY-CANARY-5527` sent; first-response SLA flipped to **Выполнено**. Learner receives the reply and **not** the note (`NOTE_CANARY_present: false`, `REPLY_CANARY_present: true`). |
| A5 learner reply | Sent from the real Academy UI, rendered as «Вы», correctly attributed staff/learner in the DB, **exactly one** learner row (no duplicate), never converted to a note. |
| notifications | Exactly **one** `support_reply` notification for learner 71 — names only the case reference, carries no body, no spam. |
| A6 wait/resume | `waiting_learner` → paused; learner reply → `in_progress` + clock running (the fix above). |
| A6 resolve/reopen | Resolved (`resolution: met`), then reopened → `open`, `reopenCount: 1`, `reopenedAt` set, **`resolvedAt` cleared**, **`firstRespondedAt` preserved across the reopen**, new resolution deadline issued, 10 timeline events. |

## LO-UI-TRANSITION-CHOICES-1 — status dropdown is not filtered by the transition table
**Class: MEDIUM (UX). CLOSED 2026-08-16** — backend `835e1b9`, crm `e7f5a5c`.

From `resolved`, the CRM status dropdown offered `in_progress`, `waiting_learner`,
`waiting_internal`, `waiting_external`, `closed`, `open` — but the domain declares only
`open` and `closed` legal from `resolved`. The server correctly refused the others with
**400 `LEARNER_OPS_ILLEGAL_TRANSITION`** (verified live), so this was never a security or
integrity defect: it presented controls that could only fail.

### Fix — a server projection, not a second table
The CRM had its own `TRANSITION_CHOICES` list. Filtering it client-side would have
created a second copy of the state machine that can drift from the domain's. Instead
`getCaseDetail` now projects `LEARNER_OPS_TRANSITIONS[status]` onto the case detail as
`allowedTransitions` — literally the table `transitionCase` refuses against, not a copy —
and the workspace renders that. `TRANSITION_ORDER` survives in the CRM as presentation
order only: it decides where a choice appears, never whether it appears.

The state machine was NOT weakened to make the old choices valid. The server remains the
authority; the projection only stops the UI promising what the domain will not honour.

### Proofs
Backend regressions (41 pass):
- `allowedTransitions` equals the canonical table for a fresh case and for `resolved`,
  and none of the four previously-offered illegal states appear;
- every transition the projection advertises is one `isLegalTransition` accepts;
- a caller that ignores the projection is still refused `LEARNER_OPS_ILLEGAL_TRANSITION`;
- the offered set changes when the state changes.

CRM tests (27 pass), **proven RED** against the pre-fix dropdown by re-injecting the
hardcoded list: 2 of 3 failed, both passing again once reverted.

Browser (reviewer session, live PREPROD):
- **LO-000001 / `resolved`** — dropdown offers exactly `Закрыто`, `Открыто`. Nothing else.
- All four previously-offered transitions forged directly at
  `POST /learner-ops/cases/{id}/status` → **400 `LEARNER_OPS_ILLEGAL_TRANSITION`** each,
  `"resolved -> in_progress is not a transition this domain defines"`.
- **LO-000006 / `open`** — a different, larger set, proving per-state derivation rather
  than a constant; transitioned `open -> in_progress` through the real control, after
  which `in_progress` left the list and `open` entered it, matching the server's own
  `allowedTransitions` exactly.

## LO-ESCALATION-RESOLVE-AUTHORITY-1 — the escalation target cannot close the escalation
**Class: HIGH (product truth / operational dead-end). CLOSED 2026-08-16** — contract v4,
backend `bc79b49`, crm `4c30a5a`. Found during Journey D.

`learner_ops_escalate` gates BOTH acts — raising an escalation and resolving one —
and the grant matrix gives it to `support`, `crm_manager` and `crm_admin` but NOT to
`mentor`. `mentor` is the only staff role holding the two review permissions, so it is
the role an `educational_methodology` escalation is addressed to. The authority the
question was routed to is the one authority that cannot answer it.

### Evidence (live PREPROD, reviewer session, backend `835e1b9`)
LO-000002, `escalated`, class `educational_methodology`, raised by LO Оператор to the
Эскалации queue, unresolved. As `lo-reviewer` (StaffRole `mentor`, User.role `mentor`):

* the case detail renders the escalation READ-ONLY — `ResolveEscalationForm` is gated on
  `canEscalate`, so no resolve control exists in the DOM at all;
* it is not merely hidden. `POST /learner-ops/escalations/{id}/resolve` answers
  **403 `LEARNER_OPS_FORBIDDEN`** — `requireLearnerOpsStaff(["learner_ops_view",
  "learner_ops_escalate"])` refuses server-side;
* session `effectivePermissions` = `["learner_ops_view","learner_ops_handle",
  "learner_ops_report_review","learner_ops_mentor_review"]`.

### Why this is HIGH and not cosmetic
`escalation.ts` states the intended shape plainly: the escalation routes a QUESTION to a
qualified authority, and "the answer, when it arrives, is a resolution string and a
learner-visible message". The resolution is the RECEIVING authority's answer. Today:

* the mentor can send the learner-visible answer (`learner_ops_handle` is granted) but
  cannot record the resolution — so the answer exists and the escalation record does not
  know it;
* the escalation can only be closed by `support` — the frontline that raised it — which
  is precisely the self-certification escalating exists to prevent;
* the mentor CAN move the case `escalated -> in_progress` with the escalation still open,
  so the operational state can say "handled" while the escalation row says unresolved.
  That is a reconciliation lie the product currently invites.

### Recommended fix — split the two acts, do not widen the one permission
Granting `mentor` the existing permission would close the dead end and keep the deeper
conflation: `support` would still be able to close the escalation it raised. The honest
shape is a 25th permission, `learner_ops_escalation_resolve`, gating resolution only:

* granted to `mentor` (educational authority), `crm_admin` and `crm_manager`
  (operational escalation owners);
* NOT granted to `support`, so a frontline operator raises and never self-closes;
* `learner_ops_escalate` keeps its stated meaning — "may raise an escalation to another
  authority" — unchanged, and every current holder keeps it.

This is a CRM_SESSION_PERMISSION_CONTRACT change and must go through the 6-step process
in both repos (byte-identical file, digest and version bumped to v4).

### Fix as shipped
The accepted split, permission 25 of contract v4, digest
`1514e85f02224b31082bac7e596e96a5dec5682df73855224a2e072e53590110`:

* `learner_ops_escalate` — unchanged meaning, unchanged holders (support, crm_manager,
  crm_admin). Nobody lost the ability to raise.
* `learner_ops_escalation_resolve` — NEW, granted to `mentor`, `crm_admin`,
  `crm_manager`. `support` deliberately does NOT receive it, so the party that raises an
  educational escalation cannot self-certify its resolution.
* Both the route and the UI follow the new name. Ownership of the case is not sufficient,
  and `learner_ops_handle` is not a substitute for either act.

Contract order is untouched: the twenty-four existing entries keep their exact positions
and the new name is appended at index 24. No other role's permission set changed, asserted
by regression.

### §4 reconciliation — the invariant chosen
**A case may not enter a terminal state (`resolved`, `closed`) while any escalation on it
is unresolved.** Deliberately the smallest coherent shape:

* non-terminal movement stays legal — "still being worked while a second authority
  thinks" is true, not a lie;
* the check runs inside the same transaction as the status write, so an escalation opened
  concurrently cannot slip past;
* it is not a second escalation truth — one row, one `resolvedAt`, and this asks that row;
* resolving performs the canonical case reconciliation in the same act, as it already did.

A learner-visible message does NOT close the escalation, asserted by regression F.

The allowed-transition projection mirrors the invariant, so the dropdown does not offer
what the domain will refuse — LO-UI-TRANSITION-CHOICES-1 applied to the new rule rather
than re-created by it.

### Proofs
Backend regressions: **55 pass**, including A–J. Proven RED against the old behaviour by
re-injecting each defect separately — the v3 grant matrix (2 failures) and the missing
invariant (1 failure). CRM: 3060 pass, and the UI split test goes red when the resolve
form is re-gated on the raise permission (2 failures).

Server-side authority, deployed release, live database, using the same predicates the
HTTP gate uses:

| principal | staff role | raise | resolve |
|---|---|---|---|
| lo-operator | support | ALLOW | **REFUSE** |
| lo-reviewer | mentor | REFUSE | **ALLOW** |
| lo-admin | crm_admin | ALLOW | ALLOW |
| preprod-qa-operator | moderator | REFUSE | REFUSE |

No principal was modified to make this matrix pass.

### Journey D — PASSED
Real browser, reviewer session, LO-000002:

* escalation open before the action (`resolvedAt: null`), and the reviewer now HAS a
  «Закрыть эскалацию» control where before the DOM contained none;
* reviewer sent a learner-visible educational answer (`MENTOR-ESC-CANARY-5170`) — and the
  escalation stayed open, proving a message is not a resolution;
* while it was open the status dropdown offered only `in_progress` and the three waits;
  forged `resolved` and `closed` returned **400 `LEARNER_OPS_ESCALATION_OPEN`**
  ("case has 1 unresolved escalation(s) and cannot become resolved");
* reviewer then resolved it explicitly. `resolvedByStaffId` = the mentor profile
  (`lo-reviewer`), distinct from `raisedByStaffId` (`lo-operator`); `resolvedAt` and
  `returnedToOwnerAt` stamped; resolution text stored; audit row
  `learner_ops.escalation.resolved` attributed to userId 69 while the raise row is
  attributed to userId 68;
* the case reconciled `escalated -> in_progress` in the same act, reason
  `escalation_resolved`, and the terminal transitions returned to the projection;
* timeline preserved end to end — created, escalated, assigned, first response, resolved,
  with the original operator's entries untouched;
* **Academy progression unchanged**: learner 74 still `currentLevel 1`,
  `highestCompletedLevel 0`, zero `UserLevelProgress` rows, zero `ReportSubmission` rows.
  Resolving an operational escalation completed nothing.

## LO-REVIEW-WORKITEM-UNREACHABLE-1 — two of seven case types can never exist
**Class: HIGH (product truth / capability not delivered). CLOSED 2026-08-16** — backend
`37c8b085`, crm `94ebaa69`, migration 52. Found during Journey B §11. Option 1 accepted by the reviewer.

A canonical L3 report submission produces **no Learner Operations work item**, and no path
in the product can produce one. `report_review` and `mentor_review` are unreachable types.

### Evidence (live PREPROD, real learner flow, backend `bc79b49`)
`lo-learner-report` (user 72) walked the real Academy: L1 attested, L2 passed 4/4, L3
started, report drafted and submitted. The canonical side is correct and complete —
`ReportSubmission` 8 `pending_review`, `workflowVersion` 2, revision 2 submitted,
`UserLevelProgress` 61 `pending_review`, `REPORT_SUBMITTED` audited, and the reviewer sees
it in the real CRM report-review queue ("Отчёты на проверке · Ожидают проверки: 1").

The Learner Operations side is empty:

* `SELECT count(*) FROM LearnerOpsCase WHERE userId = 72` -> **0**;
* nothing in `src/lib/curriculum/**` calls `createCase` or writes `LearnerOpsCase` — there
  is no bridge from report submission to the operational queue, in either direction;
* the CRM create-case form offers only `STAFF_ORIGINATABLE_TYPES` (the five anchor-free
  ones) and explicitly names `ANCHOR_REQUIRED_TYPES = ["report_review", "mentor_review"]`
  as never offered, because a blank form cannot supply a canonical anchor;
* so the two seeded queues `Проверка отчётов` (`loq_report_review`) and `Проверка практики`
  (`loq_mentor_review`) are structurally incapable of ever holding a row.

### Why this is HIGH
The phase's central product claim is ONE department with a unified work queue covering
support **and** report-review ops **and** mentor-review ops. What ships is a unified queue
that covers support and escalation only, with the two educational families living entirely
in their separate canonical queues. `LEARNER_OPS_CANONICAL_DECISION_TYPES`,
`LEARNER_OPS_REQUIRED_ANCHOR`, the `reportSubmissionId` / `userLevelProgressId` anchor
columns, their CHECK constraints and two of the four seeded queues are all dead code today
— they describe a capability the product cannot reach.

It also blocks the acceptance script directly: §11 (a work item must arise), §12 and §14
(that item must reconcile and resolve), and the identical steps in Journey C.

### What is NOT wrong
No canonical truth is missing or duplicated, and nothing is fabricated. This is an absent
integration, not a broken one — which is why the fix must not be "let the CRM create a
`report_review` case from a blank form".

### Options for the fix (a product decision, not a code detail)
1. **Server-side bridge, operations follow canonical.** `submitReport` and the mentor-review
   request open a `report_review` / `mentor_review` case in the same transaction, anchored
   to the canonical object; the canonical decision closes it. Operations mirrors canonical
   truth and never authors it. Most faithful to "additional, never alternative", and makes
   SLA, assignment and VOC apply to educational work.
2. **Anchored creation from the canonical surface.** The report-review workspace grows an
   explicit "open an operations case for this submission" action. Cheaper, but the queue is
   then only as complete as operator diligence, so it is not really a work queue.
3. **Accept the boundary and delete the vocabulary.** Declare report and mentor review to be
   canonical-only in V1 and remove the two types, two queues and the anchor columns, so the
   model stops describing a capability that does not exist.

Option 1 is the one that matches what §1 of the phase spec promises. Options 2 and 3 are
honest but narrower.

### Implemented (backend `37c8b08`, crm `94ebaa6`, migration 52) — awaiting deploy
Canonical owners create and reconcile the derived work item inside their own transaction:
`submitOwnReport` / `resubmitOwnReport`, `rejectReportSubmission`, `approveReportSubmission`,
`requestMentorReview`, `approveMentorReview`. One integration owner
(`src/lib/learner-ops/review-work-items.ts`) holds every call; no route handler creates a
case directly.

* ANCHORS. `reportSubmissionId` -> `ReportSubmission` (the object that survives the whole
  reject/resubmit lifecycle, so a resubmission reuses the same case) and
  `userLevelProgressId` -> `UserLevelProgress` (which IS the canonical mentor-review
  object). Both already existed with FKs and CHECKs binding type to anchor in both
  directions; the one thing missing was uniqueness.
* MIGRATION 52 — two partial unique indexes, nothing else. Rehearsed against a fresh copy
  of live PREPROD: 51 -> 52, integrity ok, 0 FK, every table's row count identical,
  `ReportSubmission` 8 and `UserLevelProgress` 61 byte-identical, both indexes created.
* MAPPING. `pending_review` -> operational `in_progress`; `rejected` (this domain's
  vocabulary for a revision request) -> `waiting_learner`, which is the state the SLA
  engine already pauses the resolution clock on; `approved` -> `resolved`.
* TWO HARD INVARIANTS. A `report_review` / `mentor_review` case cannot reach a terminal
  status while its canonical object is open (`LEARNER_OPS_CANONICAL_REVIEW_OPEN`), and the
  allowed-transition projection withholds what the domain would refuse. The canonical owner
  passes because it reconciles AFTER its own row has moved, in the same transaction — the
  ordering is the authorization, with no exemption or privileged actor.
* RECONCILIATION OWNER for state that predates the integration
  (`reconcile-review-work-items.ts` + `scripts/ops/reconcileReviewWorkItems.ts`): generic,
  dry-run by default, idempotent, reads canonical state and writes none of it.
* §15. The canonical report-review detail now carries `operationalWorkItem` and the CRM
  view links to the case, so the specialized surface and the unified queue reconcile to one
  object.

Regressions: R1, R2 (covering R4/R5), R3, R6, R7/R8, R9, R10 in
`curriculumReportApprovalRegression` (27 pass); M1-M8 in `curriculumPhaseFRegression`
(44 pass); the approve-vs-revision race and the both-directions §11 invariant query.
Learner-ops domain 55 pass, CRM 3062 pass, both builds clean.

Found and fixed in passing: `nextReference` minted `LO-<rowCount+1>`, so any gap in the
sequence — a deleted case, a rebuilt mirror — produced a collision the in-transaction path
could not retry. It now derives from the highest existing reference.

### Deployed and closed in the real product
Migration 52 applied through the canonical owner: 52 applied, 0 unfinished, integrity ok,
0 FK, exactly the two intended partial unique indexes, every table row count unchanged, and
`ReportSubmission` 8 / `UserLevelProgress` 61 / users 66-67 / Pocket identities all
untouched.

Reconciliation of the parked report, dry run first: the proposed set was ONE row — report 8,
user 72, level 3, `pending_review`, work item MISSING. No protected object, no commercial
fixture, nothing historical. Applied:

* BEFORE — report `pending_review`, progress `pending_review`, work item absent
* AFTER — report **SAME** `pending_review` (workflowVersion 2, submittedRevision 22
  unchanged), progress **SAME** `pending_review`, and exactly one anchored `report_review`
  case `LO-000007` in `loq_report_review` with the SLA policy applied.

Reconstruction of missing DERIVED operational state from canonical truth. No educational
mutation, no fabricated review, no duplicate.

Browser proof, reviewer session, all ten closeout criteria:
`LO-000007` appears in the UNIFIED queue beside support requests and escalations, typed
«Проверка отчёта», routed to «Проверка отчётов», assignable («Взять себе»), SLA rendered with
its PREPROD-fixture provenance, and its canonical block reads «curriculum.report · Отчёт #8 ·
Уровень: 3 · Статус (по данным владельца): pending_review» with the boundary stated in the
product: «Закрытие обращения не завершает уровень». Its `allowedTransitions` omitted
`resolved` and `closed` — the §6 invariant visible in the projection. The specialized review
surface reconciles the other way: «Операционная карточка → LO-000007», with «Очередь и SLA
ведутся в «Операциях с учениками». Учебное решение принимается здесь.»

The mentor path is proven by M1-M8 regressions and will be proven live in Journey C.



## DISK-HEADROOM-3 — the artifact gate could not publish the mentor-surface fix
**Class: BLOCKER (environment). RESOLVED 2026-08-16.** Five authorized deletions, all five
required (four reached 7.83 GiB, just under the 8 GiB floor). 2874 -> 9099 MiB (8.88 GiB).
Both candidates published and cut over.

## RELEASE-WORKTREE-COUPLING-1 — a worktree depends on an immutable release directory
**Class: infrastructure / operational debt.** Recorded, non-blocking, NOT repaired.

```
/srv/ata/worktrees/g2-assessment-binding-fix/node_modules
  -> /srv/ata/releases/backend/d12ab14c.../node_modules
```

A git worktree borrows `node_modules` from a published release, so that release is load-bearing
for something outside the release system entirely. Discovered by the DISK-HEADROOM-3 inventory
when the symlink scan was widened past `current/`, `previous/` and the release tree — under a
narrower scan `d12ab14c` would have read as unreferenced and been a deletion candidate.

Both `d12ab14c` and `rollback-d12ab14c-verified-20260812` are now explicitly protected. The
coupling was not repaired in this wave: no symlink replaced, no `node_modules` copied, no
worktree touched. The final infrastructure audit should decide why a worktree depends on an
immutable release at all — it makes release retention answerable to development state.

## DISK-HEADROOM-2 — the artifact gate cannot publish the fix
**Class: BLOCKER (environment). RESOLVED** — three authorized deletions, two of which
sufficed for the LO-REVIEW-WORKITEM-UNREACHABLE-1 deploy; the third was later spent on the
financial-checkpoint attestation release.

`publish-release.sh` refuses: `need 3352 MiB, have 2549 MiB` (candidate 1304 MiB + 2048 MiB
margin). Root is 98% full. The fix for LO-REVIEW-WORKITEM-UNREACHABLE-1 is built, committed
and fully gated, and cannot be published or deployed until space is reclaimed.

The growth is this phase's own release churn: twelve backend releases published today.

### The fail-closed guard caught one of the four authorized paths
`00add919c746915db0ad680d5ef9323ba3abe165` is the target of
`/srv/ata-data/access-control/.cutover-rollback-backend` — the live canonical rollback
receipt, written 2026-08-16 05:55 by the cutover that activated the current release. It was
proposed for reclamation because the earlier inventory read the `previous/backend` symlink
and not the receipt. **Nothing was deleted.** This is DISK-HEADROOM-1a's exact lesson
holding: the receipt directory is an independent reference source and must be re-read per
candidate.

Note also that the two backend rollback anchors DISAGREE: `/srv/ata/previous/backend` points
at `4208e719`, while the cutover receipt points at `00add919`. Both are protected; the
receipt is the more recent of the two.

The other three candidates passed all ten checks.

## ROLLBACK-ANCHOR-DRIFT-1 — two backend rollback anchors disagree
**Class: LOW (procedural / deployment metadata).** Recorded, deliberately not repaired.

`/srv/ata/previous/backend` -> `4208e719`, while the canonical cutover receipt
`/srv/ata-data/access-control/.cutover-rollback-backend` -> a different release. Observed
during the DISK-HEADROOM-2 guard, which is how a live rollback anchor came within one
authorized `rm` of deletion.

Evidence gathered across this phase's cutovers: the RECEIPT advances on every cutover
(`00add919` -> `bc79b49d` when `37c8b085` went live; `bc79b49d` -> `37c8b085` when
`905d8612` went live) while `previous/backend` has not moved from `4208e719` once across
four cutovers. The receipt is maintained by the cutover owner; `previous/` appears to be stale
legacy metadata from an earlier deployment mechanism.

For this phase: the receipt is the operational rollback authority, BOTH referenced releases
are protected, and neither symlink nor receipt is rewritten. The canonical cutover mechanism
has a valid present rollback target, so this blocks nothing. A later audit should decide
whether `/srv/ata/previous` is legacy metadata to retire or an ownership gap to consolidate
— not in this phase.

## LO-MENTOR-SURFACE-ANCHOR-1 — the mentor review page did not name its operational case
**Class: MEDIUM (parity gap).** DEPLOYED (backend `521cbef`, crm `d181d33`) — **still OPEN**:
the browser row proof cannot be produced against the accepted Journey C object. Found during
the Journey C live run.

`§15` requires both specialized review surfaces to reconcile to the anchored Learner
Operations work item. The report-review surface carries `operationalWorkItem`; the mentor
surface shipped without it. So during Journey C, `LO-000009` existed, was correctly
anchored to progress row 74, appeared in the unified queue and was visible from the
operational side — but the page a mentor actually works from named no case at all, and the
two review families documented the same boundary differently.

Not a truth defect: no state was wrong, and the operational side always pointed correctly at
`curriculum.progression / Прогресс #74`. It is a one-directional hole in the reconciliation
the phase requires.

FIX (backend `521cbef`, crm `d181d33`, both now live): `listMentorReviewQueue` projects the
anchored case, and the queue row renders the reference, the operational owner and the
boundary sentence — the same treatment the report surface already had. Regression covers both
the present and the absent case. Backend 56 pass, CRM 3064 pass, both builds clean.

### WHY IT IS NOT YET CLOSED
The mentor queue lists `UserLevelProgress` rows whose status is `pending_review`, and
Journey C's L14 is now `completed`. The row that would carry the link no longer exists, so
items 1-3 of the closeout (row renders the reference / names LO-000009 / click-through)
cannot be demonstrated in the browser against the accepted object.

There is no pending mentor review anywhere in PREPROD, and one cannot be manufactured
honestly: `approveMentorReview` has no path back from `completed` (deliberate — a learner
cannot reopen a level a reviewer approved), the mentor learner's next mentor-review level is
L29 (fourteen levels and two more financial checkpoints away), and the only other learner
past L13 belongs to a different phase.

### What IS proven live, post-deploy
* the honest ABSENT state renders correctly — «Сейчас нет работ, ожидающих проверки.», zero
  rows, no invented placeholder (this is one of the two cases the regression pins);
* `LO-000009` remains `resolved`, still anchored to progress 74, and its case detail still
  reads back `curriculum.progression / Прогресс #74 / completed`;
* exactly one `mentor_review` case exists;
* navigation between the surfaces changed no canonical state.

Closing needs one of: (a) accept the deployed contract + regression + partial browser
evidence; (b) authorization to walk a sanctioned fixture to another mentor-review level
purely to render the row; (c) defer to the final audit as accepted MEDIUM with the gap
stated. This is a reviewer decision, not something to settle by weakening the criterion.

## LO-ACADEMY-SUPPORT-LAYOUT-1 — support page ignores the app content container
**Class: LOW (cosmetic).** Open.

`/support` renders flush to the left viewport edge with no page gutter, while
`/` and other Academy pages centre their content. The `SupportHub` sets its own
`max-width` but is not inside the shell's content container.
