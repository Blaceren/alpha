# Financial checkpoint — honest gate, and the handoff to a verification engine

**Phase:** L4HG-1 (2026-07-27). **Scope shipped:** a truthful, fail-closed
presentation of a financial checkpoint while authoritative balance verification
is unavailable. **Not shipped:** verification itself.

---

## What was wrong

After L3 approval the enrollment advances to level 4. Before this change L4
resolved to `available` with **zero blockers**, could be started (creating a
`UserLevelProgress` row with status `in_progress`), and then could not be
completed by any owner — `completion.ts` has no `financial_checkpoint:balance_check`
pair, so every attempt returned `COMPLETION_OWNER_UNAVAILABLE`.

A learner reaching L4 entered a level they could never leave, and the product
presented it as an ordinary actionable step. That is the defect this phase
removes.

## What ships

- **A derived read-model state, not a new durable status.** `EffectiveLevelState`
  gains `checkpoint_unverified`. `UserLevelProgressStatus` is unchanged, and no
  durable row is rewritten — a checkpoint row that already exists as
  `in_progress` simply *reads* as unverified.
- **A bounded checkpoint block** on the level read model: `kind`,
  `integrationCode`, `verificationState`, `verificationReason`, `canVerify`,
  `canStart`, `canComplete`. Nothing else — the shape has no field a balance
  could occupy.
- **A fail-closed action boundary.** `startCurrentCurriculumLevel` refuses a
  checkpoint with `LEVEL_START_CHECKPOINT_UNVERIFIED` before any row is created.
  Completion, lesson content, assessments and reports were already refused by
  type and remain so, now with tests pinning it.
- **A dedicated flag,** `CURRICULUM_V2_CHECKPOINT_ENABLED`, default false.
- **An honest Academy screen:** the canonical target, what passing opens, and
  the plain statement that verification is unavailable and progress is kept.

## What deliberately did NOT ship

No balance provider. No Pocket call. No currency conversion. No manual mentor
attestation. No learner-entered amount, no screenshot upload, no
"I have deposited" affordance. No verification endpoint. No migration. No new
table. No curriculum revision. No XP.

---

## Unresolved product decisions

These remain open and were **not** resolved in code (see the L4D-1 audit,
`/home/ubuntu/audits/ata-l4-discovery-l4d1-2026-07-27/`):

| # | Question | Status |
|---|---|---|
| U-1 | Authoritative verification source while Pocket is disabled — Pocket-only, staff fallback, or deferred? | **Open** since 2026-07-23 (CS-1 blocker **B-05**) |
| U-2 | Currency → USD conversion rule | **Open** — `V2_PRODUCT_DECISIONS.md` §6 says "правило конверсии — запросить" |
| U-3 | May L4 depend on enabling Pocket? | **Open** |
| U-4 | Grace duration and suspension threshold | **Open** — seven states are specified, no durations exist anywhere |
| U-5 | Do rank (`rank.observer_1`) and channel (`channel.start_questions`) unlocks grant entitlement, or are they descriptive? | **Open** — no backend entity exists for either |
| U-6 | Retry cadence and rate limit | **Open** |

`docs/V2_PRODUCT_DECISIONS.md` §6 also states plainly: **«Имитировать
production-проверку баланса запрещено.»** Nothing in a future phase may satisfy
U-1 by wiring the sandbox provider — it reads `ExchangeAccount.balance`, which
`postbackProcessor` increments from *deposits*, and cumulative deposits are
explicitly rejected as the checkpoint input.

---

## Contract boundary for the future verification engine

When U-1 is answered, the engine must satisfy all of the following.

### Provider

- The provider returns a **typed outcome**, never a number, to any caller above
  its boundary: `met | not_met | unavailable | unsupported_currency`.
- **`unavailable` must remain distinct from `not_met`.** Required by
  `V2_PRODUCT_DECISIONS.md` §6. Reporting "you have not reached $50" when the
  platform merely could not look is a false statement about a real person's
  money.
- `hasAuthoritativeCheckpointProvider()` in `src/lib/curriculum/checkpoint.ts`
  is the single seam to replace. It is a named function precisely so that the
  absence of a provider is an explicit, testable fact.
- Any uncertainty — provider error, timeout, unsupported currency, unknown
  integration code, missing requirement — resolves to `verification_unavailable`.
  Never to `met`, never to `not_met`.

### Privacy — non-negotiable

- **The verification result may persist. The balance value may not.**
- No balance in a column, in a JSON field, in an API response, in notification
  metadata, in audit metadata, in a log line, or in a test snapshot.
- Do not add a `Json` metadata column to any verification table: an untyped bag
  is how a balance gets stored by accident.
- The learner submits **no financial value** of any kind. A verify request
  carries an idempotency key and nothing else. A proposal to accept a
  learner-supplied balance or a balance screenshot converts a verified fact into
  an unverified claim and must be refused.
- The V1 `Checkpoint` table is the counter-example: it persists
  `currentBalance`, returns it, and copies it into notification metadata. Do not
  read, extend or reuse it.

### Completion

- Completion remains owned by `completeCurriculumLevel`. The engine emits a
  completion; it never writes progress or enrollment state directly.
- A new owner pair `financial_checkpoint:balance_check` requires a new
  `CurriculumXpSourceType` member and therefore a migration. In SQLite an enum
  value is additive and **not removable without a table rebuild** — plan
  rollback as "flag off + release rollback", not as a schema reversal.
- **Zero reward creates no `XPTransaction`.** L4 has `xpReward: 0`; the
  zero-reward path (RR-1/AC-1) already handles this and needs no XP flag.
- L5 unlocking needs no new code: the existing engine advances the enrollment.

### Requirement storage

The `$50` currently exists in production only as characters inside the level
title. The package `gateSchema` has no threshold field and `LevelDefinition` has
no threshold column. A verification engine needs a real requirement store
(threshold in **integer minor units**, currency, rule) and a package revision
that carries it — which means operator content approval, as rev2 and rev3 did.

---

## Deployment-time policy change (not applied by this phase)

The runtime flag policy at
`/home/ubuntu/runtime/ata-dev-v2/config/curriculum-v2-flag-policy.json` is a
**runtime** artefact and is not source-controlled in this repository, so this
phase did not edit it. `bin/verify-isolation` check 13 rejects any unknown
`CURRICULUM_V2_` variable, so the policy must be updated **in the same
maintenance window that deploys a release containing this flag**, before the
release is activated:

```json
"required_false_or_absent": [
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_CHECKPOINT_ENABLED",
  "CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED",
  "CURRICULUM_V2_XP_ENABLED"
]
```

Order is fixed: **policy update → release activation → smoke**. Activating a
release that knows the flag before the policy knows it drops
`verify-isolation` below 28/28.

No deployment was performed in L4HG-1, and the live runtime was not modified.
