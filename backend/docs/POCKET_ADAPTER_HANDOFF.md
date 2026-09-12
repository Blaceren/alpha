# Pocket balance adapter — handoff (after L4VC-1)

L4VC-1 built the **complete provider-neutral L4 checkpoint engine**. What
remains is one file: an implementation of `CheckpointBalanceProvider` that talks
to Pocket.

Pocket technical documentation was **requested but not received** before this
phase. Nothing here guesses at it: no URL, no auth scheme, no response schema
and no credential exists anywhere in the source. See also
`docs/L4_CHECKPOINT_HANDOFF.md` (the earlier discovery record) and
`PVA-1` (the provider audit that found Pocket publishes no official balance API,
only CPA affiliate postbacks — the blocker is commercial, not technical).

---

## 1. The contract the adapter must satisfy

```ts
// src/lib/curriculum/checkpoint-provider.ts
export type CheckpointBalanceProvider = {
  readonly id: string;
  verifyThreshold(request: CheckpointProviderRequest): Promise<CheckpointProviderResult>;
};
```

The adapter receives the learner, the enrollment, the level, the integration
code, the threshold (currency + integer minor units), a request identity and an
`AbortSignal`. It answers with **a verdict**, never a measurement.

**The threshold comparison happens INSIDE the adapter.** That is the whole point
of the seam: the adapter is the only code that ever sees an amount, and it
converts that amount into `met` / `not_met` before returning. If the comparison
lived in the domain, the domain would need the observed balance and the privacy
contract would rest on discipline instead of on structure.

### Wiring it in

Exactly one place changes — `resolveCheckpointProvider` in
`src/lib/curriculum/checkpoint.ts`, the branch that currently returns
`unconfiguredCheckpointProvider`. Nothing else may change.

---

## 2. What must NOT change when the adapter lands

If any of these needs editing, the seam was wrong and the change should be
challenged rather than absorbed:

- the curriculum completion domain (`completion.ts`);
- checkpoint state transitions (`checkpoint-verification.ts`);
- Academy DTOs (`read-api.ts`, `backend-dto.ts`, `academy-view.ts`);
- Academy UI (`features/checkpoint/*`);
- persistence rules (`LevelCheckpointRequirement`, `CheckpointVerificationAttempt`);
- idempotency, cooldown, rate limiting;
- zero-reward completion.

---

## 3. Inputs still required from Pocket

Every item below is **unknown today**. None of it is guessed at in code.

| # | Input | Why the adapter needs it |
|---|---|---|
| 1 | Production Web API base URL | There is no endpoint in the source. |
| 2 | Authentication method | API key, OAuth, signed request — unknown. |
| 3 | Token refresh / lifetime | Whether a session must be renewed, and how. |
| 4 | Account ownership binding | How an ATA learner is bound to a Pocket account, and how that binding is proven. Drives `identity_unlinked` and `identity_mismatch`. |
| 5 | Request schema | Field names, encoding, required headers. |
| 6 | Response schema | Envelope shape and error container. |
| 7 | Real vs demo field | **Decisive.** A demo balance must never pass the gate. Without an authoritative real/demo discriminator the adapter cannot be written safely. |
| 8 | Login / account identifier field | For `providerRequestId`-style correlation and ownership checks. Never returned to the domain. |
| 9 | Balance field | Name, type, and whether it is major or minor units. |
| 10 | Currency field | To decide `unsupported_currency` rather than coercing. |
| 11 | Freshness / timestamp | To populate `observedAt` and to decide `stale`. |
| 12 | Provider error vocabulary | To map onto `provider_maintenance` / `provider_timeout` / `invalid_provider_response`. |
| 13 | Provider rate limits | To populate `retryAfterSeconds` and to size our own limits against theirs. |

### Open commercial question

PVA-1 concluded Pocket exposes **no official balance API**. If that stands, this
adapter cannot be written at all and the product decision (Option C in PVA-1)
must be revisited. The engine built here is not wasted in that case: it is
provider-neutral, so any authoritative balance source — a different broker, a
partner API, a signed statement — implements the same interface.

---

## 4. Rules the adapter must obey

1. **Never return an amount.** The result type has no field for one, and
   `normalizeCheckpointProviderResult` rebuilds the result from an allow-list,
   so an extra key is dropped rather than propagated. Do not try to widen it.
2. **Never log a balance, a token or an account identifier.** The engine already
   refuses to inspect thrown errors for exactly this reason.
3. **Honour the `AbortSignal`.** The engine enforces a 5-second deadline; an
   adapter that ignores it will be cut off and reported as `provider_timeout`.
4. **Do not retry internally.** Retry policy is the engine's, and it is
   deliberately zero — see §5.
5. **Compare in integer minor units.** Never floats, never string money.
6. **Demo is not a smaller number.** A demo-only account is `not_met`, with no
   hint that demo funds exist.
7. **Fail closed.** Anything ambiguous is `invalid_provider_response` or an
   `unavailable` reason — never `met`.

---

## 5. Operational values already chosen

These are **ATA's own defaults**, not Pocket's. They came from this platform's
judgement, and no Pocket documentation informed them.

| Setting | Value |
|---|---|
| Cooldown between attempts | 60 s |
| Learner allowance | 5 attempts / rolling hour / level |
| Provider timeout | 5 s |
| Automatic provider retry | none |
| Background polling | none |

All are configurable via `CheckpointVerificationConfig`. When Pocket's real rate
limits are known they are an **additional** constraint on top of these, not a
replacement.

---

## 6. OPS policy change required before enabling (documented, NOT performed)

L4VC-1 changed no runtime flag. Enabling verification later requires a separate,
authorized OPS act:

1. Add `POCKET_BALANCE_PROVIDER_ENABLED` to the DEV backend env (default absent
   = disabled).
2. Move `CURRICULUM_V2_CHECKPOINT_ENABLED` from `required_false_or_absent` to
   `required_true` in `config/curriculum-v2-flag-policy.json`.
3. Extend that policy file with the new provider flag. Note that its
   `forbid_unknown_prefix` is `CURRICULUM_V2_`, so `POCKET_BALANCE_PROVIDER_ENABLED`
   is not currently policed by check 13 — the policy schema needs a second
   governed key, or the flag needs renaming under the governed prefix.
4. Apply migration `20260728000000_checkpoint_verification_core` (source-only today).
5. Publish curriculum revision 4 (or seed the requirement) so a
   `LevelCheckpointRequirement` exists for L4 — see
   `curriculum/candidates/`.
6. Re-run `verify-isolation` and `preflight`.

Until every one of those is done, the live L4 honest gate stands unchanged:
`checkpoint_unverified` / `verification_unavailable` / `checkpoint_disabled`.

---

## 7. Suggested first commit for the adapter phase

- `src/lib/curriculum/checkpoint-provider-pocket.ts` — the adapter, and the only
  file that knows a Pocket URL exists.
- One branch change in `resolveCheckpointProvider`.
- Adapter-level tests against **recorded fixtures**, not the live provider.
- No change to the domain, persistence, API or Academy.
