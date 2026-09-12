# ATA V2 — Phase 3 Completion

## Scope

Phase 3 delivers an enrollment-owned, positive-only V2 XP ledger; an idempotent internal award/resolver foundation; XP-aware level state with a temporal cutoff; atomic supported level completion; concurrency-safe V1 promocode redemption with conditional V2 dual-write; and self-service read-only current/history APIs. It adds no generic completion, award, correction or mutation API and performs no rollout.

## Commits

Phase 2 completion base: `d0a7abe2adecd47490e6ffe1cf74a825d237b244`.

- `415aaf5a3658ce462119d5e5ff621887e654a3d0` — XP engine design contract.
- `37f6843964b9adea40ec7a257b10bfc16ea95699` — ledger schema foundation.
- `e4abac79de9bfae4eb1103460c91663279ad931c` — immutable ledger service and resolver.
- `7d4bbdcfc559880f5fa81abd7f1fed8a602c19a5` — XP-aware LevelState.
- `6b3b85edeb1f6329c33c4dffe995587414bd43a2` — temporal cutoff hardening.
- `be3358fae7a1608e9fd0c865859466cfba139944` — atomic supported completion transition.
- `b028a30ae8bd1624b0f4915740f4a26e7726ec29` — atomic promocode compatibility and V2 dual-write.
- Phase 3 completion commit — read API, cumulative gate, upgrade proof and this document; its full hash is reported after the one required commit is created.

## Schema and migrations

The cumulative Phase 2→3 diff adds only:

- `20260714020000_xp_transaction_foundation`;
- `20260714030000_promocode_redemption_idempotency`.

The first adds `CurriculumXpSourceType`, `XPTransaction` and additive composite parent keys. The second adds `PromocodeRedemptionRequest` and additive ownership relations. There is no destructive V1 migration, rename, dropped V1 column/table or V1 backfill. Phase 3B.6 itself changes neither Prisma schema nor migrations.

The only V1-adjacent Phase 3 change is the additive promocode request-idempotency foundation and runtime hardening of the existing redeem route. Existing `Promocode`, `PromocodeRedemption`, `User.xp` and `XpEvent` remain valid.

## XP authority and enrollment ownership

`XPTransaction` is the only V2 current-XP authority. Current XP is the validated sum for one trusted `UserCurriculumEnrollment`; V1 `User.xp` and `XpEvent` are never mixed into it. `userId` and `curriculumVersionId` are protected ownership discriminators, while the enrollment remains pinned to one published or archived curriculum version. Superseded enrollments are never merged into the current total. There is no stored `currentXp` cache.

## Source allowlist

The schema and runtime allow only:

- `level_completion`;
- `assessment_pass`;
- `report_approval`;
- `mentor_completion`;
- `promocode`;
- `migration_adjustment`;
- `admin_correction`.

Level-owned sources require a same-version `LevelDefinition`; promocode/migration/admin sources must have no level. Phase 3 awards no XP for trade, deposit, withdrawal, login, daily reward or referral events.

## Immutability boundary

V2 awards are append-only through the exported domain command. The runtime exports no ledger update/delete operation. Amount must be a positive bounded integer; zero and negative awards are forbidden. RESTRICT ownership FKs prevent ordinary parent deletion. Reads validate ownership, version, source/level contract, key, fingerprint, metadata and amount before trusting a total.

SQLite has no Phase 3 ledger mutation trigger, so a privileged raw-SQL operator can still alter rows. Domain isolation and fail-closed validation are the application boundary.

## Idempotency and fingerprint

The server derives a globally namespaced key from the durable owner identity and stores a canonical SHA-256 payload fingerprint. Exact retry returns the original durable row with `created=false` and no repeated audit/timestamp effects. Key/source reuse with a different payload fails closed. Expected unique races recover only by rereading and fully validating the winner; unknown database errors are never treated as success.

## Feature flags

`CURRICULUM_V2_READ_ENABLED`, `CURRICULUM_V2_ENROLLMENT_ENABLED` and `CURRICULUM_V2_XP_ENABLED` are independent and default false. ADMIN does not substitute for them. Current read requires READ; history requires READ+XP; completion requires READ+ENROLLMENT+XP. Promocode V2 dual-write requires all three and otherwise remains V1-only. Production rollout is forbidden in this phase.

## XP resolver

`resolveEnrollmentXp` validates the enrollment pin, every ledger row and the optional internal `asOf` cutoff. It returns a safe total, transaction count and last transaction time. Archived pins are valid. Draft/mismatched ownership, source, level, metadata, key, fingerprint, actor or range state returns typed corruption. It never reads V1 XP.

## XP-aware LevelState and temporal cutoff

LevelState resolves context, progress and XP in one read transaction. XP is resolved once per enrollment and carried as one shared snapshot; the current API maps this snapshot and does not sum the ledger again. A single internal evaluation time is reused throughout. Rows count when `createdAt <= evaluationTime`; future rows cannot unlock or start a level. Client HTTP input cannot supply `asOf`.

## Completion transaction

Supported completion validates flags, owner mapping, active/pinned enrollment, current level, progress and immutable positive reward. Progress CAS, XP insert, XP audit, completion audit and enrollment summary advance commit in one transaction. Terminal state is `highestCompletedLevel=maxLevel`, `currentLevel=maxLevel+1`, `status=completed`. No next progress, notification, CRM write, V1 XP write, re-enrollment or version migration is created.

### Supported and fail-closed completion owners

- lesson/lesson or lesson/manual → `level_completion` from `in_progress`;
- final_exam/assessment_pass → `assessment_pass` from `in_progress`;
- report/report_approval → `report_approval` from `pending_review`;
- mentor_review/mentor_review → `mentor_completion` from `pending_review`.

Scenario, practice, external-event and checkpoint owners have no Phase 3 adapter/storage and fail closed. Financial/trade/deposit/withdrawal completion does not award V2 XP.

## Promocode concurrency and V1/V2 dual-write

The existing redeem route now uses a durable per-user request key, canonical request fingerprint and transactionally enforced max/per-user counts. V1 redemption, counter and V1 XP effects remain compatible. When READ+ENROLLMENT+XP are enabled and the user has a valid active published/archived pin, the same transaction adds one V2 `promocode` row whose source is the durable redemption. Candidate, completed, partial-flag and disabled states remain V1-only; corrupt enabled V2 state rolls the whole transaction back.

Legacy audit/notification remain post-commit best-effort. They run only for `created=true`; there is no outbox.

## Read API contracts

### `GET /api/curriculum/v2/current`

The existing route remains the sole current-curriculum route. Its candidate/enrolled/completed/unavailable fields remain additive-compatible. Enrolled responses always include:

```json
{
  "xp": {
    "kind": "available",
    "currentXp": 123,
    "transactionCount": 7,
    "lastTransactionAt": "2026-07-14T10:00:00.000Z",
    "nextLevelRequiredXp": 150,
    "xpRemaining": 27
  }
}
```

With XP disabled, enrolled/completed responses expose `{"xp":{"kind":"disabled"}}`. Completed terminal summary uses `nextLevelRequiredXp:null` and `xpRemaining:0`. Candidate/unavailable states do not invent an XP total. XP corruption is a sanitized 409. All responses are `no-store`.

### `GET /api/curriculum/v2/xp/history`

The endpoint is self-only and accepts only `limit` (default 20, 1–50) and an opaque cursor. Results use `available | completed | not_enrolled | unavailable`, safe curriculum identity, full-ledger summary, allowlisted items and nullable `nextCursor`. Items expose only `amount`, `sourceType`, `createdAt` and safe `levelNumber/stableCode` or null.

The deterministic cursor is authenticated-encrypted, contains only the `(createdAt,id)` position and is cryptographically bound to the session user and trusted enrollment. It cannot select another enrollment. Sort order is `createdAt DESC, id DESC`; malformed, tampered or cross-enrollment cursors return 400. Summary and page are read in one transaction with a fixed bounded query shape and no per-item query.

Transaction IDs, user/enrollment/version IDs, source IDs, metadata, idempotency keys, fingerprints, actor data, promo code/evidence, audit data and raw Prisma relations are never returned.

## Security matrix

| Condition | Current | XP history |
| --- | --- | --- |
| READ off | 404 before auth | 404 before auth |
| READ on, XP off | authenticated current; XP disabled for enrolled/completed | 404 before auth |
| Anonymous | 401 | 401 |
| Inactive/blocked | 403 | 403 |
| Unexpected/cross-user query | 400 | 400 |
| Malformed/tampered cursor | n/a | 400 |
| Curriculum/XP corruption | sanitized 409 | sanitized 409 |
| Valid GET | no CSRF, no-store, no writes | no CSRF, no-store, no writes |

Security order for history is READ → XP → session → active user → strict query → trusted context/enrollment → read-only XP snapshot → allowlist mapper.

## Cumulative regressions

`test:regression:curriculum-xp-api` runs 62 real-HTTP scenarios with a real Next server, login/session cookies and `/tmp` SQLite. `test:regression:curriculum-phase3` runs sequentially: XP schema 47, ledger/resolver 66, XP LevelState 81, completion 76, promocode 67, XP API 62, populated upgrade 22 and the complete Phase 2 gate.

The cumulative gate reports 842 executed assertions and 798 unique assertions. The difference is explicit nested repetition: upgrade runs directly, in Phase 2 and in Phase 1. The gate propagates stdout/stderr/exit status and verifies no leftover test listener or runtime DB artifact.

## Populated upgrade

The representative throwaway populated V1 DB applies the complete additive migration chain and proves V1 row/value/relation preservation, initially empty `XPTransaction` and `PromocodeRedemptionRequest`, idempotent migration runner, V1 auth/read and V1 promocode with all V2 flags off, READ-off 404, READ-on/XP-off current with disabled XP, READ+XP enrollment history 200, flags default false, and final DB/listener cleanup. Production data is never read or copied.

## V1 compatibility and cumulative diff audit

Audit base is `d0a7abe2adecd47490e6ffe1cf74a825d237b244`. No V1 table or data authority is removed. V1 authenticated reads and promocode redemption pass. Existing mutable `User.xp` remains the separate V1 authority. The only existing route changed is promocode redemption for safe request idempotency/concurrency and conditional dual-write; with flags false it remains V1-only. No generic completion route, current-XP cache, negative XP, seed/backfill or automatic version migration exists.

## Known limitations

- Privileged raw SQL can mutate the ledger because DB triggers are absent.
- Legacy promo audit/notification are post-commit and there is no outbox.
- An old caller that does not reuse an idempotency key cannot recover a lost response.
- Scenario/practice/external-event/checkpoint completion owners fail closed.
- There is no admin correction route; negative correction is forbidden.
- Mutable V1 `User.xp` remains a separate legacy authority.
- Seed, backfill and enrollment-version migration are absent.
- All flags default false and production rollout is forbidden.

## Rollout restrictions

Do not enable production flags, deploy, copy production DB data, seed/backfill, migrate enrollments or expose mutation/admin correction APIs as part of this phase. Phase 3 is READY only after the cumulative gate and mandatory Prisma/lint/TypeScript/build checks pass in the isolated workspace.

## Remaining Phase 4+ scope

Assessment/report/mentor owner storage/adapters, scenario/practice/external-event/checkpoint runtime, content/assessment versions, entitlements, correction workflow, outbox, seed/backfill, version migration, referral/daily V2 XP and UI remain future scope.

## Percentage readiness

- Phase 3: **100%**.
- Core backend Phase 1–8: **37.5%**.
- Full roadmap Phase 1–13: **about 23%**.

These percentages use the agreed roadmap scale and are not recalculated from assertion counts.
