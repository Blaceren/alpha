# ATA V2 — Phase 4 Completion

## 1. Verdict

Phase 4 is **READY**. The isolated V2 backend now has additive content, assessment,
attempt and lesson-progress storage; immutable draft/publication lifecycles;
pinned content reads; CAS/receipt-based autosave; server-side grading; atomic
completion; and feature-gated HTTP APIs. Phase 5 has not started.

Production rollout remains prohibited. No deploy, flag enablement, production
database operation, Docker/nginx change or live workspace operation is part of
this completion.

## 2. Scope and compatibility boundary

The cumulative audit base is
`6e0c32df66089ab42855d2759c2361e2d6bdfafc` (Phase 3 complete).
Phase 4 is additive and does not drop, rename, repurpose, seed or backfill V1
data. Phase 4B.6 changes no Prisma schema, migration or package lock and adds no
generic completion route, client grading authority, UI or upload workflow.

## 3. Schema and migrations

Exactly two Phase 4 migrations are present:

1. `20260715000000_content_assessment_foundation`
2. `20260715010000_lesson_progress_autosave_idempotency`

They add versioned content, localizations, assets, assessment versions,
questions, question localizations, bindings, assessment attempts, lesson
progress and durable autosave receipt identity. The populated V1 upgrade
regression confirms preserved V1 rows, relations and runtime behavior.

## 4. Content authoring and publication

Content versions are server-numbered draft resources. Localizations and assets
use strict child commands and exact ownership checks. Publication validates the
complete snapshot and uses expected-published compare-and-swap replacement.
Published and archived resources are immutable.

Content and assessment bindings are independent. Clearing either binding
preserves the other side of `LevelResourceBinding`.

## 5. Assessment authoring and publication

Assessment versions, questions and question localizations use separate
transactions. Question type, options and grading answers are canonicalized
server-side. Publication validates completeness and uses the same
expected-published CAS model. Authoring requests may configure grading answers,
but safe admin responses expose only `correctAnswerConfigured`.

## 6. Pinned reads, autosave and receipts

`resolveUserLevelContent` reads only the session user's pinned enrollment,
curriculum version, stable level and exact locale. Archived historical pins
remain readable. The resolver exposes a safe content/progress projection and
performs no write.

Lesson autosave requires:

- the `Idempotency-Key` request header;
- a mandatory `expectedRevision`;
- CAS revision advancement;
- a durable receipt bound to user, enrollment, level, request identity and
  payload.

An exact retry is distinguishable and side-effect free. Reusing a key with a
different payload, submitting a stale revision or losing a concurrent CAS race
fails closed.

## 7. Assessment scoring and atomic completion

Attempts have server-owned numbering, one active attempt per pinned assessment,
server-side integer scoring and immutable terminal state. Submit idempotency is
durable and also comes only from the `Idempotency-Key` header.

A failed attempt can complete while XP is disabled and cannot change level
progress, enrollment or XP. A passing attempt checks the XP gate only on the
passing branch and invokes the Phase 3B.4 completion transaction. Attempt
terminalization, lesson-progress CAS, XP and level/curriculum completion commit
or roll back together.

## 8. Exact HTTP route and method matrix

### Admin content: `ADMIN + CONTENT`

| Method | Route |
| --- | --- |
| GET, POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions` |
| GET, PATCH, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]/publish` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]/archive` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]/localizations` |
| PATCH, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]/localizations/[localizationId]` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]/assets` |
| PATCH, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-versions/[contentVersionId]/assets/[assetId]` |
| PUT, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/content-binding` |

### Admin assessment: `ADMIN + ASSESSMENT`

| Method | Route |
| --- | --- |
| GET, POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions` |
| GET, PATCH, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]/publish` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]/archive` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]/questions` |
| PATCH, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]/questions/[questionId]` |
| POST | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]/questions/[questionId]/localizations` |
| PATCH, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-versions/[assessmentVersionId]/questions/[questionId]/localizations/[localizationId]` |
| PUT, DELETE | `/api/admin/curriculum/versions/[id]/levels/[levelId]/assessment-binding` |

### Session user

| Method | Route | Required flags |
| --- | --- | --- |
| GET | `/api/curriculum/v2/levels/[stableCode]/content?locale=...` | `READ + ENROLLMENT + CONTENT` |
| PATCH | `/api/curriculum/v2/levels/[stableCode]/lesson-progress` | `READ + ENROLLMENT + CONTENT` |
| POST | `/api/curriculum/v2/levels/[stableCode]/assessment/attempts` | `READ + ENROLLMENT + ASSESSMENT` |
| POST | `/api/curriculum/v2/assessment/attempts/[attemptId]/submit` | `READ + ENROLLMENT + ASSESSMENT` |
| GET | `/api/curriculum/v2/assessment/attempts` | `READ + ENROLLMENT + ASSESSMENT` |

## 9. Feature and security matrix

| Surface | Flag gate before auth | Actor/auth | CSRF | Rate limit | Request identity |
| --- | --- | --- | --- | --- | --- |
| Admin content GET | `ADMIN + CONTENT` | active ADMIN session | no | admin actor bucket | n/a |
| Admin content mutation | `ADMIN + CONTENT` | active ADMIN session | yes | same admin actor bucket | command CAS where applicable |
| Admin assessment GET | `ADMIN + ASSESSMENT` | active ADMIN session | no | admin actor bucket | n/a |
| Admin assessment mutation | `ADMIN + ASSESSMENT` | active ADMIN session | yes | same admin actor bucket | command CAS where applicable |
| Self content GET | `READ + ENROLLMENT + CONTENT` | active session user | no | no mutation bucket | n/a |
| Self lesson autosave | `READ + ENROLLMENT + CONTENT` | active session user | yes | shared self-mutation actor bucket | `Idempotency-Key` header |
| Self assessment start | `READ + ENROLLMENT + ASSESSMENT` | active session user | yes | shared self-mutation actor bucket | server concurrency identity |
| Self assessment submit | `READ + ENROLLMENT + ASSESSMENT` | active session user | yes | shared self-mutation actor bucket | `Idempotency-Key` header |
| Self attempt history GET | `READ + ENROLLMENT + ASSESSMENT` | active session user | no | no mutation bucket | authenticated cursor |

All actor IDs come from the authenticated session. Paths, queries and bodies
cannot spoof ownership. All success and error responses are
`Cache-Control: no-store`. Route modules perform no direct Prisma mutation.

## 10. Answer secrecy and attempt history

Raw `correctAnswer` is absent from self responses, errors and audits. Admin GET
and mutation responses return only `correctAnswerConfigured`; safe projections
also omit creator fingerprints, private storage paths and audit metadata.

`resolveOwnAssessmentAttemptHistory` is read-only and aggregate-only. It
returns level identity, assessment version, attempt number/status, totals,
score and timestamps—never submitted answers, question content or grading
answers. Pagination uses an authenticated-encrypted cursor bound to the session
user and pinned enrollment.

## 11. Regression and cumulative gate result

The Phase 4 cumulative gate is flat: every Phase 1–4 leaf suite runs exactly
once, withdrawal runs once, populated upgrade runs once and each HTTP suite
runs once. It does not recursively invoke the Phase 3/2/1 cumulative gates.

Verified result:

- 25/25 unique leaf suites completed with exit code 0;
- 1077/1077 leaf assertions passed;
- Phase 4 real HTTP: 32/32;
- populated V1 upgrade/runtime: 26/26;
- product/test failures: 0.

Recovery record: the initial persistent wrapper had exit code 1 only after all
leaf suites had passed because its own
`/tmp/ata-phase4-flat-final-runner.sh` and
`/tmp/ata-phase4-flat-final.log` matched the unchanged runtime-artifact
scanner. The full log SHA-256 was
`1260c451dcec8b73b84ef433512613d8345a54df53654ed91528106f014823db`.
After evidence capture and explicitly authorized removal of runner, log and
their exit-code file, the exact unchanged listener/runtime-artifact scanner was
re-run without leaf suites and passed. The original wrapper is not represented
as exit 0.

## 12. Final verification

- Prisma format: PASS; schema hash unchanged.
- Prisma validate with a safe non-created `/tmp` database URL: PASS.
- Prisma generate: PASS.
- ESLint: PASS.
- TypeScript `--noEmit`: PASS.
- Production build: PASS.
- `git diff --check`: PASS.
- Original `.next` restored; recorded hash
  `de19a6cce4d519d3f981631c6089c75f1d7753a902f03577ff362eed0375c139`.
- Static route, response-secrecy and security audit: PASS.

## 13. Known limitations and rollout prohibition

- Every V2 curriculum/content/assessment flag defaults to false.
- No content is seeded and no V1 data is backfilled or automatically enrolled.
- No UI, upload/archive delivery or production rollout is included.
- Assessment history intentionally remains aggregate-only.
- Production flags must not be enabled and these migrations must not be
  deployed as part of this phase completion task.
- Phase 5 is not started.

## 14. Completion percentages

- Phase 4: **100%**
- Core backend Phase 1–8: **50%**
- Full roadmap Phase 1–13: **about 31%**

Final verdict: **Phase 4 READY**.
