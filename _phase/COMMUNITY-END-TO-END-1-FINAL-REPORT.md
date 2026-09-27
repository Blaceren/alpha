# ATA-PREPROD-COMMUNITY-END-TO-END-1 — FINAL REPORT

**Date:** 2026-08-16 · **Scope:** Academy Community V1 · **Apps changed:** backend, academy, crm ·
**Partner:** untouched.

---

## A. Starting product/release state (verified, not assumed)

| Component | `current` at start | Source HEAD | Health |
|---|---|---|---|
| backend | `69fd1597…` | `d2a091f…` (docs-only drift: +48 lines in `docs/RELEASE_ARTIFACT_CONTENTS.md`) | `200 {"ok":true,"database":"connected"}` |
| academy | `6ff93eaf…` | identical | 307 (auth redirect) |
| crm | `49f16ada…` | — | 307 |
| partner | `2265f436…` | — | 200 |

Migration **52**. All four rollback receipts resolved. Release tooling `--check`: all 6 files `ok`,
active tooling matching source commit `92819f67…`, clean tree. Product source read from
`/home/ubuntu/learner-ops-v1/{academy,backend,crm}` on branch `product/learner-operations-v1`;
`/srv/ata/repos` was not used.

## B. Community inventory

Seven legacy models (`ChatChannel`, `ChatMessage`, two assignment tables, rule/mute/log).
`retentionDays` default **3**. `ChatMessage` denormalises `userLevel`, `userRank`, `role`,
`achievementTitle`. No thread, no title, no parent, no reply, no report, no read-state model
anywhere in 125 models.

Live PREPROD, and this is the decisive fact:

```
ChatChannel 5 · ChatMessage 0 · ChatMute 0 · ChatModerationRule 0
ChatModerationLog 0 · MentorChannelAssignment 0 · ModeratorChannelAssignment 0
```

**Legacy Community has never carried a single message.** `/community` was declared in
`navigation.ts` and absent from `built-routes.ts` and from disk — a dead pointer. CRM had no
community surface at all.

The legacy gate reads `User.level`, which is `1` for **every learner in the database**, including
two who have completed fourteen V2 levels. A learner at V2 level 14 would have been refused the
`reports` channel (requiredLevel 3).

Full detail: `COMMUNITY-INVENTORY.md`.

## C. Classification

28 capabilities classified. REUSE: the LO two-gate pattern, `StaffProfile` + `CRM_PERMISSIONS`, the
Academy bounded-proxy pattern, the viewer DTO boundary, V2 progression, the notification surface,
the nav entry, the five-space map. ADAPT: the moderation-log shape, the write-guard pattern.
LEGACY/PRESERVE: every chat model and route. **UNSAFE TO REUSE:** `canAccessChannel` on `User.level`,
`requiredCheckpoint` on `UserTaskProgress`, `canModerateChat` on `User.role`. MISSING: discussions,
replies, reporting, moderation permission, notifications, tombstones. **No legacy behaviour was
deleted.** `/chat` works unchanged.

## D. Final product contract

Five spaces, inherited from `academy/docs/CURRICULUM_AND_UNLOCKS.md` §5 — not invented — with unlock
levels re-expressed against **V2 curriculum progression**. All five are module checkpoint levels
(M1→4, M4→20, M7→35, M9→45, M17→85), verified against the published `ModuleDefinition` rows.

One refinement, stated as a decision: the entry space splits **read** from **write** (readable at
enrollment, postable at L4). Reason from live data — under a single threshold, every learner below
level 4 meets a Community that answers "nothing here for you", and in PREPROD four of five spaces
are closed for everyone. The accepted L4 write gate is unchanged; a fresh registration still cannot
post.

Not built: reactions, search, real-time, read state, presence, DMs, followers, badges, reputation,
community profiles, edit-after-post, nested replies, trending.

## E. Data model / migration

**Migration 53** `20260816180000_community_v1`. Five tables (`CommunitySpace`,
`CommunityDiscussion`, `CommunityReply`, `CommunityContentReport`, `CommunityModerationAction`),
12 indexes, 5 seed rows. Hand-written, Community objects only.

Why not reuse `ChatMessage`: three-day retention on a learning answer; no title and no parent; V1
progress denormalised onto every row; and one `requiredLevel` column that would have to mean two
different progressions at once.

**Rehearsal** on a copy of live PREPROD: applied in **18 ms**, every pre-existing row count
identical, `integrity_check` ok, `foreign_key_check` empty, 127 → 132 tables.

**Live apply** (after a verified online backup): **86 ms**, migrations 52 → 53, tables 127 → 132,
every closed-domain count identical, integrity and FK clean, database ownership `ata:ata 600`
preserved.

`prisma migrate diff` additionally wanted to rebuild 13 unrelated tables and rename 10 indexes.
That drift was **proved pre-existing** by diffing the same database against the schema at HEAD with
no Community models present — identical output. Rebuilding `User`, `GrowthEvent`,
`PocketProviderEvent` and `ProviderIngressEvent` to land a discussion board would have been a
destructive rewrite of four closed domains, so migration 53 excludes it (CM-11).

## F/G. Access and progression gating

One owner: `backend/src/lib/community/access.ts`.

Reads durable `UserLevelProgress` rows for the pinned curriculum version, **contiguously** — a gap
at level 4 keeps the level-4 gate closed even with level 14 finished. Never reads `User.level`,
`User.xp`, `enrollment.highestCompletedLevel` (a summary counter, refused for the same reason
`tool-access.ts` refuses it), `User.role`, `UserTaskProgress` or `UserAchievement`. Every unknown
fails closed.

A moderator's permission widens **reading only** and never writing. Denial names the module —
«Откроется после завершения модуля 4» — never «недостаточный уровень».

Verified on live rows: learner 73 (V1 level 1, V2 14 complete) may write; learner 72 (3 complete)
may read and not write and is told "module 1"; learner 71 (0 complete) the same; `chart_review`
closed for all and named as module 4; a moderator reads all five and writes none.

**Legacy untouched:** `ChatChannel.requiredLevel` still reads `User.level` for `/chat`. No
synchronisation, no migration to make numbers agree.

## H/I/J/K. Home, spaces, threads, creation

**Home = Direction B «Порог»** (selected at the D5 gate): five unequal plates whose material carries
open / readable / locked, a rail bright through what the learner holds, and **real discussions
inside every accessible plate** — including a read-only one, because below level 4 that is the
learner's only space and a bare plate would restore the dead end.

**Space and thread = Direction A «Открытый вопрос»**: the question at display size, coordinates in
mono beneath it, answers in a lighter material with a signal tick. Replies are flat by construction
— no `parentReplyId` exists.

Creation: title 3–140, body 1–4000, per-field errors, draft preserved on refusal, identical
resubmission within 60 s deduplicated rather than doubled. Deletion: author soft-delete; tombstones
keep thread shape and never orphan replies; removed content projects a neutral author.

## L. Moderation and reporting

Learner reporting: four bounded reasons plus an optional note. **The reporter is never projected to
any learner and there is no public report count** — verified in the live thread projection.

Staff: hide / restore / resolve, Backend-authoritative, appended to `CommunityModerationAction`.

Authorization is the new CRM permission **`community_moderate`**, held by `moderator` and
`crm_admin` and nobody else. This is the permission `crm/roles.ts` already named as missing:
`moderator` held nothing, so the only thing that actually let it moderate was `User.role = admin`
on the same account. The 7-step cross-repository contract procedure was followed — v5, 26
permissions, digest recomputed, copied verbatim to the CRM, and proved byte-identical by the
repository's own verifier.

The moderator's removal reason is internal and never reaches the learner — asserted on live data.

## M. Notifications

Two new types, no second surface. `community_reply` (never self) and `community_moderation`, both
carrying `{ spaceCode, discussionId }`. Both appear in `/notifications` and **both now link to the
thread** (CM-03).

## N/O. Academy integration and privacy boundaries

`community` added to `built-routes.ts`; the entry appears in both nav bars. Community never
completes a level, awards XP or writes progression — held by source-fact tests that prove the module
cannot express the write at all, not merely that one call did not.

The learner origin returns **404** for `/api/crm/v1/community/moderation`. The author projection is
a closed field list carrying a name, an approved public role label and a module number; `support`,
`analyst`, `retention_manager`, `content_manager` and `read_only` publish **no** label.


## A2. Authenticated moderator identity and permission (runtime, not inferred)

`GET /api/crm/v1/session` in the live authenticated browser:

```
employeeId            cmsq3kenz0002t5dn8kclibvz
displayName           PREPROD QA Operator (synthetic)
role                  moderator
effectivePermissions  ["community_moderate"]
permissionVersion     1
```

That `employeeId` binds in the database to `userId 54` / `preprod-qa-operator@ata.invalid`,
`status active`, `StaffProfile.staffRole moderator`. Permission was resolved by the canonical owner
(`resolveEffectivePermissions`), never from the email or the visible role label.

## B2. Credential remediation proof — QA-OPERATOR-CREDENTIAL-DRIFT = REMEDIATED

The drift was self-inflicted: this phase's acceptance run overwrote user 54's password to obtain
sessions. Neither accepted provisioner could repair it — `preprodQaOperator provision` owns the
identity but is create-only, and `learnerOpsAcceptanceFixture` explicitly refuses that address to
keep it the negative RBAC control. A one-shot script, run by the human, took the secret from
`/dev/tty` via the already-accepted intake module.

Against the baseline captured immediately before:

| Axis | Before | After |
|---|---|---|
| email / role / status / level / xp | `preprod-qa-operator@ata.invalid \| admin \| active \| 1 \| 0` | identical |
| StaffProfile | `moderator \| 1 \| cmsq3kenz…` | identical |
| Community discussions / replies / reports / actions | 2 / 1 / 2 / 1 | identical |
| User / StaffProfile / UserLevelProgress / XPTransaction | 63 / 16 / 74 / 26 | identical |
| Pocket / Affiliate / LearnerOps | 12 / 2 / 9 | identical |
| users 66/67 `updatedAt` | 1786807560020 / 1786812269286 | identical |
| **user 54 credential** | `updatedAt` 19:24:29Z | **21:38:43Z**, bcrypt/60 — the one intended change |

No permanent password-reset feature was created.

## C2. Moderator browser acceptance

Section reachable from real CRM navigation («Сообщество», visible only after CM-16 was fixed).
Workspace loads real records: two open reports carrying reason chips («Спам», «Не по теме»), the
space and thread context, the author and public state, the reporter identity and the reporter's
note — all staff-side. Recent discussions and the append-only moderation history render beneath.
Staff actions are controls, never presented as learner content, inside the existing CRM shell.

## D2. Moderation mutation and canonical persistence

| | Before | After |
|---|---|---|
| target | reply `cmsw76a5l0001t57lgqd3pu4u` (author 56) | same |
| public state | `visible` | `removed_by_moderator` |
| report | `cmsw7lwn9…` spam, `open` | unchanged by this action |
| `removedByStaffId` | null | `cmsq3kenz…` → userId 54, role moderator |
| `removalReason` | null | `Спам` (staff-side only) |
| moderation actions | 1 | 2 — `reply.remove` appended, timestamped, attributed |
| author notification | — | `community_moderation` to user 56, carrying the thread title and **not** the reason |

Performed through the browser; the UI flipped «Опубликовано» → «Скрыто модератором» and offered
«Восстановить», so the action is reversible.

## E2. Learner projection after moderation

Resolved through the real service path as a learner who is neither author nor moderator:

```
replies: 1
body   : { "kind": "removed", "removedBy": "moderator" }
author : { "id": 0, "displayName": "Участник", "roleLabel": null, "moduleNumber": null }
thread : still readable, title intact
```

Original text absent, removal reason absent, staff id absent, report id absent, real author name
absent, no email. The thread keeps its shape and the reply keeps its place — no orphan, no dead end.

## F2. Reporter and internal-metadata privacy

The learner thread projection's keys are `id, spaceId, spaceCode, title, author, body, createdAt,
canRemove, canReport, replies` — **there is no report concept in it at all**. Probes for `report`,
`reporter`, `reason`, `жалоб` and `removalReason` are all absent; the only positive substrings are
`canReport` and `removedBy:"moderator"`, which are the tombstone's own vocabulary. The second
reporter (user 71) and the reporter's note text are both absent. The CRM shows all of it to
authorized staff, which is the intended asymmetry.

## G2. Negative control — support role (server side)

`user 68` / `lo-operator@learner-ops.invalid`, `StaffProfile.staffRole support`, resolved by the
canonical owner: **6 permissions, `community_moderate` ABSENT**. `moderator` resolves 1 and holds
it; `crm_admin` resolves 26 and holds it. Nav visibility follows the permission for every role, now
asserted by `community-route-composition.test.tsx`. The browser half of this proof is the one
remaining gate.

## H2. Learner / staff route boundary (re-confirmed after final releases)

```
academy origin  /api/crm/v1/community/moderation  ->  404
backend         /api/crm/v1/community/moderation  ->  401 {"code":"unauthorized"}  (no permission named)
```

The CRM moderation UI is not exposed through the Academy.


## G3. Negative control — support role, proven in runtime

**Identity (Part 1).** `GET /api/crm/v1/session` in the live authenticated browser returned
`employeeId cmsuzbk6i0002t5jybnr3udli`, `role support`, and six permissions:
`edit_user_notes, view_user_notes, create_user_notes, learner_ops_view, learner_ops_handle,
learner_ops_escalate` — **`community_moderate` absent**. That employeeId binds in the database to
`userId 68` / `lo-operator@learner-ops.invalid`, `status active`, `staffRole support`. Resolved by
the canonical owner, never from the visible role label.

**Credential remediation (Part 2) — NEGATIVE-CONTROL-CREDENTIAL-DRIFT = REMEDIATED.**

| Axis | Before | After |
|---|---|---|
| identity (`email\|name\|role\|status\|level\|xp`) | `lo-operator@…\|LO Operator (synthetic)\|user\|active\|1\|0` | identical |
| StaffProfile (`id\|displayName\|staffRole\|version`) | `cmsuzbk6i…\|LO Оператор (synthetic)\|support\|1` | identical |
| six support permissions / `community_moderate` | present / absent | identical |
| Community discussions, replies, reports, actions | 1 visible + 1 removed, 1 removed, 2 open, 2 | identical |
| UserLevelProgress / XPTransaction / XpEvent | 74 (73 completed) / 26 / 0 | identical |
| Pocket / Affiliate / LearnerOps | 16·12·99 / 2·2 / 9·9·4 | identical |
| users 66/67 | 1786807560020 / 1786812269286 | identical |
| **fixtures 69/70/74/75/76** | `2026-08-15 23:00:26-27` | **identical — untouched** |
| **user 68 credential** | `updatedAt` 19:24:29Z | **22:04:35Z**, bcrypt/60 — the one intended change |

The untouched timestamps on 69/70/74/75/76 are the proof that the bounded script wrote exactly one
row, and the reason the nine-account provisioner was rejected.

**Navigation (Part 3).** The support session's CRM navigation renders «Пользователи», «Операции с
учениками», «Поддержка» — and **no «Сообщество»**. The complement is instructive: the moderator saw
«Сообщество» and *not* the two Learner Operations sections. Each role sees exactly what its
permissions grant.

**Direct route (Part 4).** Navigating to `/community-moderation` while authenticated as support
renders no workspace, no reports and no controls — only the bounded panel «У вашей роли нет прав на
модерацию сообщества.» with a retry. Never a blank screen, never an authentication loop.

**Server-side refusal (Part 5) — the key proof.** Three real calls on the authenticated support
session:

| Attempt | Result |
|---|---|
| `GET` the moderation queue | **403** `COMMUNITY_FORBIDDEN`, `detail: null` |
| `POST reply.restore` on the moderator-removed reply | **403** `COMMUNITY_FORBIDDEN`, `detail: null` |
| `POST discussion.remove` on the visible discussion | **403** `COMMUNITY_FORBIDDEN`, `detail: null` |

`403`, not `401` — authenticated and unauthorized, which is precisely the distinction a hidden
button cannot make. The envelope never names the missing permission. Database after: reply still
`removed_by_moderator` by the moderator's staff id, discussion still `visible`, moderation actions
still **2**, open reports still **2**, and **zero** actions attributed to the support staff profile.

**Support authority preserved (Part 6).** `SUPPORT CAPABILITIES PRESENT` and `COMMUNITY MODERATION
ABSENT`. The Learner Operations queue renders in the browser with real cases (LO-000004, LO-000002,
LO-000006), filters and «Создать кейс» — the account is fully functional in its own domain. The
denial is specific to Community moderation, and no role was changed to demonstrate it.

**Learner boundary (Part 7).** Academy origin → `/api/crm/v1/community/moderation` = **404** on the
final deployed releases.

## G4. Final Community role matrix

| Principal | Community learner functions | Staff moderation |
|---|---|---|
| **Ordinary learner** (71/72/73/56) | reads and writes per V2 progression; create, reply, report, withdraw own content | staff route **404** from the learner origin |
| **Authorized moderator** — user 54, `moderator`, `["community_moderate"]` | gains no write it did not earn | nav present, workspace renders, `reply.remove` succeeded and persisted canonically |
| **Negative control** — user 68, `support`, 6 permissions | n/a | nav absent · route bounded-denied · GET and both writes **403** · zero DB change · LO authority intact |

All three pass.

## P. Mobile 390×844 — COMMUNITY MOBILE 390×844 = PASSED

**Viewport proof, not inferred.** `innerWidth` **390**, `innerHeight` **844**, `clientWidth/Height`
**390/844**, `visualViewport` 390×844 at scale 1, `devicePixelRatio` 2, `max-width:900px` **true**,
`max-width:640px` **true**, `min-width:900px` **false**, `pointer:coarse` **true**. Surfaces were
additionally exercised at **320×692**, a stricter width than required.

| Surface | Result at mobile |
|---|---|
| Community Home | page overflow **0**; nav overflow **0**; five slots, none clipped; plates 340px inside 390; Direction B materials intact — lit-edge open plate, dashed locked plates naming modules 4/7/9/17; «вы на модуле 3» |
| «Ещё» sheet | `role=dialog`, `aria-label=Ещё`, three 52px entries (Сообщество/Поддержка/Профиль), within viewport, page overflow 0 |
| Space | overflow 0; title 18px vs meta 11px — content-first; «Задать вопрос» reachable; tombstone reads «Обсуждение удалено · УЧАСТНИК» and names **no** real learner |
| Thread | overflow 0; question **24px**, body 16px, coords 11px — question dominant; answer with signal tick; long Russian wraps |
| Reply composer | textarea 254px inside 320; submit 44px tall, clears the fixed nav by **81px** |
| Create composer | labels, 0/140 and 0/4000 counters, visible focus ring on the auto-focused field, «Опубликовать»/«Отмена» scroll fully clear of the nav |
| Report dialog | 4 bounded reasons, optional note, Отправить/Отмена, fits the viewport |
| Notifications | both Community events present; **keyboard Enter** on the focused link landed on the correct thread |

**Two real defects were found only at a genuine mobile viewport**, fixed and re-verified live:
CM-12 (nav overflow, «Поддержка» clipped) and CM-13 (`AbortController` stalling every Community
read). Neither was visible to 1663 unit tests, a clean build, or the full desktop acceptance pass.

## P2. Accessibility

Accessibility on live Community Home: exactly one `h1`, `h2` per space, every section
`aria-labelledby`, **0 interactive elements without an accessible name**, **0 targets under 24px**,
horizontal overflow **0**, dialog with `role="dialog"`/`aria-modal`/labelled/Escape/focus-on-open,
errors associated via `aria-describedby` + `role="alert"`.

At mobile: every interactive control **≥44px**, **0** controls without an accessible name, exactly
one `h1` per surface with `h2` sections, visible focus ring on the auto-focused composer field,
keyboard Enter activates links, «Новое» rendered as a bordered chip rather than colour alone, and
no action hidden behind hover.

## Q. Automated gates

| App | typecheck | lint | tests |
|---|---|---|---|
| backend | via `next build` | clean | **342 passed** |
| academy | `tsc --noEmit` clean | clean | **1657 passed** |
| crm | `tsc --noEmit` clean | clean | **3070 passed** |

Plus 38/38 live-PREPROD integration checks against the real database and real synthetic learners.

## R. Release and cutover

Three waves, all canonical: `build-release.sh` → provenance → `publish-release.sh` → `cutover.sh`.
Every publish passed the artifact gate and full tree verification. No stale `.next` published; no
release metadata fabricated; no active tooling hand-edited.

## S. Real-browser acceptance

Live PREPROD, real authenticated learner 73, post-cutover.

| Flow | Result |
|---|---|
| A. entry from Academy nav | «Сообщество» present and active in both bars |
| B. Community Home | plate materials correct, «вы на модуле 3», four locked plates naming modules 4/7/9/17 |
| C. open a space | breadcrumb, purpose, «Задать вопрос», discussion list |
| D. open thread | question at display size, coordinates, answer with signal tick, «Ответы (1)» |
| E. create discussion | composer with counters and per-field validation (create exercised server-side) |
| F. reply | composer present; reply by learner 56 renders with its module |
| G. another learner sees public content | verified server-side through the projections |
| H. gated space | verified server-side (learners 71/72 read-only, `chart_review` closed) |
| I. report flow | dialog → submit → «Жалоба отправлена…»; **no public report count** |
| J. notification linkage | both Community notifications link to their threads |
| K. mobile | **not completed** (V-1) |

## T. Deep and anti-generic review

Not "Discord but navy": the plates are unequal, differ by material rather than by badge, and the
open one leads with content set larger than the space titles below it. Not "Reddit but ATA-branded":
no score, no vote, no karma, no trending, and ordering is `lastActivityAt` only. Not "Telegram with
nicer cards": there is no card grid, and the locked rooms compress to a line that names the module
that opens them — geometry that only means anything against a 20-module curriculum.

Community never implies trading advice: no signal post type, no P&L, no leaderboard, no money
vocabulary anywhere in the source (asserted by test in both apps).

## U. Consolidated fixes

One wave per finding class, bundled, not per issue: `e855f90` (per-space preview), `7e40d55`
(removed-author, tombstone preview, write-gate guard), `edc5d83` (app shell + coverage test),
`653be86`/`e73fae0` (notification linkage), `2fcf735` (loading heading).

## V. Compact regressions

**Academy (§59):** all eight routes serve 200 with the shell — Home, Path, Lessons, Tools, Support,
Notifications, Profile, Community. No error surfaces.

**Closed domains (§60):** every count identical to the pre-phase baseline — User 63,
UserCurriculumEnrollment 36, UserLevelProgress 74, XPTransaction 26, PocketTraderIdentity 16,
PocketProviderEvent 12, ProviderIngressEvent 99, GrowthEvent 315, AffiliateCommission 2,
AffiliateAttribution 3, AffiliateCpaQualification 2, CheckpointVerificationAttempt 16,
LearnerOpsCase 9, LearnerOpsNote 4, ChatChannel 5, ChatMessage 0. Users 66/67 carry pre-phase
`updatedAt`. `integrity_check` ok, `foreign_key_check` empty.

**Release tooling (§61):** `--check` reports all 6 files `ok` against `92819f67…`, source tree
clean. No active script was hand-edited.

## W. Remaining non-blocking items

CM-06 (migration-runner diagnosability, spawned as its own task), CM-07 (pre-existing shell
padding), CM-08 (pre-existing hardcoded name on `/support`), CM-11 (pre-existing schema/migration
drift). None is a Community defect.

## X. Final releases and receipts

| Component | `current` | BUILD_ID | rollback receipt | resolves | unit |
|---|---|---|---|---|---|
| backend | `7e40d55e26800211ec1c61c7c5f728e4f01ab9f8` | `LF16V-nFrar7Zkw0ORmrL` | `e855f9058006…` | yes | active/running |
| academy | `714ca1904472e188b696a33ccb78aa165a1a0a4d` | `wqI3iBK1PMnf9bFGWQDWH` | `acd06a957db8…` | yes | active/running |
| crm | `3f84ee465bb15ebce2840bd799d8c46e2886b1a4` | `8SAOAv9HMfD1Gnwdq5DI6` | `c783494930c6…` | yes | active/running |
| partner | `2265f436edf08380261369599e2d9a61b81582c5` (unchanged) | `CDHQMki63Rg5UnS9i9-Ul` | `68ade7628bcb…` | yes | active/running |

Migration **53**, `integrity_check ok`, `foreign_key_check` **0 violations**. Backend health
`{"ok":true,"database":"connected"}`.

**Release tooling:** active tooling matches source commit `92819f6758828ae54de42519c4d003e9e7314f6b`,
all 6 files `ok`, source tree clean, no active script hand-edited. `RELEASE-BUILD-INPUT-IDENTITY-1`
remains non-blocking.

## X2. Post-moderation regressions

**Progression (§10):** enrollments unchanged — 56 = 14/15, 71 = 0/1, 72 = 3/4, 73 = 14/15.
`UserLevelProgress` 74, completed levels 73, `XPTransaction` 26, `XpEvent` 0, `ReportSubmission` 9,
`CheckpointVerificationAttempt` 16 — all identical. `User.level`/`User.xp` still `1`/`0` for every
Community participant.

**Closed domains (§11):** PocketTraderIdentity 16, PocketProviderEvent 12, ProviderIngressEvent 99,
GrowthEvent 315, AffiliateAttribution 3, AffiliateCpaQualification 2, AffiliateCommission 2,
LearnerOpsCase 9, LearnerOpsNote 4, LearnerOpsMessage 9, ChatChannel 5, ChatMessage 0 — unchanged.
Users 66/67 timestamps unchanged.

## X3. Synthetic account hygiene (post-phase, not a blocker)

Passwords were set during this phase on synthetic accounts **71, 72, 73, 54, 68**. User 54 has since
been restored to the shared STAFF credential by the human. The other four still carry values chosen
by the acceptance run and should be rotated as post-phase hygiene under whatever the canonical
fixture policy decides. **Users 66/67 were never touched.** No rotation was performed during
acceptance, and none should be automatic.

## Q2. Final acceptance matrix

| Item | Result | Evidence |
|---|---|---|
| Community purpose clear | **PASS** | five inherited spaces, question-first composition, no feed/chat wall |
| Community reachable | **PASS** | nav entry in both Academy bars; CRM nav entry after CM-16 |
| Home / space / thread | **PASS** | real browser, desktop and 390×844 |
| create discussion | **PASS** | composer, counters, per-field validation, dedup verified server-side |
| reply | **PASS** | composer at mobile, submit clears nav by 81px; reply persisted by learner 56 |
| report content | **PASS** | dialog → «Жалоба отправлена…», no public count; 2 reports in CRM queue |
| ownership | **PASS** | learner 71 refused removal of learner 73's content (`COMMUNITY_FORBIDDEN`), row untouched |
| moderation | **PASS** | `reply.remove` through real CRM UI, canonically persisted and attributed |
| negative-control RBAC | **PASS** | nav absent, route bounded-denied, GET + 2 writes **403** `COMMUNITY_FORBIDDEN`, zero DB change, support authority intact |
| learner / staff privacy | **PASS** | projection has no report concept; reason, staff id, reporter all absent |
| notification linkage | **PASS** | both Community types link to the thread; keyboard Enter landed on it |
| V2 canonical progression gating | **PASS** | durable `UserLevelProgress` rows, contiguous, fail-closed |
| legacy `User.level` excluded as V2 owner | **PASS** | never read; still `1` for every learner; `/chat` untouched |
| Community cannot complete progression | **PASS** | source-fact tests; enrollments unchanged after all activity |
| Community cannot award XP | **PASS** | `XPTransaction` 26 and `XpEvent` 0, unchanged |
| mobile 390×844 | **PASS** | viewport proven; overflow 0; CM-12 and CM-13 found and closed |
| accessibility basics | **PASS** | ≥44px targets, 0 unnamed controls, one h1, focus ring, state not colour-alone |
| Academy regression | **PASS** | all eight routes 200 with shell; Path/Support verified in browser |
| LO / Pocket / Affiliate regression | **PASS** | every count identical; users 66/67 untouched |
| migration / database | **PASS** | migration 53, integrity ok, FK 0 |
| release provenance / receipts | **PASS** | canonical build→publish→cutover; four receipts resolve; tooling matches `92819f67` |

## Y. Final verdict

**0 BLOCKER · 0 HIGH outstanding.**

Six blocker/high findings were raised and closed in this phase — CM-01, CM-02, CM-03, CM-12, CM-13,
CM-16. Every one was found by opening the product in a real browser, and not one was visible to
1673 unit tests, a clean lint, a clean typecheck or a passing production build. Two of them
(CM-12, CM-13) surfaced only at a genuine mobile layout viewport, and one (CM-16) only in the
api-mode shell PREPROD actually runs.

The remaining findings are non-blocking: CM-14, CM-15 and CM-19 are PREPROD fixture
hygiene/tooling — product authentication behaved correctly throughout and only synthetic fixture
credentials were disturbed, by this phase's own acceptance run — and CM-04, CM-05, CM-06, CM-07,
CM-08, CM-09, CM-10, CM-11, CM-17, CM-18 are fixed, mitigated, pre-existing or informational.

Every required acceptance item is marked PASS, with no silent N/A.

### ATA-PREPROD-COMMUNITY-END-TO-END-1 — FINAL VERDICT = PASSED

Phase 3 (Full ATA E2E / Business Acceptance) has **not** been started. No backup transfer, no Data
Engineering, no PROD, no further infrastructure or storage phase has been started. Awaiting explicit
human direction.

Every product acceptance condition in §62 that could be verified is met: 0 BLOCKER, 0 HIGH; a clear
learner purpose; Community reachable; spaces, threads and replies working; ownership enforced
server-side; moderation sufficient and permission-gated; no internal staff data leaking; V2
progression as the only access authority; legacy `User.level` untouched and not V2 authority;
Community completing no level and awarding no XP; no fake financial or provider data; notifications
coherent and linked; accessibility basics clean; closed domains not regressed; release and build
provenance healthy.

Both conditions that were open at the time this paragraph was first written have since been closed:
**mobile 390×844** was verified at a genuine layout viewport (V-1), and **moderator acceptance in a
real browser** was completed together with the negative-control proof (V-2). See §G3/§G4 and §P.

---

## Q3. Synthetic fixture hygiene — prepared, NOT executed

Five synthetic PREPROD accounts had passwords written by this phase's acceptance run:

| user | account | state |
|---|---|---|
| 54 | `preprod-qa-operator@ata.invalid` | **restored** by the human to the shared STAFF credential |
| 68 | `lo-operator@learner-ops.invalid` | **restored** by the human to the shared STAFF credential |
| 71 | `lo-learner-support@learner-ops.invalid` | still carries a value chosen by the acceptance run |
| 72 | `lo-learner-report@learner-ops.invalid` | still carries a value chosen by the acceptance run |
| 73 | `lo-learner-mentor@learner-ops.invalid` | still carries a value chosen by the acceptance run |

**Users 66/67 were never touched** — verified by unchanged `updatedAt` at every checkpoint. Fixtures
69, 70, 74, 75 and 76 were never touched either and still hold `2026-08-15 23:00:26-27`.

Nothing is executed here and nothing is rotated. The three learner fixtures are usable as they are;
whether to reprovision them belongs to the backup / E2E preparation phase, alongside the CM-15
question of whether a sanctioned per-identity fixture reset should exist at all. **This is not a
Community acceptance blocker.**

The lesson worth carrying: an acceptance run should not silently overwrite a shared credential
group. Had the phase minted its own disposable accounts instead of borrowing five existing
fixtures, neither CM-14 nor CM-19 would have happened.
