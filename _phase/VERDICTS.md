# ACCEPTANCE VERDICTS — ATA-PREPROD-LEARNER-OPERATIONS-CRM-END-TO-END-1

## JOURNEY A — SUPPORT = PASSED (recorded earlier)

## JOURNEY D — EDUCATIONAL ESCALATION = PASSED
Closed together with LO-ESCALATION-RESOLVE-AUTHORITY-1. See FINDINGS.md.

## JOURNEY B — REPORT REVIEW = PASSED
Live PREPROD, real browser, backend `905d8612` / crm `94ebaa69` / migration 52.

Learner 72 (`lo-learner-report@learner-ops.invalid`), canonical report **8**, operational
work item **LO-000007**.

| verdict | evidence |
|---|---|
| JOURNEY_B_REPORT_REVIEW = **PASSED** | full loop driven through the real Academy and CRM |
| REPORT_WORK_ITEM_ANCHORED = **PASSED** | one `report_review` case, `reportSubmissionId` 8, whole life |
| REPORT_AUTHORITY_DUAL_AXIS = **PASSED** | matrix re-run after v4, unchanged |
| REVISION_REQUEST = **PASSED** | `ReportReview` 10, `rejected`, reviewer 69, revision 22 |
| LEARNER_RESUBMISSION = **PASSED** | revision 5 `resubmission`, revisions 1-4 retained |
| CANONICAL_APPROVAL = **PASSED** | `ReportReview` 11, `approved`, revision 25 |
| PROGRESSION_EXACTLY_ONCE = **PASSED** | one completed L3 row, XP 500 once, currentLevel 4 |
| OPERATIONAL_RECONCILIATION = **PASSED** | one case, one resolution event, five coherent transitions |
| INTERNAL_NOTE_ISOLATION = **PASSED** | no note canary from any journey reached the learner |

### The operational timeline, end to end
```
1  created                              (reconcile)
2  new            -> in_progress        reconcile:missing_work_item
3  in_progress    -> waiting_learner    report:revision_requested
4  waiting_learner-> in_progress        report:resubmitted
5  in_progress    -> resolved           report:approved
```
`pausedMs` = 981014 — the revision wait was banked and the resolution clock resumed on
resubmission, so ATA was never charged for time the learner owed.

### Attribution is honest per act
Operational transitions carry userId 69 (the reviewer) where a reviewer decided, and `null`
(system) where the learner's own resubmission drove it. No employee is credited with an act
they did not perform.

### Notifications
The canonical report workflow emits no `Notification` row — it communicates in-product, and
the learner saw the revision state and the approval there. The integration added **zero**
notifications, so "exactly once" holds by construction rather than by deduplication.

### Learner-visible outcome
L3 «Завершён», report `approved`, «Завершено 3 из 100 уровней», next level correctly gated
(«Уровень 4 — Контрольная точка $50 · Проверка недоступна» — the financial checkpoint is
NOT waved through). No stale revision UI, no internal note.

## JOURNEY C — MENTOR REVIEW = PASSED
Live PREPROD, real browser. Learner 73 (`lo-learner-mentor@learner-ops.invalid`), canonical
progress row **74** (L14 «Личный Risk Plan»), operational work item **LO-000009**.

| verdict | evidence |
|---|---|
| JOURNEY_C_MENTOR_REVIEW = **PASSED** | full loop through the real Academy and CRM |
| MENTOR_WORK_ITEM_ANCHORED = **PASSED** | `userLevelProgressId` 74, `reportSubmissionId` null |
| MENTOR_WORK_ITEM_AUTO_CREATED = **PASSED** | created by `requestMentorReview`, no reconciler |
| OPERATIONAL_FEEDBACK_WITHOUT_PROGRESSION = **PASSED** | feedback sent, L14 stayed `pending_review` |
| CANONICAL_MENTOR_APPROVAL = **PASSED** | `approveMentorReview`, XP 250 `mentor_completion` |
| PROGRESSION_EXACTLY_ONCE = **PASSED** | one completed L14 row, one XP row, one resolution |
| DUAL_AXIS_MENTOR_AUTHORITY = **PASSED** | matrix re-run on the integrated runtime |
| INTERNAL_NOTE_ISOLATION = **PASSED** | note canary absent from learner API, DOM, notifications |

### The prerequisite path was walked, not shortcut
L1 attested; L2, L5, L6, L7, L8, L11, L12, L13 each passed 4/4 through the real assessment;
L3 submitted and approved through the canonical report workflow; L9 completed by the
learner's own declaration; L4 and L10 attested. Nothing beyond L13 was pre-completed and
prerequisite ordering held throughout.

### Completion provenance, per level, honest and distinguishable
```
 1 staging_attested_registration     8 assessment_pass
 2 assessment_pass                   9 level_completion
 3 report_approval                  10 staging_attested_checkpoint
 4 staging_attested_checkpoint      11 assessment_pass
 5 assessment_pass                  12 assessment_pass
 6 assessment_pass                  13 assessment_pass
 7 assessment_pass                  14 mentor_completion
```

### The mentor operational timeline
```
1  created                            (requestMentorReview)
2  new         -> in_progress          mentor_review:requested
3  assigned                            claimed by lo-reviewer
4  first_response_recorded             learner-visible mentor feedback
5  note_added                          internal note
6  in_progress -> resolved             mentor_review:approved
```

## §20 FINANCIAL ATTESTATION RECONCILIATION — learner 73

**CURRICULUM TRUTH.** L4 threshold = $50, L10 threshold = $100. Those are curriculum
definitions and are unchanged.

**ACCEPTANCE PROVENANCE.** Both gates were satisfied by sanctioned PREPROD staging
attestation, recorded as `staging_attested_checkpoint`, attributed to
`preprod-qa-operator@ata.invalid`, environment-scoped and idempotent (replay returned
`created: false` on the same attestation id).

**This is NOT a statement that learner 73 held $50 or $100.** Proven absent:

* `PocketTraderIdentity` for user 73 — **0**
* deposit / balance / FTD / RDEP growth events — **0** (the only GrowthEvent types present
  are `curriculum_enrollment`, `level_started`, `level_completed`, `assessment_completed`,
  `report_submitted`, `report_approved`, `academy_activation`)
* no Pocket callback, no balance snapshot, no P&L, no financial provider evidence
* the checkpoint awarded 0 XP and minted no XP transaction

The product itself refused the gate on its own terms before the attestation: the L4 page
offered no action at all, stating «Учитывается только подтверждённый реальный баланс. Demo
не учитывается» and «Проверка условия сейчас недоступна».


## REVIEWER-SESSION ACCEPTANCE BATCH — 2026-08-16
Backend `521cbef`, CRM `d181d33`, migration 52, contract v4/25.

### §1 KNOWLEDGE = PASSED
Opens from real navigation, issues a real request (200), honest empty state — «Статей нет.
Создание доступно роли с правом `learner_ops_admin`» — and says in the product that articles
are not educational authority and do not affect learner progress. Search returns an honest
empty page. WRITE is refused server-side for the reviewer: **403 `LEARNER_OPS_FORBIDDEN`**.
Zero articles exist, so no content can have influenced any progression.

### §2 VOC = PASSED
Built from a REAL accepted case, not invented data. `VOC-CANARY-3308`, category
`response_time`, evidence = **LO-000001** (the accepted complaint). Lifecycle exercised
through the real endpoints: severity `medium -> high`, status `open -> under_review`, owner
assigned to the reviewer. Evidence count is derived from linked cases and stored nowhere
separately, as the UI itself states. Re-linking the same case returned **409
`LEARNER_OPS_DUPLICATE`** — "this case is already linked to this signal".

No business impact, no health score, no forecast, no financial effect anywhere in the model.

**Observation (not a defect):** `vocCreateSchema` carries no idempotency key, so two POSTs
create two signals — which is correct for a staff authoring act where two signals may
legitimately share a theme. A retry during this batch produced one duplicate; it was closed
honestly as `rejected` with a note saying what it was, rather than deleted.

### §3 LEARNER 360 = PASSED (learner 73)
Every value carries its owner, and the owners are the canonical ones:

| field | value | source |
|---|---|---|
| identity | masked `lo***…@learner-ops.invalid` | `platform.identity` |
| enrollment | 34, `ata-v2` v4, active | `curriculum.enrollment` |
| progression | 14 completed / **100 total** / 14 started | `curriculum.progression` |
| current level | `null` — no `in_progress` row exists | `curriculum.progression` |
| reports | submission 9, `approved`, L3 | `curriculum.report` |
| operations | LO-000008, LO-000009, both resolved | `learner_ops.case` |
| notifications | one `support_reply`, TYPE only | `platform.notification` |
| pocket identity | `state: pending`, playerId null, linkedAt null | `pocket.trader_identity` |
| financial | `null`, `financialVisible: false` | — |

A regex sweep for `balance|deposit|ftd|rdep|pnl` over the entire payload returns **nothing**.
The two attested checkpoints do not appear as financial truth anywhere: L4/$50 and L10/$100
remain curriculum thresholds, and the learner's Pocket state honestly reads `pending`.

### §4/§7 ROLE AND DATA-ACCESS = PASSED
Server responses, not hidden UI:

* learner 73 sees only their own two cases;
* another learner's case id -> **404 `LEARNER_OPS_CASE_NOT_FOUND`** (does not confirm existence);
* CRM API from the learner origin -> 404; staff surfaces via the Academy proxy -> 404;
* reviewer -> analytics **403**, QA **403**, knowledge write **403**;
* `limit=100000` -> 400; unknown query param -> 400 (strict query); bogus queue filter -> 400;
* unknown case id -> 404;
* **email masking is not merely display**: the reviewer sees `l***@l***.invalid`
  (`visibility: "masked"`), and searching by the FULL address returns nothing — search cannot
  be used as an oracle to confirm an address the principal may not read.

### §5 PUBLIC / INTERNAL SEPARATION = PASSED (reconciled, not re-run)
The projections are unchanged since Journeys A and C. Fresh evidence from this batch: a canary
sweep across every notification's `title`, `message` and `metadata` for six note and message
canaries returns **0 hits**. Notifications carry a case reference and nothing else.

### §6 TEXT RENDERING = PASSED
The product REFUSES hostile markup at the boundary rather than storing and escaping it —
`safeText` screens tags, inline handlers and the `javascript:`/`data:` schemes. Server-side,
each was refused **400 `LEARNER_OPS_INPUT_INVALID`**: `<script>`, `onerror=`, `javascript:`,
`data:`. Zero rows in `LearnerOpsMessage` or `LearnerOpsNote` contain any of them.

Legitimate difficult text IS accepted and renders as text after reload: quotes, apostrophes,
a bare ampersand, angle brackets in isolation, emoji, an em dash and a newline — all intact,
zero injected nodes, page structure unaffected.

### §8 CASE STATE ACCURACY = PASSED
Projection equalled the server at every state walked: `in_progress` (7 options),
`waiting_learner` (7, clock paused), `resolved` (**exactly `open` and `closed`**), `open`
after reopen (7). Review work items keep the accepted rule: their generic status controls
cannot claim completion while the canonical review is open.

### §9 NOTIFICATIONS = PASSED
Six `support_reply` rows across the whole phase, one per intended learner-visible event, each
carrying only a title and a case reference. No duplicate for any single event; nothing from
the review integration.

### §10 CONCURRENCY / DUPLICATE ACTION = PASSED (remaining cases)
Repeat VOC case link -> 409 `LEARNER_OPS_DUPLICATE`. Stale-version transition -> 409
`LEARNER_OPS_VERSION_CONFLICT`. Resolve-then-reopen produced one coherent state with
`reopenCount: 1` and no duplicate ownership.

### §11 COMPLAINT / SERVICE RECOVERY = PASSED
LO-000004 (`service_recovery`, existing case, reused rather than replaced) walked its full
operational lifecycle: claim -> public reply -> internal note -> priority `normal -> high`
with a reason -> `waiting_learner` (SLA paused, 828 ms banked) -> `resolved` -> reopen
(`reopenCount: 1`). Eight coherent timeline entries. **No refund, credit, balance adjustment
or financial compensation exists anywhere** — the internal note states plainly that money
compensation is out of scope and this is process recovery.

### §12 RECONCILIATION = PASSED
CRM display, backend responses and the database agree on every row checked. No shadow source
was introduced for presentation.
