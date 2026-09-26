# Phase F — registration auto-enrollment, the approved XP model, and server-owned tool access

Backend-owned contracts, source-only. **Nothing in this phase is activated.** Every
switch it introduces is OFF by default and OFF in every environment.

---

## A. The approved ATA XP schedule

One source of truth: `src/lib/curriculum/product-xp-policy.ts`.

| completion pair | XP | levels | subtotal |
| --- | --- | --- | --- |
| `lesson : assessment_pass` | 100 | 58 | 5 800 |
| `lesson : manual` | 150 | 13 | 1 950 |
| `mentor_review : mentor_review` | 250 | 7 | 1 750 |
| `report : report_approval` | 500 | 1 | 500 |
| `financial_checkpoint : balance_check` | 0 | 20 | 0 |
| `external_event : pocket_postback` | 0 | 1 | 0 |
| **total** | | **100** | **10 000** |

The policy is keyed on the canonical **completion pair** and nothing else. It does
not read the level number, the module, the rank, the unlock level or any fixture,
so the correlation between "level 45 is a mentor review" and "level 45 pays 250"
is a consequence of the structure rather than an input to the reward.

The level counts are **derived** from `ATA_LEVELS`, not hand-written, so
`ataXpScheduleBuckets()` cannot drift away from the structural source. The one
number stated by hand is `ATA_TOTAL_XP = 10 000`, and the validator checks the
derived total against it.

### Generic engine vs product profile

`LevelDefinition.xpReward` remains a free non-negative integer, and the generic
package validator (`package/validate.ts`) knows nothing about this schedule — a
regression asserts it does not even import the policy. A different curriculum on
this platform may pay whatever it likes. The schedule is enforced only by the ATA
product profile, and only for a package whose code is `ata-v2.canonical-100`.

### Package validation

For the ATA-100 profile, the following are **issues** (always blocking, in a draft
as well as an approved package — a wrong schedule is not editorial incompleteness):

| code | what it catches |
| --- | --- |
| `ATA100_XP_REWARD_MISMATCH` | a level paying anything other than its pair's approved reward |
| `ATA100_XP_REWARD_STATUS_MISMATCH` | a level whose `xpRewardStatus` disagrees with the policy |
| `ATA100_XP_SCHEDULE_BUCKET_MISMATCH` | a pair whose level count or subtotal is wrong |
| `ATA100_XP_TOTAL_MISMATCH` | a package that does not sum to exactly 10 000 |
| `ATA100_XP_SCHEDULE_PAIR_UNPRICED` | a level declaring a pair the schedule does not price |
| `ATA100_XP_POLICY_TOTAL_INVALID` | the policy itself no longer sums to 10 000 over the structure |

A redistribution *within* one pair leaves both the bucket subtotal and the total
untouched — which is precisely why the schedule is also enforced level by level.
`curriculumPhaseFRegression.ts` §2.5 pins that.

### Historical package immutability

`ata-v2-first-slice.approved.json` and `ata-v2-first-slice.rev3.approved.json` are
**byte-unchanged**. They still declare `xpReward: 0` on all four levels and carry
no `xpRewardStatus` at all, and their fingerprints still recompute to the values
they shipped with.

The canonical ATA-100 builder applies the schedule as an **overlay** when it
carries L1–L4 across: the editorial content is copied character for character, and
exactly two fields — `xpReward` and `xpRewardStatus` — are co-produced from the
policy. In the canonical draft, L1 pays 0 (gate), L2 pays 100 (lesson), L3 pays
500 (report), L4 pays 0 (gate).

---

## B. Exactly-once award ownership

There is **one** award mechanism, and Phase F did not add a second.

`completeCurriculumLevel` / `completeCurriculumLevelInTransaction`
(`src/lib/curriculum/completion.ts`) is the only writer of `XPTransaction` on a
completion path. It reads the amount from `context.level.xpReward` — the accepted
`LevelDefinition` of the pinned, imported package — and never from a request.

Every owner routes through it:

| owner | pair | XP |
| --- | --- | --- |
| `level_completion` (manual-completion) | `lesson : manual` | definition |
| `assessment_pass` (assessment runtime) | `lesson : assessment_pass` | definition |
| `mentor_completion` (mentor approval) | `mentor_review : mentor_review` | definition |
| `report_approval` (report approval) | `report : report_approval` | definition |
| `checkpoint_verification` | `financial_checkpoint : balance_check` | none, structurally |
| `pocket_registration_postback` | `external_event : pocket_postback` | none, structurally |

The two gate owners are not members of `CurriculumXpSourceType`, so an XP row for
one does not typecheck, and the `XPTransaction.sourceType` CHECK constraint would
reject it even if it did.

**The browser can never submit a reward.** No route accepts `xpReward`,
`xpAwarded`, `xpDelta`, `targetXp` or `totalXp`; the manual completion body is
`z.strictObject({ requestId })`, the mentor-review request has no body at all, and
the report approval carries rubric scores only.

Exactly-once is enforced at three layers: the progress-row compare-and-set claim,
the `XPTransaction` unique index on `idempotencyKey`, and the unique index on
`(enrollmentId, sourceType, sourceId)`. A retry re-reads the stored award and
verifies it is byte-identical (`verifyCurriculumXpAwardInTransaction`) rather than
writing a second one.

Behaviourally proven in `curriculumPhaseFRegression.ts` §3: manual +150 once
(same requestId → +0, later request → refused), mentor request → 0, pending → 0,
approval → +250 once, re-approval → +0; assessment pass → +100 once, retry → +0,
failed attempt → +0 and no completion; report draft/submit/revision/resubmit → 0,
approval → +500 once, replay → +0; checkpoint → 0; Pocket postback → 0.

---

## C. XP, ranks and progression are separate

XP **does not**: unlock a level, determine the current level, satisfy a
checkpoint, determine financial state, or determine a rank.

* Ranks are curriculum transitions in `RANK_TRANSITIONS`, keyed on
  `unlockLevel`. The vocabulary file contains no XP term at all.
* Tool access is decided by durable level completion (§F below), never by a
  balance.
* `LevelDefinition.requiredXp` is the accepted level-visibility threshold and is
  deliberately *not* part of this rule: it gates presentation of a future level,
  it lives in the level definition rather than in a rule, and it grants no rank
  and no unlock. It is 0 on every ATA level.

A regression scans `src/lib/curriculum` and `src/app/api/curriculum` for any
statement that compares an XP quantity in the same breath as a rank, an unlock or
a tool. Target and result: **zero**.

---

## D. The registration auto-enrollment transaction

**One Backend business operation.** `POST /api/auth/register` already ran a single
transaction; curriculum enrollment joined it.

```
POST /api/auth/register
  ├─ rate limit (per client IP)
  ├─ body validation
  ├─ Turnstile verification            ← fails closed, before any write
  ├─ duplicate-email check
  ├─ referral inviter resolution
  ├─ acquisition attribution resolution (read-only)
  └─ ONE transaction
       ├─ user created
       ├─ legacy task progress / checkpoint / mentor dialog seeded
       ├─ referral relationship + bonus
       ├─ attribution frozen + conversion event
       └─ autoEnrollNewRegistrationInTransaction   ← PHASE F, last
  ├─ verification token, audit, notifications
  └─ 201 + session cookie
```

Enrollment is **last inside the transaction** so it is written against a complete
registration, and so nothing above it changes shape when the flag is off.

There is deliberately **no** Academy-side second POST. Register-then-enroll from
the browser has four ways to end with a learner who exists and is not enrolled —
the tab closes, the network drops, the second call 500s, the user navigates — and
the platform would already have returned 201 and set a session.

`enrollActiveCurriculumForNewUserInTransaction` shares the accepted Phase-A
system-enrollment body: same flags, same history validation, same active-curriculum
resolution and pinning, same audit with `provenance: "system_registration"` and a
NULL acting user. It has **no actor parameter** and **no curriculum parameter**.

Two things the standalone primitive does are deliberately absent from the
in-transaction variant, and the source says why: the P2002 concurrent-enrollment
recovery (it re-reads in a *new* transaction, which is meaningless inside an
aborted one, and is unreachable for a learner created moments ago in this same
transaction), and the Pocket reconciliation (it settles a registration that
happened *before* enrollment; a user created in this transaction has no Pocket
identity).

### Failure semantics

| condition | result |
| --- | --- |
| flag off | no-op; registration behaves exactly as today |
| exactly one active published `ata-v2` | 201, exactly one pinned enrollment |
| no published curriculum | **503 `REGISTRATION_UNAVAILABLE`**, transaction rolls back: no user, no referral row, no attribution, no conversion event, no session |
| two published curricula | impossible (partial unique index); the resolver would answer `duplicate_published_version` and the same rollback applies |
| enrollment helper throws | same rollback, same 503 |
| duplicate email | 400 before the transaction opens; no second enrollment |
| Turnstile refusal | 4xx before any write; no user, no enrollment |
| validation failure | 400 before Turnstile is even asked |
| replayed registration | the unique-index and history checks return the existing enrollment; never a second one |

The refusal is audited as `REGISTRATION_ENROLLMENT_FAILED` with the bounded
domain code and no learner identity — the registration rolled back, so there is
no learner to name.

An enrollment refusal is never retried as an attribution collision: the retry
would hit the same broken configuration, and dropping attribution to "fix" it
would corrupt the acquisition ledger for an unrelated reason.

### Registration security is unchanged

Turnstile ordering, the surface pin, rate limiting, password hashing, the
duplicate-email answer, referral/affiliate attribution and session issuance are
byte-for-byte what they were. `curriculumPhaseFRegistrationE2E.ts` drives the real
route with the real provider path and stubs only the network hop to Cloudflare —
the challenge is not weakened, disabled or bypassed anywhere in source.

---

## E. The activation condition

Auto-enrollment runs when **all three** are `"true"`:

```
CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED
CURRICULUM_V2_ENROLLMENT_ENABLED
CURRICULUM_V2_READ_ENABLED
```

Absent means OFF for each. `NODE_ENV` is not consulted.

**Why a new flag rather than reusing `CURRICULUM_V2_ENROLLMENT_ENABLED`.** They
answer different questions. The existing flag decides whether the platform may
enroll *anyone* — it gates the operator command, which is how a pilot cohort is
enrolled deliberately, one learner at a time. The new one decides whether *every
new signup* becomes an enrollment automatically. Overloading the first would mean
that switching on the safe, reversible operator command silently opted every
future registration into the curriculum.

The new flag is **narrowing only**: it grants nothing on its own, because the
primitive it calls still requires the other two.

**Activation dependency.** `config/flag-policy/curriculum-v2-flag-policy.*.json`
forbids unknown `CURRICULUM_V2_*` keys. Before this flag may appear in any
environment file it must first be declared in those profiles. Phase F does not
touch them, because they describe live control planes.

---

## F. Backend-owned tool access

`src/lib/curriculum/tool-access.ts`. This closes the Phase-E M-2 gap: Backend now
transmits per-tool access instead of leaving the Academy to join two Backend facts
itself.

**The rule.** A tool is unlocked when the checkpoint level that releases it —
`CURRICULUM_TOOLS[].unlockLevel`, which `validateAtaUnlockVocabulary` pins against
`CHECKPOINT_ROWS` — has `UserLevelProgress.status === "completed"` for this
enrollment.

Never read: `enrollment.currentLevel`, `highestCompletedLevel`, XP, or a rank. A
regression asserts none of those identifiers appears in the module.

**Fail closed.** Missing level in the pinned version → locked
(`unlock_level_missing`). No progress row, or any status other than `completed` →
locked (`unlock_level_incomplete`). No enrollment → locked (`not_enrolled`).

### Contract

Full read (`GET /api/curriculum/v2/current`), on `enrolled` and `completed`:

```jsonc
"toolAccess": {
  "total": 19,
  "unlockedCount": 1,
  "tools": [
    {
      "code": "tool.trading_journal",
      "unlocked": true,
      "unlockLevel": 10,
      "unlockLevelStableCode": "v2.l010.kontrolnaya-tochka-100",
      "unlockLevelTitle": "Контрольная точка $100",
      "reason": "unlock_level_completed"
    }
    // …all 19, always, in canonical unlock order
  ]
}
```

Summary read (`?shape=summary`) carries the slim projection instead — counts plus
the open codes, bounded at nineteen short strings:

```jsonc
"toolAccess": { "total": 19, "unlockedCount": 1, "unlocked": ["tool.trading_journal"] }
```

Both come from **one** resolution, so they cannot disagree. `shape=summary` is
otherwise unchanged, and the summary stays far smaller than the full graph.

`reason` is a closed vocabulary: `unlock_level_completed`,
`unlock_level_incomplete`, `unlock_level_missing`, `not_enrolled`.

`tool.secret` is the referral-gated 20th tool. It is not a curriculum unlock, no
checkpoint releases it, and it never appears in `toolAccess` — while remaining a
code content may legitimately reference.

---

## G. The Academy presentation boundary

Academy may hold tool **presentation** metadata — title, description, icon,
category, learner copy. It may not hold an access rule.

* usability/openability in API mode comes **only** from `toolAccess[].unlocked`;
* a locally-known unlock level may be displayed but never compared;
* the direct URL uses the same resolved server field as the hub;
* fixture mode builds a Backend-*shaped* `toolAccess` and feeds the same code
  path, so there is one UI implementation and no mode-specific unlock rule.

XP presentation follows the same boundary: the Academy shows the server's
`xpReward` for a level and the server's `xp.currentXp` for a learner, and never
computes either. `xp.kind === "disabled"` renders as an explicit *unavailable*,
never as `0`; `available` with `currentXp: 0` renders as a real zero.

---

## H. Lesson progress

The accepted lesson-progress endpoint
(`PATCH /api/curriculum/v2/levels/{stableCode}/lesson-progress`) is production
ready and **unchanged** by this phase. It is:

* explicit route, single method, CSRF-gated, self-scoped (`gatePhase4Self`);
* server-derived learner — no `userId` or `enrollmentId` from the browser;
* idempotent on `requestId` with a durable receipt and a payload fingerprint;
* compare-and-set on `revision`, monotonic in `completedSections`;
* validated against the content body's own section-code vocabulary;
* `no-store`.

It writes `UserLessonProgress` and its receipt, and nothing else. It cannot
complete a level, grant XP, unlock a level, unlock a tool or satisfy a checkpoint.

**Durable section identity is safe.** Phase C's open question is closed: section
codes come from the closed `VideoLessonSectionCode` vocabulary in
`video-production-contract.ts`, which is the recording structure the final script
follows — not a positional id and not a function of which brief slot happened to
be populated. An editorial rewrite of a lesson's prose does not rename its
anchors, so persisted progress survives authoring.

---

## I. Activation readiness — and what is NOT done

Ready in source:

* the canonical ATA-100 package with the approved 10 000-XP schedule;
* a runtime that awards it through one owner, exactly once;
* registration auto-enrollment behind a default-off flag;
* server-owned tool access on both response shapes.

**Not done, deliberately:** no package imported into any live database, no
curriculum flag enabled, no auto-enrollment enabled, no package activated, no
existing user enrolled, no service restarted, no environment file touched, no
flag-policy profile edited.

### Existing users

The Phase-F hook applies to **new successful registrations after activation only**.
Nothing scans, backfills or bulk-enrolls an existing account, and a regression
asserts that a learner registered while the flag was off stays unenrolled after it
is switched on. Enrolling existing PREPROD test accounts is an explicit operator
step belonging to the activation rehearsal.

---

## Regressions

```bash
npm run test:regression:curriculum-phase-f
npm run test:regression:curriculum-phase-f-registration
```
