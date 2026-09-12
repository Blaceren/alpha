# §3/§4/§5 — Learner Operations Capability Audit

Source of truth: deployed baseline `backend 18050be`, `crm 4819518`, `academy 7501411`,
DB migration 50 (`20260815000000_affiliate_platform_v1`), verified against the live
PREPROD runtime and SQLite database, not against the phase prompt.

## §4 — Canonical progression contract, RECOVERED FROM RUNTIME

Verified by query against the live published curriculum version (`CurriculumVersion id=4`,
code `ata-v2`, status `published`; versions 1–3 archived):

| Level type | completionMethod | count |
|---|---|---|
| lesson | assessment_pass | 58 |
| financial_checkpoint | balance_check | 20 |
| lesson | manual | 13 |
| mentor_review | mentor_review | 7 |
| external_event | pocket_postback | 1 |
| report | report_approval | 1 |
| **total** | | **100** |

- **L3 report workflow** — exactly one report level: `L3 v2.l003.pervye-pyat-demo-sdelok`.
- **Mentor-review levels** — exactly seven, at **L14, L29, L44, L59, L74, L84, L94**
  (`lichnyy-risk-plan`, `plan-raboty-vokrug-novostey`, `kartochka-strategii`,
  `audit-sessii`, `psihologicheskiy-audit`, `zaschita-resheniya`, `mentor-review-playbook`).

The prompt's §4 expectation matches runtime exactly. No discrepancy to resolve.

Report lifecycle (`ReportSubmissionStatus` + `ReportRevisionKind` + `ReportReviewDecision`)
and progression mutation both live in the backend and are already exercised in PREPROD
(7 `ReportSubmission`, 9 `ReportReview` rows).

## Capability matrix

### A. Report review operations — **EXISTS (mature). REUSE, DO NOT REBUILD.**

| Axis | Finding |
|---|---|
| Canonical model | `ReportSubmission`, `ReportRevision`, `ReportReview`, `ReportReviewScore`, `ReportAttachment`, `ReportCommandReceipt`, `ReportRubricVersion`/`Criterion`/`ScaleOption`, `ReportRejectionReason` |
| API owner | `curriculum/v2/report-reviews/queue`, `report-submissions/[id]/{claim,renew,release,start-review,reassign,approve,reject}` |
| Mutation owner | `src/lib/curriculum/report-review.ts` (1510 lines) |
| Progression authority | `completeCurriculumLevelInTransaction` — called inside approve, same transaction |
| Assignment/concurrency | **Already solved**: 60-min claim lease (`CLAIM_LEASE_MS`), `expectedWorkflowVersion` + `expectedClaimVersion` + `expectedSubmittedRevision` CAS, `requestId` idempotency via `ReportCommandReceipt`, 3-attempt transaction retry |
| Reassignment | `reassign` with closed reason codes: `reviewer_unavailable`, `claim_stale`, `workload_rebalance`, `operational_override` |
| Staff permission | `UserRole` axis — `admin` \| `mentor` (`requireTaskReportReviewer`) |
| Notification owner | `NotificationType.task_report_approved` / `task_report_rejected` |
| Audit owner | `CURRICULUM_AUDIT_ACTIONS` → `AuditLog` |
| CRM UI | `/report-review` → `ReportReviewWorkspace`, real, api-mode-mounted |
| Verdict | **REUSE.** Learner Operations wraps it operationally and must never write a second review truth. |

**Gap:** no SLA/priority/first-response clock, no operational case linkage, no escalation.

### B. Mentor review operations — **PARTIAL. EXTEND (carefully).**

| Axis | Finding |
|---|---|
| Canonical model | `UserLevelProgress` with `status = pending_review` on a `mentor_review:mentor_review` level |
| API owner | `curriculum/v2/mentor-reviews/queue` (read-only), `mentor-reviews/[progressId]/approve` |
| Mutation owner | `src/lib/curriculum/mentor-review.ts` |
| Progression authority | approve → canonical completion primitive |
| Staff permission | `gateMentorReviewReviewer` → `requireTaskReportReviewer`, same `admin`\|`mentor` |
| CRM UI | `/mentor` → `MentorReviewWorkspace`, real |
| Verdict | **EXTEND** operationally, do not fork |

**Gaps (documented in-source as deliberate):**
1. **No claim / lease / assignment.** The queue "writes nothing, claims nothing, assigns nothing" — two reviewers can work the same item with no ownership signal. §9/§25 require this.
2. **No reject / revision-requested path.** Approval is the only exit from `pending_review`.
3. **No feedback field.** "The body is empty by contract" — a mentor cannot persist written feedback, which §13 requires.

Items 2 and 3 touch **Academy assessment semantics** (rubric/decision vocabulary) and are
flagged for the business contract as a possible product-authority decision.

### C. Learner support — **PARTIAL. Backend EXISTS, staff UI ABSENT, learner UI ABSENT.**

| Axis | Finding |
|---|---|
| Canonical model | `SupportDialog` (status `new`/`in_progress`/`waiting_user`/`closed`, `assignedToId`, `lastMessage`, `lastMessageAt`) + `SupportMessage` (**`internalNote Boolean`**, `senderRole`, `fileAssetId`) |
| API owner | staff: `/api/support/dialogs`, `/dialogs/[id]`, `/dialogs/[id]/messages`; learner: `/api/support/my-dialog`, `/my-dialog/messages` |
| Internal-note separation | **Already exists and is enforced** — `my-dialog` filters `!message.internalNote` |
| Staff permission | `requireSupportAccess()` — `UserRole` axis |
| Notification owner | `NotificationType.support_reply` |
| CRM UI | `/support` is a **`SectionPlaceholder`** — no api-mode workspace. **ABSENT.** |
| Academy UI | **ABSENT.** Academy has only `lessons`, `path`, `tools`, `login`, `register`. No support surface, and no same-origin proxy route for support. |
| Live data | **0 `SupportDialog`, 0 `SupportMessage`** — never used in PREPROD |
| Verdict | **REUSE the model + API; BUILD both UIs and the Academy proxy.** |

**Gap:** `SupportDialog.assignedToId` references **`User`**, not `StaffProfile` — the wrong
staff axis (see finding LO-AUTH-AXIS-1). No priority, no SLA, no taxonomy, no escalation,
no reopen, no case linkage.

### D. Staff identity & permissions — **EXISTS, but TWO PARALLEL AXES. Central risk.**

| Axis | Vocabulary | Governs | Used by |
|---|---|---|---|
| `User.role` (`UserRole`) | user, admin, support, mentor, moderator, news_editor | **report review, mentor review, level completion, support API** | backend legacy + curriculum v2 |
| `StaffProfile.staffRole` (`StaffRole`) | crm_admin, crm_manager, retention_manager, mentor, support, moderator, analyst, content_manager, read_only | CRM v1 (users, notes, owner, growth, affiliates) | `crm/v1/*` |

Permission vocabulary is governed by `CRM_SESSION_PERMISSION_CONTRACT` (15 permissions,
version 2, digest `024a135c…`) — a **byte-identical file in both repos** with a digest,
parity type-assertions and a verification script. Adding a permission is a documented
6-step process.

Grants (`STAFF_ROLE_PERMISSIONS`): `mentor: []`, `moderator: []`, `analyst:
[view_affiliate_analytics]`, `support: [edit/view/create_user_notes]`.

**Live cross-axis reality (queried):**

| StaffProfile.staffRole | User.role | n | Consequence |
|---|---|---|---|
| crm_admin | admin | 3 | consistent |
| **crm_admin** | **user** | **2** | full CRM admin, **cannot** review reports |
| mentor | mentor | 3 | consistent |
| **moderator** | **admin** | **1** | CRM role grants **zero** permissions, yet holds **report-review + level-completion authority** |
| support | support | 2 | consistent |
| content_manager | user | 1 | consistent |
| read_only | user | 1 | consistent |

→ Recorded as **LO-AUTH-AXIS-1 (HIGH)**.

### E. Learner ownership / assignment — **EXISTS. REUSE as the assignment precedent.**

`CrmUserOwner` (versioned singleton, optimistic concurrency, null-owner ≠ no-row) +
`CrmUserOwnerHistory` (immutable, derived transition type, DB CHECK constraint,
`(userId, ownerVersion)` unique as concurrency backstop, written in the same transaction).
Gated by `assign_owner`; history read gated by `view_audit`.

**This is the house pattern for operational assignment + history. Learner Operations
assignment should follow it rather than invent a new one.**

### F. Internal notes — **EXISTS.** `CrmUserNote`, append-only, immutable, `Restrict` FKs,
authored by `StaffProfile`. Gated by `view_user_notes` / `create_user_notes`.

### G. Notifications — **EXISTS.** `Notification` + `NotificationSettings` + `NotificationType`
(17 members, already includes `support_reply`, `mentor_reply`, `task_report_approved`,
`task_report_rejected`, `level_up`, `system`). **Do not build a second notifier.**

### H. Audit — **EXISTS.** `AuditLog` (989 live rows), generic `action`/`entityType`/`entityId`/
`metadata`. Documented as "the single audit surface" that "must not become chatty".

### I. VOC / bug capture — **PARTIAL.** `TesterFeedback` (type, severity, status, resolvedBy,
adminComment; 0 live rows). No case linkage, no frequency/theme aggregation. Admin API at
`/api/admin/feedback`. **EXTEND or supersede** — decide in domain architecture.

### J. **ABSENT** capabilities (no canonical owner anywhere)

| Capability | Status |
|---|---|
| Operational case / work item | **ABSENT** — `/cases` is a `SectionPlaceholder`; `src/domain/cases` is mock-only |
| Unified inbox / work queue | **ABSENT** |
| SLA policy, clock, breach, pause | **ABSENT** (grep for `\bsla\b` across `src/lib` + schema: 1 incidental hit) |
| Priority | **ABSENT** |
| Escalation | **ABSENT** |
| Complaint / service recovery | **ABSENT** |
| Taxonomy / reason codes (operational) | **ABSENT** (report *rejection* reasons exist, scoped to reports) |
| QA / Mentor QA | **ABSENT** |
| Knowledge base | **ABSENT** (no model, no route, no component) |
| Operational analytics | **ABSENT** |
| Reopen semantics | **ABSENT** |

### K. **MOCK-ONLY — the most consequential finding for CRM UX (§27)**

PREPROD runs `CRM_MODE=api`. In api mode the CRM's real data boundary is
`ApiCrmDataProvider`, which implements **exactly 8 capabilities**:
`listUsers`, `getUserDetail`, `listUserNotes`, `createUserNote`, `getUserOwner`,
`listOwnerCandidates`, `setUserOwner`, `listUserOwnerHistory`.

Everything else on the broad `CrmDataProvider` interface — `getTodayWorkspace`,
`getUser360`, `getUserTimeline`, `getUserTasks`, **`getUserCases`**, `getSegments`,
**`getMentorQueue`**, **`getSupportQueue`**, `getFinancialOperationsSummary`,
`getUserSignals`, `getRecommendedActions`, `getAuditRecords` — is **mock-only** and
throws `UnsupportedApiCapability` in api mode by design.

**Real api-mode CRM surfaces today** (from `AppShell`): `/report-review`, `/mentor`,
`/users`, `/users/[id]`, `/affiliates/*`, `/growth/*`.

**Placeholder in api mode:** `/support`, `/cases`, `/communications`, `/today`, `/tasks`,
`/segments`, `/audit`, `/automations`, `/analytics`, `/financial`, `/settings`.

→ There is a **CRM information architecture already drawn for Learner Operations**
(`/cases`, `/support`, `/communications`) that has never been connected to anything.
Learner Operations V1 should **fill these existing routes**, not invent a parallel IA.

### L. Academy learner surface — **minimal.** Routes: `lessons`, `lessons/[levelCode]`,
`path`, `tools`, `tools/[toolCode]`, `login`, `register`. Talks to backend only through an
**explicit per-route same-origin proxy allowlist** (`src/app/api/backend/**`) — currently
auth, curriculum read, level start/complete, report draft/submit/resubmit/revisions,
mentor-review request, checkpoint verify, exchange referral link. **No support proxy.**

### M. Out of scope / deliberately untouched

- `Agent*` (9 models) — **FUTURE-ONLY**. Prompt forbids Curie/agents this phase.
- `ChatChannel`/`ChatMessage`/moderation, `MentorChatDialog` — Community-adjacent. `MentorChatDialog` is a **separate** legacy surface from mentor *review*; 0 live rows. **DEPRECATED for this phase**, do not extend.
- `TaskReport`/`Task`/`Level` (v1 legacy) — superseded by curriculum v2. **DEPRECATED.**
- `Affiliate*` (24 models) — CLOSED phase, compatibility only.
- `PocketProviderEvent`, `ProviderIngressEvent`, `GrowthEvent`, `CheckpointVerificationAttempt` — canonical external/financial authorities. **READ-ONLY** for Learner Operations.
