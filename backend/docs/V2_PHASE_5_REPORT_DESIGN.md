# V2 Phase 5 Report Workflow Architecture and Schema Contract

Status: **design-only contract**. This document defines the target for Phase 5B.
It does not authorize schema, migration, API, runtime, seed, rollout or V1
changes.

## 0. Evidence boundary and source authority

The following workspace evidence was audited:

- `docs/V2_GAP_ANALYSIS.md` and `docs/V2_PRODUCT_DECISIONS.md`;
- Phase 1, 2, 3 and 4 completion documents;
- the current Prisma schema and every migration through Phase 4;
- the V1 `TaskReport`, `Task`, `UserTaskProgress` and `FileAsset` models;
- V1 self submit/read, mentor/admin review, file upload/download, permission,
  validation, audit, notification and progression code;
- the Phase 3 XP ledger, LevelState resolver and transaction-aware completion
  core;
- Phase 4 version publication, exact binding, archived-pin, CAS and durable
  receipt patterns.

The backend/master specification named by the gap analysis
(`TradeQuest_Product_OS_Curriculum_V2_Backend_Spec.md`, v0.9) is **not present
in this workspace**. No other authoritative master/backend specification was
found. Consequently, this document distinguishes:

- **confirmed** behavior: directly evidenced by the audited repository;
- **normative Phase 5 contract**: necessary safety/integrity rules derived from
  existing accepted V2 contracts and the Phase 5 brief;
- **open decision**: product or operational policy that has no authoritative
  value in the workspace and must be approved before its stated B-stage.

Provisional examples are never publication data, migration seed data or a
claim that a product choice has already been made.

## 1. Scope, non-scope and non-negotiable invariants

Phase 5 owns the versioned workflow for a current V2 level whose
`LevelDefinition.type = report` and whose `completionMethod = report_approval`.
It must support draft, submission, review, rejection, correction,
resubmission, approval, immutable history, rubric evidence, private
attachments and atomic Phase 3 completion.

The following are non-negotiable:

1. An enrollment remains pinned to its exact curriculum version.
2. A submission pins one exact level, assignment version and rubric version.
3. Published or archived resources used by history are immutable.
4. Old revisions and reviews are never overwritten or rebound.
5. Only approval of the exact currently submitted revision may complete the
   report level.
6. XP is the immutable `LevelDefinition.xpReward`; no reviewer or HTTP body may
   provide an amount.
7. Approval, XP, progress, enrollment summary and required audits commit in one
   database transaction or all roll back.
8. Exact retries have no additional review, XP, audit or timestamp effects.
9. V1 `TaskReport` remains valid and unchanged. No destructive migration or
   implicit conversion of V1 data is allowed.
10. All report and attachment data are private by default.

Out of scope: financial checkpoints, entitlement suspension, Pocket changes,
levels 1-100 seed data, UI, production rollout and any automatic trade-profit
judgment.

## 2. Confirmed V1 `TaskReport` data contract

The current V1 row contains:

- identity: `id`, `userId`, `taskId`;
- state: `pending | approved | rejected`, default `pending`;
- content: optional `reportText`, `reportUrl`, legacy `fileName`, and
  `fileAssetId`;
- review: nullable `reviewerId`, `reviewComment`, `reviewedAt`;
- time: `submittedAt`, `createdAt`, `updatedAt`.

It has a single-row constraint `UNIQUE(userId, taskId)`, indexes on
`(status, submittedAt)`, `taskId`, and `reviewerId`, and V1 relations with
`User`, `Task`, reviewer `User`, and optional `FileAsset`. User/task deletion is
`CASCADE`; reviewer and file deletion are `SET NULL`.

The V1 route `/api/tasks/[id]/report` actually interprets `[id]` as
`Task.stepNumber`, then resolves the Task primary key. It does not bind to a
V2 enrollment, curriculum version, `LevelDefinition`, assignment or rubric.

## 3. Confirmed V1 self submit/read call chain

The exact submit chain is:

```text
POST /api/tasks/[stepNumber]/report
 -> CSRF check
 -> authenticated, non-blocked session
 -> role must be user
 -> in-memory actor bucket: 10 / 10 minutes
 -> strict JSON validation
    (at least one of text, URL, owned task-report FileAsset)
 -> Task lookup by stepNumber and requiresReport check
 -> existing TaskReport lookup by (userId, taskId)
 -> pending and approved rows rejected
 -> optional FileAsset owner + purpose=task_report validation
 -> create row, or overwrite the same rejected row back to pending
 -> best-effort TASK_REPORT_SUBMITTED audit
 -> response
```

`reportText` is limited to 5,000 characters, `reportUrl` to a valid URL of at
most 2,048 characters, and `fileName` to 255 characters. An exact retry is not
idempotent: after the first success it sees `pending` and returns an error.
Resubmission overwrites the rejected row, clears reviewer/comment/reviewedAt,
and destroys the prior submitted content as workflow history.

The self GET returns the Task, the user's single report, selected reviewer
identity, and selected file metadata. It does not select `storagePath`.
Submission creates an audit but no mentor/reviewer notification. The V1 report
JSON routes do not set an explicit `no-store` header.

## 4. Confirmed V1 reviewer and progression call chain

The reviewer chain is:

```text
GET admin task-report queue/detail
 -> authenticated, non-blocked session
 -> role admin or mentor
 -> filter/page/read TaskReport

PATCH /api/admin/task-reports/[reportId]
 -> CSRF check
 -> authenticated admin or mentor
 -> in-memory actor bucket: 30 / 10 minutes
 -> strict body: approved|rejected + optional comment
 -> read current row; reject a row already approved/rejected
 -> update TaskReport decision, reviewer and reviewedAt
 -> best-effort TASK_REPORT_APPROVED/REJECTED audit
 -> if approved, run a separate completeProgressionTask transaction
    -> V1 UserTaskProgress active -> completed
    -> unlock next V1 Task
    -> create V1 XpEvent and update User.xp
    -> optionally grant V1 reward and update visible V1 level/currentTask
 -> best-effort in-app approval/rejection and reward notifications
 -> response
```

The reviewer is the session actor. V1 allows only `admin` and `mentor`; it
excludes `user`, `support`, `moderator` and `news_editor`. The reporter route
allows only role `user`, so the normal V1 role model indirectly prevents
self-review, but the review mutation itself has no explicit
`reviewer.id != report.userId` check.

`completeProgressionTask` may also return `not_found` or `not_active` without
throwing; the review route does not turn those outcomes into a failed approval.
Thus V1 can acknowledge and notify an approved report while V1 progression was
not completed, even without a database exception.

## 5. Confirmed V1 attachment, audit and transaction behavior

V1 upload is a separate authenticated CSRF-protected route with a 20/10-minute
in-memory actor bucket. It accepts PNG, JPEG, WebP, PDF, text and CSV up to
10 MiB. The database stores a sanitized original name, opaque-ish stored name,
driver and a private `storagePath`. Report submission verifies owner and
`purpose=task_report`.

Download reads the private path server-side. Access is granted to the owner,
any admin, or any mentor when the asset is referenced by any TaskReport. There
is no report claim or exact-assignment scoping. The HTTP response is
`private, no-store`; observed report/list/detail responses select metadata and
do not expose `FileAsset.storagePath`. Therefore a direct private-path leak is
**not confirmed**. A future regression must preserve that fact. The legacy
client-supplied `TaskReport.fileName` is not a storage authority and must never
be treated as a path.

V1 report persistence, audit, completion and notifications are not one
transaction. The audit helper catches and logs its own failure; notification
creation is also best-effort. The report decision commits before the distinct
progression transaction.

## 6. Confirmed V1 gaps versus unconfirmed hypotheses

Confirmed from code/schema:

- one mutable row is both current value and only history;
- no draft state, immutable revision, assignment version or rubric;
- no request receipt, payload fingerprint, CAS revision or exact retry;
- rejected resubmission overwrites content and review fields;
- rejection comment is optional; there is no reason-code allowlist or required
  corrective action;
- no reviewer claim, stale-claim, reassignment or SLA contract;
- review uses read-then-update without a status predicate, so competing
  approve/reject operations can both pass the initial check;
- approval can commit before progression/XP; a later progression failure can
  leave an approved report without matching completion;
- report approval is tied to V1 Task progression, not the Phase 3 V2 ledger;
- no durable notification outbox;
- the rate limiter is process-local and not a distributed concurrency control.

Not confirmed and therefore not asserted:

- that private `storagePath` currently appears in a report HTTP response;
- that object storage, antivirus scanning, signed URLs, retention duration,
  business-hours SLA or reviewer assignment policy have been selected;
- that a specific rubric scale, weight, pass threshold or final reason-code
  catalog has product approval;
- that V1 reports should be migrated to V2.

## 7. Separation of report, reviewer role and mentor-review level

These are separate concepts:

| Concept | Meaning | Completion owner |
| --- | --- | --- |
| `LevelDefinition.type=report` | A learner submits a report workflow aggregate | `report_approval` |
| reviewer role `mentor` | An authorized human may review an ordinary report | no completion identity by itself |
| `LevelDefinition.type=mentor_review` | A distinct curriculum level type | `mentor_completion` |

Phase 5 handles only the first row. A mentor approving an ordinary report does
not close a `mentor_review` level. `mentor_completion` remains fail closed until
an independently approved durable evidence adapter is designed.

## 8. Target aggregate and truth ownership

The minimal complete design uses:

- `ReportAssignmentVersion`, localizations and field definitions: immutable
  authored input contract;
- `ReportRubricVersion`, criteria, scale options and rejection reasons:
  immutable review contract;
- `LevelReportBinding`: exact current assignment/rubric selection for one
  level/version;
- `ReportSubmission`: one mutable workflow aggregate per enrollment/level;
- `ReportRevision`: append-only user-content snapshots;
- `ReportReview`: one immutable decision for one submitted revision;
- `ReportReviewScore`: immutable criterion evidence for that review;
- `ReportAttachment`: private metadata pinned to one revision;
- `ReportCommandReceipt`: durable command idempotency, including old retries;
- existing `AuditLog`, `UserLevelProgress`, `XPTransaction` and enrollment
  summary: audit, level and XP authorities.

`ReportSubmission.status` is the sole standing workflow state. Revisions,
reviews, receipts and audits are facts, not competing current-state columns.

## 9. Proposed enums and lifecycle vocabulary

Reuse the accepted Phase 4 `ContentResourceStatus` enum for assignment and
rubric `draft | published | archived` lifecycles. Add:

```prisma
enum ReportSubmissionStatus {
  draft
  pending_review
  approved
  rejected
}

enum ReportRevisionKind {
  draft_autosave
  initial_submission
  resubmission
}

enum ReportReviewDecision {
  approved
  rejected
}

enum ReportFieldType {
  short_text
  long_text
  url
  integer
  boolean
  single_choice
  multi_choice
}

enum ReportAttachmentStatus {
  initiated
  uploaded
  quarantined
  available
  rejected
  deleted
}

enum ReportCommandType {
  save_draft
  submit
  resubmit
  claim
  start_review
  reassign
  approve
  reject
  attachment_initiate
  attachment_finalize
}
```

`submitted` and `resubmitted` are intentionally not standing aggregate states.
They are durable transition facts represented by `ReportRevisionKind`,
`submittedAt` and the transaction audit. The aggregate moves directly to
`pending_review`, avoiding a second state authority and an unobservable
intermediate state.

## 10. Prisma proposal: assignment, presentation and binding

The following is the target field/relationship contract. Relation back-fields
must be added to existing Prisma models during B.1 but do not create database
columns. Names may be mechanically adjusted only if all listed keys and
invariants remain.

```prisma
model ReportAssignmentVersion {
  id                  Int                   @id @default(autoincrement())
  levelDefinitionId   Int
  curriculumVersionId Int
  versionNumber       Int
  status              ContentResourceStatus @default(draft)
  createdById         Int?
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt
  publishedAt         DateTime?
  archivedAt          DateTime?
  changeNotes         String?

  levelDefinition LevelDefinition @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  createdBy       User?           @relation("ReportAssignmentCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)
  localizations   ReportAssignmentLocalization[]
  fields          ReportFieldDefinition[]
  rubrics         ReportRubricVersion[]
  bindings        LevelReportBinding[]
  submissions     ReportSubmission[]

  @@unique([id, levelDefinitionId, curriculumVersionId])
  @@unique([levelDefinitionId, versionNumber])
  @@index([curriculumVersionId, status])
  @@index([createdById])
}

model ReportAssignmentLocalization {
  id                        Int    @id @default(autoincrement())
  reportAssignmentVersionId Int
  locale                    String
  title                     String
  instructions              String
  successCriteriaSummary    String @default("")
  submitLabel               String @default("")
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  assignment ReportAssignmentVersion @relation(fields: [reportAssignmentVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@unique([reportAssignmentVersionId, locale])
}

model ReportFieldDefinition {
  id                        Int             @id @default(autoincrement())
  reportAssignmentVersionId Int
  stableKey                 String
  type                      ReportFieldType
  required                  Boolean         @default(false)
  sortOrder                 Int
  validationRules           Json?
  choiceCodes               Json?
  createdAt                 DateTime        @default(now())
  updatedAt                 DateTime        @updatedAt

  assignment    ReportAssignmentVersion @relation(fields: [reportAssignmentVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  localizations ReportFieldLocalization[]
  @@unique([id, reportAssignmentVersionId])
  @@unique([reportAssignmentVersionId, stableKey])
  @@unique([reportAssignmentVersionId, sortOrder])
}

model ReportFieldLocalization {
  id                      Int    @id @default(autoincrement())
  reportFieldDefinitionId Int
  locale                  String
  label                   String
  helpText                String @default("")
  placeholder             String @default("")
  choiceLabels            Json?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  field ReportFieldDefinition @relation(fields: [reportFieldDefinitionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@unique([reportFieldDefinitionId, locale])
}

model LevelReportBinding {
  id                        Int @id @default(autoincrement())
  levelDefinitionId         Int @unique
  curriculumVersionId       Int
  reportAssignmentVersionId Int
  reportRubricVersionId     Int
  createdById               Int?
  revision                  Int @default(0)
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  levelDefinition LevelDefinition        @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  assignment      ReportAssignmentVersion @relation(fields: [reportAssignmentVersionId, levelDefinitionId, curriculumVersionId], references: [id, levelDefinitionId, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  rubric          ReportRubricVersion     @relation(fields: [reportRubricVersionId, reportAssignmentVersionId], references: [id, reportAssignmentVersionId], onDelete: Restrict, onUpdate: Cascade)
  createdBy       User?                   @relation("LevelReportBindingCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@unique([levelDefinitionId, curriculumVersionId])
  @@index([reportAssignmentVersionId])
  @@index([reportRubricVersionId])
}
```

## 11. Prisma proposal: rubric and rejection catalog

No numeric scale, weighting or pass rule is approved. The safe structural
baseline stores stable scale-option codes and an explicit human decision; it
does not compute approval from profit or silently invent a threshold.

```prisma
model ReportRubricVersion {
  id                        Int @id @default(autoincrement())
  reportAssignmentVersionId Int
  versionNumber             Int
  status                    ContentResourceStatus @default(draft)
  createdById               Int?
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
  publishedAt               DateTime?
  archivedAt                DateTime?
  changeNotes               String?

  assignment       ReportAssignmentVersion @relation(fields: [reportAssignmentVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  createdBy        User? @relation("ReportRubricCreator", fields: [createdById], references: [id], onDelete: SetNull, onUpdate: Cascade)
  criteria         ReportRubricCriterion[]
  scaleOptions     ReportRubricScaleOption[]
  rejectionReasons ReportRejectionReason[]
  bindings         LevelReportBinding[]
  submissions      ReportSubmission[]
  reviews          ReportReview[]

  @@unique([id, reportAssignmentVersionId])
  @@unique([reportAssignmentVersionId, versionNumber])
  @@index([status])
  @@index([createdById])
}

model ReportRubricCriterion {
  id                    Int @id @default(autoincrement())
  reportRubricVersionId Int
  stableKey             String
  categoryCode          String
  sortOrder             Int
  commentRequired       Boolean @default(false)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  rubric        ReportRubricVersion @relation(fields: [reportRubricVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  localizations ReportRubricCriterionLocalization[]
  scores        ReportReviewScore[]
  @@unique([id, reportRubricVersionId])
  @@unique([reportRubricVersionId, stableKey])
  @@unique([reportRubricVersionId, sortOrder])
}

model ReportRubricCriterionLocalization {
  id                      Int @id @default(autoincrement())
  reportRubricCriterionId Int
  locale                  String
  title                   String
  description             String
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  criterion ReportRubricCriterion @relation(fields: [reportRubricCriterionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@unique([reportRubricCriterionId, locale])
}

model ReportRubricScaleOption {
  id                    Int @id @default(autoincrement())
  reportRubricVersionId Int
  stableKey             String
  ordinal               Int
  createdAt             DateTime @default(now())
  rubric        ReportRubricVersion @relation(fields: [reportRubricVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  localizations ReportRubricScaleOptionLocalization[]
  scores        ReportReviewScore[]
  @@unique([id, reportRubricVersionId])
  @@unique([reportRubricVersionId, stableKey])
  @@unique([reportRubricVersionId, ordinal])
}

model ReportRubricScaleOptionLocalization {
  id                          Int @id @default(autoincrement())
  reportRubricScaleOptionId   Int
  locale                      String
  label                       String
  description                 String @default("")
  scaleOption ReportRubricScaleOption @relation(fields: [reportRubricScaleOptionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@unique([reportRubricScaleOptionId, locale])
}

model ReportRejectionReason {
  id                    Int @id @default(autoincrement())
  reportRubricVersionId Int
  stableKey             String
  sortOrder             Int
  active                Boolean @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  rubric        ReportRubricVersion @relation(fields: [reportRubricVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  localizations ReportRejectionReasonLocalization[]
  reviews       ReportReview[]
  @@unique([id, reportRubricVersionId])
  @@unique([reportRubricVersionId, stableKey])
  @@unique([reportRubricVersionId, sortOrder])
}

model ReportRejectionReasonLocalization {
  id                      Int @id @default(autoincrement())
  reportRejectionReasonId Int
  locale                  String
  title                   String
  guidance                String @default("")
  reason ReportRejectionReason @relation(fields: [reportRejectionReasonId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@unique([reportRejectionReasonId, locale])
}
```

The intended criterion categories include understanding, specificity, logic,
risk-plan adherence, ability to explain a decision, and recognition of
mistakes. Those are design requirements, not final criterion keys. Profit or
trade outcome alone is forbidden as a correctness criterion.

## 12. Prisma proposal: submission aggregate and immutable revisions

```prisma
model ReportSubmission {
  id                        Int @id @default(autoincrement())
  userId                    Int
  enrollmentId              Int
  curriculumVersionId       Int
  levelDefinitionId         Int
  userLevelProgressId       Int
  reportAssignmentVersionId Int
  reportRubricVersionId     Int
  status                    ReportSubmissionStatus @default(draft)
  workflowVersion           Int @default(0)

  activeRevisionId          Int?
  submittedRevisionId       Int?
  approvedRevisionId        Int?
  latestReviewId            Int?
  approvedReviewId          Int?

  claimedById               Int?
  claimVersion              Int @default(0)
  claimedAt                 DateTime?
  claimExpiresAt            DateTime?
  reviewStartedAt           DateTime?

  firstSubmittedAt          DateTime?
  submittedAt               DateTime?
  reviewDueAt               DateTime?
  reviewedAt                DateTime?
  approvedAt                DateTime?
  rejectedAt                DateTime?
  slaExceededAt             DateTime?
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  user            User @relation("ReportSubmissionOwner", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enrollment      UserCurriculumEnrollment @relation(fields: [enrollmentId, userId, curriculumVersionId], references: [id, userId, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  levelDefinition LevelDefinition @relation(fields: [levelDefinitionId, curriculumVersionId], references: [id, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  assignment      ReportAssignmentVersion @relation(fields: [reportAssignmentVersionId, levelDefinitionId, curriculumVersionId], references: [id, levelDefinitionId, curriculumVersionId], onDelete: Restrict, onUpdate: Cascade)
  rubric          ReportRubricVersion @relation(fields: [reportRubricVersionId, reportAssignmentVersionId], references: [id, reportAssignmentVersionId], onDelete: Restrict, onUpdate: Cascade)
  claimedBy       User? @relation("ReportSubmissionClaimedBy", fields: [claimedById], references: [id], onDelete: SetNull, onUpdate: Cascade)
  revisions       ReportRevision[]
  reviews         ReportReview[]
  attachments     ReportAttachment[]
  receipts        ReportCommandReceipt[]

  progress UserLevelProgress @relation(fields: [userLevelProgressId, enrollmentId, curriculumVersionId, levelDefinitionId], references: [id, enrollmentId, curriculumVersionId, levelDefinitionId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([enrollmentId, levelDefinitionId])
  @@unique([id, userId])
  @@unique([id, enrollmentId, curriculumVersionId, levelDefinitionId])
  @@unique([id, reportRubricVersionId])
  @@index([status, submittedAt])
  @@index([claimedById, status])
  @@index([reviewDueAt, status])
}

model ReportRevision {
  id             Int @id @default(autoincrement())
  submissionId   Int
  revisionNumber Int
  kind           ReportRevisionKind
  sourceRevisionId Int?
  content        Json
  contentFingerprint String
  createdById    Int
  createdAt      DateTime @default(now())
  submittedAt    DateTime?

  submission ReportSubmission @relation(fields: [submissionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  createdBy  User @relation("ReportRevisionCreator", fields: [createdById], references: [id], onDelete: Restrict, onUpdate: Cascade)
  sourceRevision ReportRevision? @relation("ReportRevisionSource", fields: [sourceRevisionId, submissionId], references: [id, submissionId], onDelete: Restrict, onUpdate: Cascade)
  derivedRevisions ReportRevision[] @relation("ReportRevisionSource")
  attachments ReportAttachment[]
  reviews     ReportReview[]

  @@unique([id, submissionId])
  @@unique([submissionId, revisionNumber])
  @@index([submissionId, createdAt])
}
```

`content` is acceptable only because each revision row is immutable, strictly
validated against the pinned field definitions, bounded, canonically
fingerprinted and retained. A mutable JSON column on `ReportSubmission` is
forbidden as the only history.

The five aggregate pointers require same-submission composite foreign keys in
SQL. Prisma cyclic pointer relations may be named explicitly during B.1, or the
pointer FKs may be authored in migration SQL while the service uses scalar
fields. Omitting same-submission FK enforcement is not acceptable.

## 13. Prisma proposal: review, scores, attachments and receipts

```prisma
model ReportReview {
  id                    Int @id @default(autoincrement())
  submissionId          Int
  revisionId            Int
  reportRubricVersionId Int
  reviewerId            Int?
  reviewerRoleSnapshot  UserRole
  decision              ReportReviewDecision
  humanComment          String?
  correctiveAction      String?
  rejectionReasonId     Int?
  requestId             String
  payloadFingerprint    String
  reviewedAt            DateTime
  createdAt             DateTime @default(now())

  submission ReportSubmission @relation(fields: [submissionId, reportRubricVersionId], references: [id, reportRubricVersionId], onDelete: Restrict, onUpdate: Cascade)
  revision   ReportRevision @relation(fields: [revisionId, submissionId], references: [id, submissionId], onDelete: Restrict, onUpdate: Cascade)
  rubric     ReportRubricVersion @relation(fields: [reportRubricVersionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  reviewer   User? @relation("ReportReviewer", fields: [reviewerId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  reason     ReportRejectionReason? @relation(fields: [rejectionReasonId, reportRubricVersionId], references: [id, reportRubricVersionId], onDelete: Restrict, onUpdate: Cascade)
  scores     ReportReviewScore[]

  @@unique([revisionId])
  @@unique([reviewerId, requestId])
  @@unique([id, submissionId])
  @@unique([id, reportRubricVersionId])
  @@index([submissionId, reviewedAt])
}

model ReportReviewScore {
  id                    Int @id @default(autoincrement())
  reportReviewId        Int
  reportRubricVersionId Int
  rubricCriterionId     Int
  rubricScaleOptionId   Int
  comment               String?
  createdAt             DateTime @default(now())

  review      ReportReview @relation(fields: [reportReviewId, reportRubricVersionId], references: [id, reportRubricVersionId], onDelete: Restrict, onUpdate: Cascade)
  criterion   ReportRubricCriterion @relation(fields: [rubricCriterionId, reportRubricVersionId], references: [id, reportRubricVersionId], onDelete: Restrict, onUpdate: Cascade)
  scaleOption ReportRubricScaleOption @relation(fields: [rubricScaleOptionId, reportRubricVersionId], references: [id, reportRubricVersionId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([reportReviewId, rubricCriterionId])
}

model ReportAttachment {
  id             Int @id @default(autoincrement())
  submissionId   Int
  revisionId     Int
  ownerUserId    Int
  storageKey     String @unique
  originalName   String
  mimeType       String
  sizeBytes      Int
  checksum       String?
  status         ReportAttachmentStatus @default(initiated)
  scanProvider   String?
  scanReference  String?
  scanCompletedAt DateTime?
  createdAt      DateTime @default(now())
  availableAt    DateTime?
  deletedAt      DateTime?

  submission ReportSubmission @relation(fields: [submissionId, ownerUserId], references: [id, userId], onDelete: Restrict, onUpdate: Cascade)
  revision   ReportRevision @relation(fields: [revisionId, submissionId], references: [id, submissionId], onDelete: Restrict, onUpdate: Cascade)
  owner      User @relation("ReportAttachmentOwner", fields: [ownerUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([id, revisionId, submissionId])
  @@index([revisionId, status])
  @@index([ownerUserId, createdAt])
}

model ReportCommandReceipt {
  id                 Int @id @default(autoincrement())
  actorUserId        Int
  submissionId       Int
  commandType        ReportCommandType
  requestId          String
  payloadFingerprint String
  targetRevisionId   Int?
  resultRevisionId   Int?
  resultingWorkflowVersion Int
  safeResult         Json
  appliedAt          DateTime @default(now())

  actor      User @relation("ReportCommandActor", fields: [actorUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  submission ReportSubmission @relation(fields: [submissionId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([actorUserId, requestId])
  @@index([submissionId, appliedAt])
}
```

Historical ownership rows use `RESTRICT`. Human actor references that must
survive account deletion semantically use `SET NULL` plus a non-secret role
snapshot and an atomic audit event. Whether a durable pseudonymous reviewer
reference is legally required is an open retention decision; display name or
email must not be copied by default.

## 14. Required SQL constraints and indexes

Prisma alone cannot express every SQLite invariant. B.1 migration SQL must add
the following without weakening the Prisma relations:

1. Partial unique index: one `published` `ReportAssignmentVersion` per
   `levelDefinitionId`.
2. Partial unique index: one `published` `ReportRubricVersion` per
   `reportAssignmentVersionId`.
3. Composite FKs from active/submitted/approved revision pointers to
   `(ReportRevision.id, ReportRevision.submissionId)`.
4. Composite FKs from latest/approved review pointers to
   `(ReportReview.id, ReportReview.submissionId)`; add the corresponding parent
   unique key.
5. Composite FKs from receipt target/result revision pointers to
   `(ReportRevision.id, ReportRevision.submissionId)` when non-null.
6. Check assignment/rubric timestamps match lifecycle: draft has no
   published/archived time; published has `publishedAt`; archived has both a
   prior publication and `archivedAt >= publishedAt`.
7. Check review decision shape:
   - rejected requires reason, nonblank human comment and nonblank corrective
     action;
   - approved forbids rejection reason and corrective action; a general comment
     is optional unless the published rubric policy explicitly requires it.
8. Check revision kind/time: draft has no `submittedAt`; initial/resubmission
   requires it and a valid same-submission source draft.
9. Check attachment size is positive, names/keys are nonblank, and lifecycle
   timestamps agree with status.
10. Check claim fields are all null or all coherent; expiry is after claim time,
   and review start is not before claim.
11. Check workflow timestamps agree with aggregate state and are monotonic.

SQLite partial indexes are migration-SQL obligations and must be explicitly
regression-tested because Prisma schema syntax will not display them.

## 15. Versioned assignment publication and exact replacement

Assignment and rubric drafts are server-numbered under their owner. Drafts may
be edited or deleted only while unreferenced and only with expected revision
CAS. Publication validates the complete graph in a transaction:

- owner level exists in the same curriculum version, is active, has
  `type=report`, and `completionMethod=report_approval`;
- required assignment and field localizations exist for every explicitly
  requested locale; there is no implicit default-locale fallback;
- stable keys, orders and option keys are unique and bounded;
- validation rules use a versioned allowlist and contain no executable code,
  arbitrary regex, raw HTML, filesystem path or URL-fetch instruction;
- the exact rubric belongs to the exact assignment, has at least one criterion
  and scale option, and every requested localization is complete;
- the reason catalog is explicit and localized before it can be used;
- no current partial-published conflict exists.

Replacement is one transaction with expected current binding revision:
archive old published resources as required, publish the exact new resource
graph, update `LevelReportBinding`, and audit the before/after identities. A
submission created before replacement keeps its pinned assignment/rubric and
may continue reading archived pins. There is no latest-version lookup for an
existing aggregate.

## 16. Structured fields and localization safety

`ReportFieldDefinition.stableKey` is the only stored content key. User revision
JSON is canonical `{ stableKey: typedValue }`; presentation strings never
become keys. Publication and runtime validation must enforce:

- strict object, no unknown or prototype keys;
- all required keys and only defined keys;
- type-specific bounded values;
- URL fields limited to an approved scheme allowlist; no server-side fetch;
- choice values limited to stable codes, with duplicate-free bounded arrays;
- integer range within JavaScript/SQLite safe limits;
- bounded total field count, JSON depth, node count and serialized bytes;
- normalization and canonical SHA-256 fingerprinting before persistence;
- no secret/internal field category and no raw attachment key inside content.

`validationRules` is a small versioned allowlisted JSON grammar. Arbitrary JSON
Schema features, regex and dynamic expressions are excluded until separately
reviewed. Choice labels are locale data; stable choice codes are definition
data. Missing requested localization fails closed rather than falling back.

## 17. Revision, autosave, submit and durable receipt contract

One aggregate exists per `(enrollmentId, levelDefinitionId)`. When REPORT is
enabled, starting a `type=report` level should transactionally create the empty
draft aggregate and pin the current exact binding before any user content. This
prevents a later replacement from changing a started report level. GET remains
read-only. For an already-started progress row that predates REPORT enablement,
the first mutating save may create the pin after full validation; there was no
earlier report-resource pin to preserve and no bulk backfill is allowed.

First-pin/save races recover by rereading the unique winner and validating full
ownership. Every
successful save creates a new immutable `draft_autosave` revision, then CAS
updates `activeRevisionId` and `workflowVersion`. No revision row is updated.

Every mutation requires `Idempotency-Key` and a canonical payload fingerprint.
The transaction first checks `(actorUserId, requestId)`:

- same command, owner, target and fingerprint: return the stored safe result,
  even when newer revisions now exist;
- any mismatch: typed idempotency conflict;
- no receipt: execute CAS, insert revision/review/audit as applicable, update
  aggregate, and insert receipt in the same transaction.

Submit does not mutate the active draft into a submitted row. It copies the
server-read exact active draft into a new immutable `initial_submission`
revision, records `sourceRevisionId`, validates again against the pinned
published/archived assignment, then atomically points both active and submitted
pointers to the new snapshot and moves to `pending_review`.

After rejection, autosave creates new draft revisions while the aggregate
remains `rejected`. Resubmit requires a draft newer than the rejected submitted
revision and creates an immutable `resubmission` snapshot. It never reuses the
old revision or review. Concurrent saves/submits are won by exactly one
`workflowVersion` CAS; losers return a stale conflict and do not leave orphan
rows because the transaction rolls back.

## 18. Normative state machine

`submitted` and `resubmitted` below are durable events/revision kinds; the
standing post-transition state is `pending_review`.

| From | Command/event | Actor | Preconditions and atomic mutation | Idempotency and time | Next |
| --- | --- | --- | --- | --- | --- |
| none | first save | owner | active pinned report level; create aggregate + draft revision | key/fingerprint; server `createdAt` | draft |
| draft | save | owner | expected workflow version; append draft, advance active pointer | receipt; server time | draft |
| draft | submitted | owner | active draft valid; append initial-submission snapshot; set submitted pointer; progress `in_progress -> pending_review` | receipt; set first/submitted/due times; audit | pending_review |
| pending_review | claim | active mentor/admin, not owner | unclaimed/expired or approved override; CAS claim fields | receipt; claim time/expiry; audit | pending_review |
| pending_review | start review | claim owner | exact current claim and submitted revision | receipt; start time; audit | pending_review |
| pending_review | reject | claim owner/admin under approved override policy | immutable review+scores; exact submitted revision; required reason/comment/action; no XP | receipt; reviewed/rejected time; audit | rejected |
| rejected | save correction | owner | append a newer draft; keep old submitted/review pins | receipt; server time | rejected |
| rejected | resubmitted | owner | newer valid draft; append resubmission snapshot; replace submitted pointer; clear live claim | receipt; new submitted/due time; audit | pending_review |
| pending_review | approve | claim owner/admin under approved override policy | immutable review+scores and full atomic completion transaction | receipt; reviewed/approved/completed time; audits | approved |
| approved | any mutation | none | terminal; historical reads only | exact prior receipt may replay | approved |

Recommended but not yet product-approved LevelState behavior is:

- submit/resubmit: `UserLevelProgress -> pending_review`;
- reject: `pending_review -> in_progress`, because no review is pending;
- resubmit: `in_progress -> pending_review`;
- approve: Phase 3 `pending_review -> completed`.

If product instead keeps rejected progress at `pending_review`, the report
aggregate still remains the workflow truth, but user-facing LevelState wording
must distinguish rejected/correction-required. This choice is due before B.3.

Approved is terminal. A review always references the exact submitted revision;
the decision CAS includes both aggregate status and `submittedRevisionId`, so a
review started on an old revision cannot affect a resubmission.

## 19. Rubric and reviewer evidence contract

A published rubric is pinned with the submission. It separates:

- structure/version (`ReportRubricVersion`);
- localized criterion meaning;
- localized scale-option meaning;
- one immutable score per criterion and review;
- criterion-required comments;
- the human approve/reject decision.

Publication must ensure score options and criteria are complete and all keys
are stable. Review must include exactly one score for each active criterion,
no unknown criteria/options, and any required comment. Scores from a different
rubric version are rejected by composite FK and service validation.

Scale semantics, weights and automatic pass policy are open. The safe baseline
is an explicit human decision supported by a complete rubric record; scale
option `ordinal` is presentation order, not an approved numeric weight.
Profitability is never a scoring shortcut.

## 20. Rejection and reason-code contract

Reject is valid only when all three are present:

1. one active allowlisted reason from the pinned rubric version;
2. a nonblank, bounded human-facing comment;
3. a nonblank, concrete corrective action.

The immutable review row and scores are inserted atomically with the aggregate
transition. User responses expose only localized safe reason text, the human
comment and corrective action. Internal notes, secrets, storage keys, raw audit
metadata and reviewer contact details are forbidden.

An exact duplicate reject returns its receipt. Reuse with different content
conflicts. Competing approve/reject commands contend on the same status,
submitted revision and workflow-version CAS; exactly one decision and one
unique review per revision can commit.

No final reason-code catalog is approved. A provisional discovery list may
include incomplete evidence, unclear reasoning, missing risk-plan discussion,
insufficient specificity, and revision required, but these examples must not
enter migration/seed/publication until product approval before B.2/B.4.

## 21. Reviewer permission, queue and claim contract

Confirmed role baseline is active, non-blocked `mentor` or `admin`; `user`,
`support`, `moderator` and `news_editor` cannot review. Every command obtains
actor identity and role from the session. Self-review is denied explicitly even
if roles evolve.

Queue visibility is limited to report submissions in reviewable V2 curriculum
context and exposes only needed owner/profile, level, submission, SLA and safe
attachment metadata. It exposes no XP internals, raw Prisma graph, private
storage key, user secrets or submissions outside the authorized scope.

Claim/start uses aggregate CAS. A normal reviewer may approve/reject only the
exact current submitted revision while owning the current claim. A blocked or
deleted reviewer cannot act. `claimedById` is `SET NULL`; claim loss is detected
as stale and must be reassigned before review. Immutable review plus atomic
AuditLog retains the historical action and role snapshot after account
deletion, subject to the open pseudonymous-identity retention decision.

Claim lease length, stale-claim takeover, active reassignment and admin
override are not approved. Recommended baseline: mentors can take only
unclaimed/expired work; admins can reassign with a mandatory reason and audit;
an admin cannot silently overwrite a fresh claim.

## 22. SLA timestamps and escalation

Persist `submittedAt`, `reviewDueAt`, `reviewStartedAt`, `reviewedAt` and
`slaExceededAt`. `reviewDueAt` is computed once at submit/resubmit from the
approved SLA policy and stored so later policy changes do not rewrite history.
Elapsed state is derivable for reads, but the first exceeded event requires a
durable CAS marker.

If SLA monitoring is enabled, a background job is required to select
`pending_review AND reviewDueAt < now AND slaExceededAt IS NULL`, CAS-set
`slaExceededAt`, write `mentor_sla_exceeded` audit, and optionally enqueue an
approved escalation notification. Retries must not duplicate the event.

Timezone, business hours, pause rules, SLA duration and escalation recipients
are open. An SLA breach never approves, rejects, completes, awards XP or changes
the learner's evidence.

## 23. Private attachment contract

An attachment belongs to exactly one immutable `ReportRevision`; it is never
rebound. A correction or replacement creates a new attachment row on a new
revision. Historical attachments remain readable under retention policy.

Required controls:

- opaque provider `storageKey`, never filesystem path or public URL;
- sanitized original name used only for display/content-disposition;
- server-observed MIME plus allowlist and size limit;
- initiate/finalize lifecycle with checksum/size verification;
- quarantine/scan state; only `available` can be submitted or downloaded;
- owner, authorized current reviewer/admin and exact submission checks on every
  download; ownership mismatch is hidden as not found;
- no directory traversal, provider error, signed token or key in response/log;
- audit metadata limited to attachment id, safe type/size, actor and action;
- delete is a tombstone/provider-cleanup workflow under retention policy, not a
  relational delete of approved history.

Provider, upload transport, signed-URL policy, MIME/size allowlist, antivirus,
scan-failure behavior and retention duration are open. B.5 must remain fail
closed if they are unresolved; Phase 5A creates no upload or storage code.

## 24. Atomic report approval, XP and completion adapter

The Phase 5 report service must call existing
`completeCurriculumLevelInTransaction(tx, ...)`, never the generic wrapper and
never a public generic complete-level endpoint. Within one transaction it must:

1. validate flags, active reviewer/claim, no self-review, current aggregate,
   exact submitted revision, rubric and score completeness;
2. insert the immutable approval review and scores;
3. CAS `ReportSubmission.pending_review -> approved`, pin
   `approvedRevisionId = submittedRevisionId`, and set approved review/time;
4. call Phase 3 with `sourceType=report_approval`, a deterministic source such
   as `report-review:<reviewId>`, and the session reviewer as actor;
5. let Phase 3 CAS `UserLevelProgress.pending_review -> completed`;
6. let Phase 3 append exactly one `XPTransaction` using immutable
   `LevelDefinition.xpReward`;
7. let Phase 3 advance enrollment summary/final state;
8. let Phase 3 write XP and level-completion audits;
9. insert the report-approval audit in the same transaction;
10. insert the command receipt in the same transaction.

Any error rolls back all ten effects. The deterministic source is owned by the
exact durable review; Phase 3 verifies the level/version, source, fingerprint
and prior completed retry. Exact retry is served from the receipt or fully
verified durable state and does not create another review, XP row, audit, or
timestamp touch.

Reject writes no XP, does not complete progress and does not advance enrollment
summary. Notifications are not correctness state. Existing best-effort
post-commit notification behavior may be retained initially, but exactly-once
delivery requires an outbox decision; it must not be simulated by repeating the
approval transaction.

## 25. Cross-version and ownership enforcement matrix

| Invariant | DB enforcement | Service/publication enforcement | Runtime fail-closed proof |
| --- | --- | --- | --- |
| submission user owns enrollment/version | composite FK `(enrollmentId,userId,curriculumVersionId)` | session user only | reload pin and reject mismatch |
| submission level is in pinned version | composite level FK | report type/method validation | compare enrollment/level/version |
| assignment is same level/version | three-column composite FK | publication/binding validation | archived/published exact-pin validation |
| rubric belongs to assignment | composite FK | complete graph publication | compare pinned ids before any command |
| binding cannot cross level/version | composite level+assignment FKs | replacement CAS | read one exact binding, never latest search |
| revision belongs to submission | `(id,submissionId)` and composite pointer FKs | append only | target revision and owner check |
| review is for submitted revision | composite revision FK + unique revision review | decision CAS includes submitted pointer | reject stale revision |
| score criterion/option is same rubric | composite score FKs | complete rubric validation | exact set equality |
| attachment is owner/revision-bound | composite submission owner + revision FK | finalize/submission validation | available + authorized read only |
| XP proof is same level/version | existing Phase 3 composite FKs and source checks | report adapter only | Phase 3 durable verification |
| approved pin is exact | same-submission pointer FK | approval CAS | verify review/revision/source graph |

For the strongest progress link, add this key to the existing V2 model:

```prisma
@@unique([id, enrollmentId, curriculumVersionId, levelDefinitionId])
```

and use it from `ReportSubmission.userLevelProgressId`. This is an additive
unique index only; it does not alter a V1 table or existing column. It is
justified because otherwise the database cannot prove that the pinned progress
row is the submission's enrollment/level. If any modification of existing V2
model metadata is prohibited, the no-ALTER fallback is a simple FK by progress
`id` plus transaction-time four-field validation on every command. That
fallback is weaker and must be explicitly accepted; it cannot be described as
DB-enforced.

## 26. Feature-flag matrix

Add independent dynamic flag:

```text
CURRICULUM_V2_REPORT_ENABLED=false
```

Absent means false. Other flags do not substitute for it.

| Capability | Required flags | Principal |
| --- | --- | --- |
| admin assignment/rubric authoring | ADMIN + REPORT | active admin |
| self current/draft/submit/history | READ + ENROLLMENT + REPORT | active enrolled owner |
| mentor/admin queue, claim, reject | REPORT | active authorized reviewer |
| approve report level | READ + ENROLLMENT + XP + REPORT | active authorized claim owner |
| attachment self operations | READ + ENROLLMENT + REPORT | active owner |
| reviewer attachment read | REPORT | active authorized reviewer/admin |

The HTTP layer checks every required flag before authentication and returns a
uniform 404 when any is off. ADMIN does not bypass REPORT; REPORT does not
bypass READ/ENROLLMENT/XP for approval.

## 27. Future admin HTTP contract

All responses, including errors, are `Cache-Control: no-store`. GET has no CSRF
or idempotency requirement. Every mutation uses CSRF, the shared admin actor
bucket, strict path/query/body, session actor only, and `Idempotency-Key` or
expected-resource CAS as stated.

| Method and route | Purpose | Gate / role | Mutation identity and safe response |
| --- | --- | --- | --- |
| `GET, POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments` | list/create server-numbered draft | ADMIN+REPORT / admin | POST key; return ids/status/version, never raw Prisma |
| `GET, PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]` | exact draft detail/update/delete | ADMIN+REPORT / admin | PATCH/DELETE key + expected revision; draft/unreferenced only |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/localizations` | create assignment localization | ADMIN+REPORT / admin | key + strict locale/body |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/localizations/[localizationId]` | update/delete assignment localization | ADMIN+REPORT / admin | key + expected revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/fields` | create structured field | ADMIN+REPORT / admin | key; allowlisted type/rules |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/fields/[fieldId]` | update/delete structured field | ADMIN+REPORT / admin | key + expected revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/fields/[fieldId]/localizations` | create field localization | ADMIN+REPORT / admin | key + strict locale/body |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/fields/[fieldId]/localizations/[localizationId]` | update/delete field localization | ADMIN+REPORT / admin | key + expected revision |
| `GET, POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics` | list/create rubric draft | ADMIN+REPORT / admin | POST key; safe structure only |
| `GET, PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]` | exact rubric draft | ADMIN+REPORT / admin | key + expected revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/criteria` | create criterion | ADMIN+REPORT / admin | key + expected rubric revision |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/criteria/[criterionId]` | update/delete criterion | ADMIN+REPORT / admin | key + expected rubric revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/criteria/[criterionId]/localizations` | create criterion localization | ADMIN+REPORT / admin | key + strict locale/body |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/criteria/[criterionId]/localizations/[localizationId]` | update/delete criterion localization | ADMIN+REPORT / admin | key + expected rubric revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/scale-options` | create scale option | ADMIN+REPORT / admin | key + expected rubric revision |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/scale-options/[scaleOptionId]` | update/delete scale option | ADMIN+REPORT / admin | key + expected rubric revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/scale-options/[scaleOptionId]/localizations` | create scale localization | ADMIN+REPORT / admin | key + strict locale/body |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/scale-options/[scaleOptionId]/localizations/[localizationId]` | update/delete scale localization | ADMIN+REPORT / admin | key + expected rubric revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/rejection-reasons` | create rejection reason | ADMIN+REPORT / admin | key + expected rubric revision |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/rejection-reasons/[reasonId]` | update/delete rejection reason | ADMIN+REPORT / admin | key + expected rubric revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/rejection-reasons/[reasonId]/localizations` | create reason localization | ADMIN+REPORT / admin | key + strict locale/body |
| `PATCH, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/rejection-reasons/[reasonId]/localizations/[localizationId]` | update/delete reason localization | ADMIN+REPORT / admin | key + expected rubric revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/publish` | publish complete rubric | ADMIN+REPORT / admin | key + expected draft revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/rubrics/[rubricId]/archive` | archive replaced rubric | ADMIN+REPORT / admin | key + expected published revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/publish` | publish complete assignment | ADMIN+REPORT / admin | key + exact published rubric + expected draft revision |
| `POST /api/admin/curriculum/versions/[id]/levels/[levelId]/report-assignments/[assignmentId]/archive` | archive unbound or replaced assignment | ADMIN+REPORT / admin | key + expected published revision |
| `PUT, DELETE /api/admin/curriculum/versions/[id]/levels/[levelId]/report-binding` | exact bind/replace/clear | ADMIN+REPORT / admin | key + expected binding revision |

Every path identity is cross-checked against the parent version and level.
Mismatches are hidden as 404. Published/archived detail omits no necessary
authoring metadata but never exposes command receipts, fingerprints, user data
or internal audit/storage fields.

## 28. Future self and reviewer HTTP contract

Suggested buckets below are logical shared actor buckets; production backing
must be distributed rather than the V1 process-local map.

| Method and route | Gate / principal | CSRF / bucket / key | Safe contract |
| --- | --- | --- | --- |
| `GET /api/curriculum/v2/levels/[stableCode]/report` | READ+ENROLLMENT+REPORT / owner | no CSRF; self read bucket; no key | localized pinned assignment, safe fields, aggregate summary/current revision |
| `PUT /api/curriculum/v2/levels/[stableCode]/report/draft` | READ+ENROLLMENT+REPORT / owner | CSRF; `report:self:{userId}`; key | expected workflow version + strict field values; safe revision summary |
| `POST /api/curriculum/v2/levels/[stableCode]/report/submit` | same | CSRF; same bucket; key | expected workflow/revision; no body actor or XP |
| `POST /api/curriculum/v2/levels/[stableCode]/report/resubmit` | same | CSRF; same bucket; key | rejected aggregate + newer draft only |
| `GET /api/curriculum/v2/levels/[stableCode]/report/revisions` | same | no CSRF; self read bucket | bounded cursor history, no receipt/fingerprint/storage key |
| `GET /api/curriculum/v2/levels/[stableCode]/report/revisions/[revisionId]` | same | no CSRF | exact owned revision and safe review feedback |
| `POST /api/curriculum/v2/levels/[stableCode]/report/attachments/initiate` | same | CSRF; attachment actor bucket; key | future only; safe upload capability, never provider key/path |
| `POST /api/curriculum/v2/levels/[stableCode]/report/attachments/[attachmentId]/finalize` | same | CSRF; attachment actor bucket; key | future only; verified metadata/status |
| `GET /api/curriculum/v2/report-attachments/[attachmentId]` | owner or authorized reviewer/admin | no CSRF; download actor bucket | streamed private bytes, private no-store, hidden ownership |
| `GET /api/curriculum/v2/report-reviews/queue` | REPORT / mentor/admin | no CSRF; reviewer read bucket | strict status/SLA/cursor filters; minimal queue fields |
| `GET /api/curriculum/v2/report-submissions/[submissionId]` | REPORT / mentor/admin | no CSRF; reviewer read bucket | exact safe content/rubric/available attachment metadata |
| `POST /api/curriculum/v2/report-submissions/[submissionId]/claim` | REPORT / mentor/admin | CSRF; `report:review:{actorId}`; key | claim CAS result, no unrelated reviewer data |
| `POST /api/curriculum/v2/report-submissions/[submissionId]/start-review` | REPORT / claim owner | CSRF; same bucket; key | current exact revision and start time |
| `POST /api/curriculum/v2/report-submissions/[submissionId]/approve` | READ+ENROLLMENT+XP+REPORT / claim owner | CSRF; same bucket; key | decision + rubric scores; safe completion summary |
| `POST /api/curriculum/v2/report-submissions/[submissionId]/reject` | REPORT / claim owner | CSRF; same bucket; key | reason key + comment + corrective action + scores |

All query/path/body schemas are strict and bounded. Actor, user, enrollment,
reviewer and XP amount are never accepted from the body. Other-user and
cross-version identities are returned as not found. All routes set `no-store`.

## 29. Typed error taxonomy and HTTP mapping

| HTTP | Typed families | Public behavior |
| --- | --- | --- |
| 400 | `REPORT_INPUT_INVALID`, `REPORT_QUERY_INVALID`, `REPORT_IDEMPOTENCY_KEY_INVALID` | bounded field details only |
| 401 | `REPORT_UNAUTHORIZED` | no identity detail |
| 403 | `REPORT_REVIEWER_FORBIDDEN`, `REPORT_SELF_REVIEW_FORBIDDEN`, `REPORT_CLAIM_NOT_OWNER`, inactive/blocked | no hidden resource detail |
| 404 | `REPORT_DISABLED`, `REPORT_NOT_CONFIGURED`, `REPORT_NOT_FOUND`, `REPORT_ATTACHMENT_UNAVAILABLE`, ownership/version mismatch | same not-found shape where hiding is required |
| 409 | `REPORT_REVISION_STALE`, `REPORT_IDEMPOTENCY_CONFLICT`, `REPORT_REVIEW_CONFLICT`, `REPORT_ALREADY_APPROVED`, `REPORT_RESUBMIT_REQUIRED`, `REPORT_STATE_CORRUPT`, claim race | no raw state graph; retry hint only when safe |
| 422 | `REPORT_ASSIGNMENT_INVALID`, `REPORT_PUBLICATION_INVALID`, `REPORT_RUBRIC_INVALID`, `REPORT_REASON_REQUIRED`, `REPORT_COMMENT_REQUIRED`, `REPORT_CORRECTIVE_ACTION_REQUIRED`, semantic submission invalid | allowlisted issue codes and field keys |
| 429 | `REPORT_RATE_LIMITED` | generic retry response |
| 500 | `REPORT_INTERNAL_ERROR` | correlation id only; no Prisma/provider/path content |

Specific internal errors additionally cover not enrolled, level not started,
wrong level type/method, immutable resource/submission, quarantined attachment,
review not found, rubric-version mismatch and completion failure. Unknown
database/provider errors are never converted into idempotent success.

## 30. Additive migration and rollback plan

Phase 5B migrations must be additive and compatible with the custom migration
runner:

1. Add new report enums/tables, indexes, FKs and CHECKs only.
2. Add the narrow V2 progress composite unique index if the strong option in
   section 25 is accepted. This is not a V1 ALTER and adds no column.
3. Add Prisma-only relation back-fields to existing models as required.
4. Do not alter/drop/rename V1 `Task`, `TaskReport`, `FileAsset`, progression,
   XP or other V1 data.
5. Do not backfill, seed, bind, publish, enroll or migrate V1 reports.
6. Use `RESTRICT` for historical resources/evidence; use `SET NULL` only for
   nullable human creator/reviewer/claim references approved above.
7. Validate an upgrade from a populated V1 database and assert row/schema
   compatibility before any functional stage is accepted.

Recommended decomposition is at least two migrations: B.1 core assignment,
rubric, submission, revision, review and receipt foundation; B.5 attachment
metadata only after storage/scan policy is approved. If B.1 includes attachment
metadata, runtime stays disabled/fail closed until B.5.

Rollback before production use is reverse dependency order: scores and
receipts, reviews/attachments, revisions, submissions, bindings, reason/scale/
criteria/localizations, rubric, fields/localizations, assignment. After real
history exists, destructive rollback is forbidden; disable REPORT and deploy a
forward repair. No rollback touches V1.

## 31. Regression and verification plan

Required test groups:

- schema ownership and all composite FK/CHECK/partial-index constraints;
- populated V1 upgrade with V1 report/upload/progression behavior unchanged;
- assignment/rubric draft, publication, archive, exact replacement and
  archived historical pin;
- localization completeness and safe field-rule parser;
- first-save race, autosave CAS, old receipt retry after newer revisions, and
  key/fingerprint conflicts;
- submit/resubmit state machine, immutable history and stale submitted pointer;
- attachment owner/revision binding, quarantine, traversal/path/key secrecy,
  reviewer authorization and retention tombstone;
- mentor/admin versus user/support/blocked/self-review permission matrix;
- claim, stale claim, reassignment and concurrent-review races;
- complete rubric evidence, reject requirements and reason-version pin;
- competing approve/reject and exact decision retries;
- rollback injection at every approval step proving no partial review, XP,
  progress, enrollment or audit;
- exact Phase 3 `report_approval` source/fingerprint/reward and archived pin;
- no `mentor_completion` from ordinary report approval;
- SLA marker idempotency and no automatic completion;
- HTTP flag-before-auth, CSRF, rate limit, strict input, ownership hiding,
  no-store and response allowlists;
- no cross-leak of Phase 4 answers/content internals into report responses;
- cumulative Phase 1-4 compatibility.

Verification policy for implementation stages:

- each B-stage runs its new regression and directly affected leaf suites;
- Prisma format/validate/generate only when schema changes;
- one flat Phase 5 cumulative gate at completion, with each leaf and populated
  upgrade suite exactly once;
- lint and TypeScript may run in parallel;
- production build once at the end and never parallel with HTTP suites.

## 32. Phase 5B decomposition and rollback boundaries

| Stage | Scope | Forbidden scope | Acceptance / migration / flags | Rollback boundary |
| --- | --- | --- | --- | --- |
| 5B.1 schema foundation | enums, assignment/rubric/submission/revision/review/score/receipt tables and exact constraints | services, routes, seed, attachment runtime | Prisma + populated upgrade + ownership tests; one additive migration; flags still false | drop only empty new tables/indexes in reverse order |
| 5B.2 authoring/publication | admin assignment, fields, localization, rubric, reason catalog, publish/archive/bind CAS | learner/reviewer runtime | lifecycle regressions; no migration unless a design omission is proven; ADMIN+REPORT | disable REPORT; drafts remain data |
| 5B.3 draft/revisions/submit | self resolver, immutable autosave, receipts, submit/resubmit and progress review-state transition | reviewer decision, XP, attachments | idempotency/concurrency/history tests; READ+ENROLLMENT+REPORT | disable REPORT; retain history |
| 5B.4 reviewer workflow | queue/detail, claim/start, rubric evidence, reject and review concurrency | approval XP until adapter accepted; attachment provider | permission/claim/reject/race tests; REPORT | disable review routes; retain reviews |
| 5B.5a atomic approval and completion | approved review/scores, durable `report_approval` evidence, Phase 3 transaction adapter, exact XP/progress/enrollment/submission/receipt/audits | attachment runtime, HTTP, generic completion | approval/idempotency/race/rollback/evidence tests; approval also XP | disable REPORT; retain immutable history |
| 5B.5b private attachment runtime | attachment metadata/runtime only after a separately approved storage/scan contract | unresolved provider fallback, public paths | attachment authorization/quarantine/traversal/retention tests | disable REPORT; retain private metadata/history |
| 5B.6 HTTP/completion gate | exact route matrix, security, docs, flat cumulative gate | UI, rollout, Phase 6 | full upgrade/HTTP/cumulative/lint/TS/build; all flags default false | no destructive rollback; flags off |

The design split is approved: B.5a is atomic approval/completion and B.5b is a
separately authorized private attachment runtime. Attachment commands stay
404/fail closed; open storage/scan/retention decisions are not inferred, and
Phase 5B.5 is not complete until both halves are done.

## 33. Open decisions and deadlines

| Decision | Evidence | Recommended option | Alternatives | Impact | Due before |
| --- | --- | --- | --- | --- | --- |
| assignment/presentation shape | Phase 4 uses version + localization + exact binding | normalized version/localization/field models in this contract | one versioned JSON schema | normalized gives DB identity and locale safety; JSON is smaller but weaker | B.1 |
| field rule grammar | no master spec | small versioned allowlist; no regex/executable rules | broader JSON Schema | validation DoS/injection and compatibility | B.1/B.2 |
| rubric scale/weights/pass | absent | stable localized scale options; explicit human decision; no weights yet | numeric weighted automatic rule | fairness, auditability, migration columns | B.1 for shape; B.4 for policy |
| final criterion definitions | only required capability themes | product-approved localized keys per rubric | global hard-coded enum | pedagogy and historical meaning | B.2 |
| rejection reason catalog | absent | version with rubric; publish only approved codes | global enum/catalog | safe learner feedback and historic meaning | B.2/B.4 |
| reviewer roles | V1 admin+mentor | retain active admin+mentor | dedicated permission/role | least privilege | B.4 |
| self-review | V1 indirectly prevents it | explicit hard prohibition | admin exception | integrity/fraud risk | B.4 |
| claim lease/reassignment/admin override | approved for B.4 | exact 60-minute server-owned lease; expired normal takeover; reasoned admin reassignment | permanent claim/manual-only | implemented by CAS and durable receipts | resolved in B.4 |
| durable reviewer identity after deletion | V1 relations SetNull; audit metadata persists ids | SetNull + role snapshot; decide pseudonymous durable ref under retention policy | copy display identity; Restrict deletion | privacy versus audit evidence | B.1/B.4 |
| SLA duration/business hours/timezone | absent | compute and store due time from approved policy | elapsed calendar duration only | operations and fairness | B.4/SLA job |
| resubmission limit | absent | unlimited in schema, policy-enforced later; always retain history | fixed/versioned limit | learner access and abuse limits | B.3 |
| rejected progress state | existing Phase 3 approval requires pending_review | return to in_progress, resubmit to pending_review | remain pending_review with correction-required presentation | LevelState truth and UX | B.3 |
| attachment MIME/size | V1 has six types/10 MiB, not V2 approval | explicit V2 allowlist and per-file/aggregate bounds | reuse V1 unchanged | malware/cost/data leakage | B.5 |
| storage/upload transport | V1 local plus unimplemented adapters; no V2 decision | opaque provider key with authenticated proxy or short capability | server multipart/local path | path exposure and scalability | B.5 |
| malware scan/quarantine | absent | fail closed until available/approved no-scan policy | accept immediately | malware exposure | B.5 |
| retention/deletion | absent | immutable approved history + policy tombstone/provider cleanup | immediate physical delete | legal/privacy/audit | B.5 |
| practice draft relation | no approved relation | keep separate from report aggregate | import as initial draft via explicit command | cross-domain ownership | future design before any integration |
| mentor-review level | Phase 3 separate owner | remain separate/fail closed | reuse report review | wrong completion/XP authority | before any mentor-review phase |
| notification/outbox | current notifications best-effort | correctness independent; add outbox only if delivery guarantee required | retain best-effort | duplicate/lost delivery | B.5/B.6 |
| seed/backfill | explicitly excluded | none | approved definitions later | unintended activation/data rewrite | after Phase 5, separate authorization |
| V1 report migration | no approved mapping; V1 lacks history/version | none; coexist | explicit audited one-time migration | fabricated pins/history, rollback risk | separate migration phase |

## 34. Implemented Phase 5B.2 definition-authoring contract

Phase 5B.2 adds server-only report-definition authoring behind the independent,
dynamic `CURRICULUM_V2_REPORT_ENABLED` flag, which defaults to `false`. Every
mutation requires an existing active admin and runs the ownership/lifecycle
checks, write and awaited allowlisted audit in one interactive transaction.
Mentors and all other roles cannot author definitions.

The command surface covers draft assignment metadata, explicit localizations,
structured fields and field localizations; draft rubric versions, criteria,
criterion localizations, neutral scale options and their localizations; and the
rubric-owned rejection-reason catalog and localizations. The actual B.1 schema
does not give rejection reasons an independent status/version lifecycle, so
their lifecycle is inherited from the parent rubric. Published and archived
graphs are immutable, and only empty unbound drafts can be deleted.

Field rules use the approved version-1 allowlist only: bounded text lengths,
bounded integer ranges, exact HTTPS URL policy, a boolean version marker, and
stable choice codes with bounded selection counts. Regex, executable rules,
HTML/unsafe URI content, arbitrary JSON Schema and caller-supplied lifecycle or
ownership fields are rejected. Locales are explicit and normalized; there is no
default locale or fallback.

Publication loads the complete graph and returns all validation issues in one
pass. A rubric needs localized criteria, neutral scale options and at least one
localized active rejection reason with a common complete locale. Numeric
weights, pass thresholds, automatic scoring and profit-only approval criteria
remain forbidden. An assignment needs a complete assignment/field locale and
the exact already-published rubric for the same assignment.

Replacement requires the exact expected published ID. It atomically archives
the old version, publishes the new version and, when a binding points at the old
graph, moves that binding using `LevelReportBinding.revision` CAS. First publish
does not create a binding. Standalone bind/unbind commands accept only the exact
published assignment and rubric for the report/report_approval level. A bound
published definition cannot be archived. Partial unique indexes remain the
final race guard, and a constraint-race recovery is accepted only after durable
state verification without a second audit.

Audit metadata is limited to actor and definition IDs, stable codes, locale,
order and version/revision numbers; presentation text, rules JSON, reviewer
content and secrets are excluded. Phase 5B.2 does not implement submissions,
revisions, autosave, reviewer workflow, approval, XP/completion, attachments,
HTTP, seed/backfill, UI or rollout. The Phase 5B.1 schema and migration are
unchanged.

## 35. Implemented Phase 5B.3 self submission contract

Phase 5B.3 adds a server-only, actor-bound learner resolver and three commands:
`resolveOwnReportContext`, `saveOwnReportDraft`, `submitOwnReport`, and
`resubmitOwnReport`. They require the dynamic READ + ENROLLMENT + REPORT matrix;
all three flags retain default `false`. ADMIN, CONTENT, ASSESSMENT and XP cannot
substitute for any member of this matrix. The actor is a trusted parameter
separate from each strict command DTO; target user, enrollment, curriculum,
definition, submission and revision IDs are never caller authority.

Resolution follows the actor's enrollment-pinned curriculum and exact report
level. Before a submission exists it reads the exact current published
assignment/rubric binding. Once an aggregate exists, its assignment and rubric
IDs are permanent pins; their archived versions remain readable after binding
replacement. Locale is an exact required match without fallback. Reads never
create an aggregate or progress row and fail closed on broken definitions,
revision pointers, receipts, ownership or progress/status disagreement.

Draft values are a canonical object keyed by the published field stable keys.
Unknown keys, wrong scalar/choice types, unsafe markup or URI forms, prototype
keys and unbounded structures are rejected. Drafts may omit required fields;
submit and resubmit revalidate the complete active draft. Each successful new
save request creates a new immutable `draft_autosave` revision, including when
the normalized values equal the prior draft. It advances `workflowVersion` and
the active pointer by CAS and writes a same-transaction `save_draft` receipt.
Draft saves do not change progress, enrollment, XP, submitted pointers or
audit. High-frequency `REPORT_DRAFT_SAVED` audit remains deliberately deferred
because Phase 5A did not approve it.

Receipts are checked using `(actorUserId, requestId)`, operation, pinned scope,
canonical payload fingerprint and expected workflow revision. Exact retry
returns the original accepted revision, workflow version and applied time plus
the current safe aggregate snapshot. This remains valid after later revisions
and never rolls pointers back. Reusing a key for another command, scope or
payload is an idempotency conflict. New operations require exact CAS:
`expected < current` is stale, `expected > current` is a gap/conflict, and only
one competing payload can win. Unique/SQLite-busy races retry the complete
transaction a bounded number of times; success is accepted only from durable
receipt/state evidence. Unknown database errors become a sanitized internal
error.

First submit copies the complete active draft into a new immutable
`initial_submission` revision, moves active/submitted pointers and aggregate
status to `pending_review`, CAS-transitions level progress from `in_progress`
to `pending_review`, and writes the receipt plus awaited `REPORT_SUBMITTED`
audit in one transaction. No review row is fabricated. Reject handling belongs
to B.4, but the B.3 correction contract adopts the design recommendation:
reject returns progress to `in_progress`; correction appends drafts while the
aggregate remains `rejected`; resubmit requires a newer draft, exact rejection
proof and no active claim. It creates a `resubmission` revision, returns the
aggregate and progress to `pending_review`, preserves review history, and
writes one receipt plus awaited `REPORT_RESUBMITTED` audit. `reviewDueAt`
remains null because no SLA duration/business-hours policy is approved.

Audit metadata is limited to actor/scope/submission IDs, operation, revision
and workflow version. Report values, localized presentation, fingerprints,
reviewer-private data and secrets are excluded. The runtime never writes XP,
completion, enrollment summary, notification/outbox, attachments, V1
`TaskReport`, reviewer decisions or HTTP/UI state. No schema, migration, seed,
backfill or rollout change is part of B.3.

The dedicated isolated regression covers 34 scenarios: dynamic gates,
read-only exact resolution, strict validation, first and subsequent immutable
save, old receipt retry after newer revisions, idempotency conflict, stale/gap
CAS, a competing-save race, complete submit, duplicate submit, archived pin,
rejected correction, resubmit, audit secrecy, out-of-scope invariants and safe
unknown-error behavior.

## 36. Implemented Phase 5B.4 reviewer and rejection contract

Phase 5B.4 adds a server-only reviewer runtime behind the dynamic READ +
ENROLLMENT + REPORT matrix. All flags retain default `false`; XP is not needed
for queue, claim, readiness or rejection. Only an existing active `admin` or
`mentor` is a reviewer. Actor identity is a trusted service argument and is not
accepted in any command DTO. Self-review is explicitly forbidden for every
role, including admins.

The deterministic bounded queue contains only `pending_review` submissions
that were not authored by the reader. It follows the submission's immutable
curriculum, level, assignment, rubric and submitted-revision pins, including
archived historical pins. Its allowlist projection contains localized
assignment fields, localized rubric criteria/neutral scale and validated
submitted values needed for review. It excludes raw ownership IDs,
fingerprints, audit metadata, XP internals and secrets. Queue reads perform no
writes or timestamp touches.

### 36.1 Approved claim policy

- One `evaluationTime` is created by the server inside each transaction. The
  client cannot provide `evaluationTime`, `claimedAt` or `claimExpiresAt`.
- A new claim stores `claimedAt=evaluationTime` and
  `claimExpiresAt=evaluationTime + 60 minutes`, exactly. A claim is active only
  while `claimExpiresAt > evaluationTime`; equality is expired.
- An active mentor or admin may claim an unclaimed or expired submission, but
  never their own. A fresh claim owned by another reviewer cannot be replaced
  by an ordinary claim.
- Only the owner of an active claim may renew it. Renewal sets expiry to
  `evaluationTime + 60 minutes`, never to the previous expiry plus 60 minutes.
  An expired claim must be claimed again.
- Only the owner of an active claim may release it. Release atomically clears
  `claimedById`, `claimedAt`, `claimExpiresAt` and `reviewStartedAt`; it does not
  change the submitted revision, report status or progress.
- Only an active admin may reassign either an active or expired claim. The
  target must be an active mentor or admin and must not be the submission
  author. The required reason is exactly one of `reviewer_unavailable`,
  `claim_stale`, `workload_rebalance`, or `operational_override`; no arbitrary
  reassignment comment is stored. Reassignment starts a new exact 60-minute
  lease. A fresh claim can be replaced only through this command.

Claim, renew, release and reassignment use both `workflowVersion` and
`claimVersion` CAS plus canonical SHA-256 receipt identity. Exact retry returns
the original durable result without another lease extension, timestamp touch
or audit. Key reuse with another operation or payload conflicts. Competing
claims have one winner. P2002/SQLite-busy recovery repeats the bounded
transaction and accepts success only after the complete durable receipt is
verified; unrelated database failures are never interpreted as idempotent
success or a claim conflict.

Initial claim and admin reassignment write awaited transactional allowlisted
audits. Reassignment audit failure rolls back its new owner and lease. Audit
metadata contains only safe actor/scope/version/target/reason facts and never
report values, localized presentation, reviewer feedback or fingerprints.

### 36.2 Rubric evidence, rejection and approval boundary

Approval-readiness and rejection load the exact immutable submitted revision
and pinned rubric. Evidence must contain every criterion exactly once, use only
the pinned neutral scale options, and supply comments for criteria whose pinned
definition requires them. Unknown, duplicate, missing or cross-rubric evidence
fails closed. Rejection additionally requires one active reason from the exact
pinned versioned catalog, a bounded reviewer comment and a bounded corrective
action.

Reject creates one immutable `ReportReview` and immutable criterion scores,
CAS-transitions the submission `pending_review -> rejected`, clears the claim,
and transitions `UserLevelProgress pending_review -> in_progress` in one
transaction. It preserves the submitted revision and all prior history so the
B.3 correction/resubmit flow remains possible. The `REPORT_REJECTED` audit is
awaited in the same transaction; audit failure rolls back review, scores,
submission, claim, progress and receipt. Exact retry creates none of them
again, including after a later permissible correction draft.

Approval-readiness remains validation-only and performs no writes. At the B.4
boundary, durable approval was deliberately unavailable; the separately
authorized B.5a implementation described below now owns that mutation without
changing the B.4 claim/reject semantics.

The B.4 runtime does not write XP, `XpEvent`, enrollment summaries, V1
`TaskReport`, notifications/outbox, attachments, bindings or revisions. It
adds no HTTP route, schema change, migration, seed, backfill, UI or rollout.
The isolated B.4 regression covers 25 scenarios, including gates/roles,
read-only pagination, archived pins, all lease operations, admin reassignment,
claim races, CAS/idempotency, rubric validation, rejection atomicity, old exact
retry, audit rollback, corruption, audit secrecy and the approval boundary.

## 37. Implemented Phase 5B.5a atomic approval/completion contract

Phase 5B.5a adds only the server-side approval mutation. It requires the
dynamic READ + ENROLLMENT + REPORT + XP matrix; all four flags must be true and
the admin flag cannot substitute. The actor is a trusted service argument and
must be an active admin or mentor who is not the author. Approval requires the
exact `pending_review` aggregate, current submitted revision, workflow and
claim versions, an active unexpired claim owned by the actor, an exact
report/report_approval progress owner, archived-safe immutable
curriculum/assignment/rubric pins, and complete normalized rubric evidence.

One outer transaction fixes one server-owned `evaluationTime` and, without a
nested transaction:

1. creates one immutable approved `ReportReview` and its exact criterion
   scores;
2. uses `report-review:<reviewId>` as the durable `report_approval` source;
3. calls the transaction-aware Phase 3 completion core, deriving positive XP
   only from immutable `LevelDefinition.xpReward`;
4. writes the XP transaction and XP/completion audits, moves progress
   `pending_review -> completed`, advances the enrollment summary, and marks a
   terminal enrollment completed where applicable;
5. CAS-transitions the submission to approved, pins the approved revision and
   review, clears the claim, stores the approval receipt, and writes the
   awaited allowlisted `REPORT_APPROVED` audit.

Any review, score, XP, progress, enrollment, submission, receipt or audit
failure rolls the entire operation back. Durable approved status is never
published before completion succeeds. The completion owner accepts a report
source only when the referenced review is approved, belongs to the same
submission/enrollment/curriculum/level and exact current submitted revision,
matches the assignment/rubric pins, has one valid score per pinned criterion,
and was not authored by its reviewer. Missing, rejected, cross-revision or
otherwise corrupt evidence fails closed. No generic complete-level API was
added.

Canonical receipt identity includes actor, immutable scope, expected
workflow/claim/revision and normalized scores. Exact retry verifies the full
durable review, scores, approved pointers, completion, XP and report audit,
returns `created=false`, and never repeats timestamps or writes. Key reuse with
another payload conflicts. Competing approvals and approve/reject races have
one winner; P2002 recovery is accepted only after durable verification.
Archived pins remain usable without repinning.

The dedicated approval regression passes 18/18 scenarios. The adjacent review
regression passes 25/25, submission passes 34/34, and completion passes 76/76
with the legacy generic report source assertion strengthened to require a
durable approved review. The XP helper was not changed, so the XP ledger suite
was intentionally not rerun. B.5a changes no schema/migration, V1 XP/report,
notification/CRM/outbox, attachment, seed/backfill, HTTP/UI or rollout state.

Phase 5B.5b remains pending separate approval of the private storage, scan,
authorization and retention contract. Existing attachment tables do not
authorize runtime behavior. Phase 5B.5 is therefore only partially complete,
and the official Phase 5 indicator remains 4/6 (66.7%).

## 38. Design readiness verdict

Phase 5A, Phase 5B.1-B.4 and Phase 5B.5a are implemented in the isolated
workspace. Atomic report approval, exact XP and level/enrollment completion are
ready at the server-service layer. The safe rollout state remains all related
flags default `false`. Private attachment runtime B.5b and HTTP/completion gate
B.6 remain unstarted; no Phase 5 completion or rollout readiness is claimed.
