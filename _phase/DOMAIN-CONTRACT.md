# Learner Operations V1 — Business Contract & Domain Architecture

## 1. Authority contract (§2) — restated as enforceable rules

| Rule | Enforcement |
|---|---|
| Learner Operations is never a progression authority | No Learner Operations table has a FK write path to `UserLevelProgress`, `UserCurriculumEnrollment`, `XPTransaction` or `CurriculumVersion`. Progression mutations happen only inside `completeCurriculumLevelInTransaction`, reached only through the canonical report/mentor-review owners. |
| `LearnerOpsCase.status = resolved` never completes a level | `resolved` is a status on the operational row only. Regression asserts resolving a `REPORT_REVIEW`/`MENTOR_REVIEW` case leaves `UserLevelProgress` byte-identical. |
| No fabricated external truth | No Learner Operations write path touches `PocketProviderEvent`, `ProviderIngressEvent`, `GrowthEvent`, `PocketTraderIdentity`, `CheckpointVerificationAttempt`, `ExchangeAccount`. Learner 360 reads them; the external boundary is expressed as `waiting_external` + an escalation, never a financial mutation. |
| No fabricated mentor actions | Mentor decisions are written by the canonical owner. Learner Operations records that a decision happened and mirrors it into the case timeline from the canonical row. |
| Historical progression truth is never rewritten | No migration in this phase writes to any progression, financial or affiliate table. Proven by row-count and checksum comparison before/after. |

## 2. Mentor-review feedback — accepted product decision

Per the phase decision: **operational feedback now, canonical revision transition deferred.**

- `UserLevelProgress` keeps exactly two transitions (`in_progress → pending_review → completed`).
- Mentor feedback that is *not* an approval is delivered as **learner-visible communication on the Learner Operations work item**, and the case moves to `waiting_learner`.
- Progression is untouched. Approval remains the only exit from `pending_review`.
- **FUTURE (recorded for the final report):** a canonical `revision_requested` transition for mentor-review levels is an Academy methodology decision, routed to the Academy Experience Completion phase. Not in this phase.

## 3. Why a new work-item entity rather than extending `SupportDialog`

`SupportDialog`/`SupportMessage` are **DEPRECATED (superseded)**, not reused, because every
structural axis is wrong for the target model:

| Requirement | `SupportDialog` today |
|---|---|
| Typed work items (7 types, §6) | no type column at all |
| Assignment on the canonical staff axis | `assignedToId → User`, the wrong axis (LO-AUTH-AXIS-1) |
| Priority (§8) | absent |
| SLA clock (§8) | absent |
| Escalation (§19) | absent |
| Reopen (§7) | `closed` is terminal, no reopen counter |
| Link to a canonical report / mentor-review object (§6) | absent |
| Internal-note leakage resistance (§15) | a **boolean flag on the shared message table** — the exact fragile design §15 forbids |
| Denormalised learner snapshot | `userName`, `userLevel`, `currentStep` are **mutable shadow copies** of canonical facts (§36 forbids) |

It also carries **0 rows** in PREPROD and has **no reachable UI** (the backend app is
loopback-only; nginx routes `preprod.alfatrade.media` to Academy, which has no support
proxy). Extending it would bend the whole domain around a shape that was never used.

**Legacy tables and routes are left in place and untouched** — no destructive migration.
They are inert in PREPROD and recorded as `LO-LEGACY-SUPPORT-1 (OBSERVATION)`.

## 4. Entities

All new tables are prefixed `LearnerOps*`. Ten tables, three of them configuration.

### 4.1 `LearnerOpsCase` — the work item

Answers every §5 question in one row.

| Column | Purpose |
|---|---|
| `id` (cuid), `reference` (`LO-000123`, unique) | identity; `reference` is the operator-facing handle |
| `userId → User` (Restrict) | WHICH learner |
| `type` (`LearnerOpsCaseType`) | WHY it exists — 7 members (§6) |
| `status` (`LearnerOpsCaseStatus`) | lifecycle (§7) |
| `priority` (`LearnerOpsPriority`) | urgent / high / normal / low |
| `queueId → LearnerOpsQueue` | WHO (team) owns it |
| `assignedStaffId → StaffProfile?` (Restrict) | WHO (person) owns it |
| `assignmentVersion` (Int, monotonic) | assignment CAS — `CrmUserOwner` precedent |
| `version` (Int, monotonic) | status-transition CAS |
| `reasonCodeId → LearnerOpsReasonCode?` | structured taxonomy (§16) |
| `subject`, `details` | free text **in addition to** classification (§16) |
| `supportDialogId?`, `reportSubmissionId?`, `userLevelProgressId?` | the three canonical anchors (§6); DB CHECK ties each to its permitted `type` |
| `slaPolicyId → LearnerOpsSlaPolicy?` | which policy applies |
| `firstResponseDueAt?`, `resolutionDueAt?`, `firstRespondedAt?` | SLA targets and the first-response fact |
| `clockPausedAt?`, `pausedMs` (Int) | pause accounting (§8) |
| `openedAt`, `lastActivityAt`, `resolvedAt?`, `closedAt?` | timing |
| `reopenCount` (Int), `reopenedAt?` | reopen is **derived and durable**, not a status that a later transition would erase |

**`assigned` and `reopened` are deliberately not status values.** Assignment is its own axis
(`assignedStaffId`), so "assigned" is unambiguous and cannot disagree with the owner column;
`reopened` is `reopenCount > 0`, which survives the next transition whereas a status would not.

`status` members: `new`, `open`, `in_progress`, `waiting_learner`, `waiting_internal`,
`waiting_external`, `escalated`, `resolved`, `closed`.

### 4.2 `LearnerOpsCaseEvent` — immutable history (§7, §24)

`caseId`, `actorStaffId?` (Restrict; null = system), `eventType`, `previousStatus?`,
`newStatus?`, `previousAssignedStaffId?`, `nextAssignedStaffId?`, `reasonCode?`,
`metadata` (Json), `createdAt`. Written in the **same transaction** as the mutation it
records — `CrmUserOwnerHistory` precedent. `(caseId, caseVersion)` unique is the
concurrency backstop.

### 4.3 Communication — two tables, by design (§15)

| Table | Visibility | Author | Exposed to learner API |
|---|---|---|---|
| `LearnerOpsMessage` | **learner-visible, always** | staff (`authorStaffId`) or learner (`authorUserId`) | yes |
| `LearnerOpsNote` | **internal, always** | staff only (`authorStaffId`, Restrict) | **never — no learner query selects this table** |

There is **no `internalNote` boolean anywhere**. A leak would require adding a join to a
table the learner-facing code never imports, rather than flipping one boolean — this is the
structural difficulty §15 demands. Both tables are append-only.

### 4.4 Configuration (§8, §16, §21)

- `LearnerOpsQueue` — `key`, `name`, `description`, `isActive`.
- `LearnerOpsSlaPolicy` — `key`, `priority`, `firstResponseTargetMinutes`,
  `resolutionTargetMinutes?`, `pausesOnWaitingLearner`, `pausesOnWaitingInternal`,
  `pausesOnWaitingExternal`, `isActive`, **`fixtureOrigin`** (`preprod_acceptance_fixture` |
  `product_owner_supplied`). §8: no invented business SLA durations — every seeded row is
  stamped `preprod_acceptance_fixture` and the CRM labels it as such.
- `LearnerOpsReasonCode` — `code`, `category`, `label`, `isActive`.
- `LearnerOpsKnowledgeArticle` — `slug`, `title`, `body`, `status`, `version`,
  `ownerStaffId`, `updatedAt`. Staff-visible only; **never progression authority**.

### 4.5 Escalation, QA, VOC

- `LearnerOpsEscalation` — `caseId`, `escalationClass`, `raisedByStaffId`,
  `targetQueueId?`, `targetStaffId?`, `reason`, `raisedAt`, `resolvedAt?`, `resolution?`,
  `returnedToOwnerAt?`. The case **keeps its owner and its timeline** while escalated (§19).
- `LearnerOpsQaReview` — `caseId`, `reviewerStaffId`, `dimensions` (Json), `result`,
  `feedback`, `coachingRequired`, `createdAt`. **Immutable**; editing historical
  communication is impossible because QA writes only to its own table (§20).
- `LearnerOpsVocSignal` + `LearnerOpsVocSignalCase` (join) — `theme`, `category`,
  `severity`, `status`, `ownerStaffId?`, `resolutionReference?`. Evidence count is
  **derived from the join**, never stored (§22).

`TesterFeedback` is **retained** as the learner-originated bug-capture surface and linked by
reference from VOC signals; it is not superseded and not extended in this phase.

## 5. SLA clock semantics (§8) — explicit

| Case status | First-response clock | Resolution clock |
|---|---|---|
| `new`, `open`, `in_progress`, `escalated` | running | running |
| `waiting_learner` | stopped (first response already given by definition) | paused if `pausesOnWaitingLearner` |
| `waiting_internal` | running — an internal decision is **our** delay | paused if `pausesOnWaitingInternal` |
| `waiting_external` | running | paused if `pausesOnWaitingExternal` |
| `resolved`, `closed` | stopped | stopped |

Pause is accumulated into `pausedMs` on **exit** from a pausing state, so elapsed time is
always `now - openedAt - pausedMs - (clockPausedAt ? now - clockPausedAt : 0)`. Breach is
**derived at read time**, never a stored boolean that could go stale. Reopen restarts the
resolution clock and records a new `resolutionDueAt`; the original first-response fact is
never rewritten.

## 6. Permissions (§10) — 9 new, appended to the canonical contract

Contract goes **v2 → v3**, 15 → 24 entries, new digest, byte-identical in both repos, per
the documented 6-step process in `session-permission-contract.ts`.

`learner_ops_view`, `learner_ops_handle`, `learner_ops_report_review`,
`learner_ops_mentor_review`, `learner_ops_escalate`, `learner_ops_manage_queues`,
`learner_ops_qa`, `learner_ops_analytics`, `learner_ops_admin`.

Grants, each derived from a marker the matrix already carries:

| StaffRole | New grants | Derivation |
|---|---|---|
| `crm_admin` | all 9 | holds `manage_settings`, this matrix's marker for "owns configuration" |
| `crm_manager` | view, handle, escalate, manage_queues, qa, analytics | holds `view_audit`, the marker for broad supervisory scope. **Not** review — it is not a reviewer role. **Not** admin — it lacks `manage_settings`. |
| `retention_manager` | view, handle | learner-facing operational role (`assign_owner` + notes) |
| `mentor` | view, handle, report_review, mentor_review | **its first permissions** — the LO-AUTH-AXIS-1 fix |
| `support` | view, handle, escalate | already holds the note permissions |
| `moderator` | none | community moderation is not learner operations |
| `analyst` | analytics | the designated analytics role |
| `content_manager` | none | authors curriculum, does not run operations |
| `read_only` | view | read-only role receiving a read permission widens nothing |

### 6.1 Review authority — the LO-AUTH-AXIS-1 fix

Review authority today is granted by `User.role ∈ {admin, mentor}` alone — an axis the CRM
permission model can neither display nor control. Live data shows the consequence: a
`moderator` StaffProfile whose `User.role` is `admin` holds **level-completion authority**
while holding **zero** CRM permissions; and two `crm_admin` StaffProfiles whose `User.role`
is `user` cannot review at all.

**Fix:** the canonical report-review and mentor-review gates require **both** axes —
the existing `UserRole` check **and** the corresponding new CRM permission. The new check is
**additional, never alternative** (the `canRevealLeadPii` precedent). It can therefore only
ever *narrow* authority, never widen it.

Effect in PREPROD, to be proven by acceptance: the 3 `mentor` and 3 `crm_admin`+`admin`
principals keep review authority; the `moderator`+`admin` principal loses it, which is the
intent of the fix.
