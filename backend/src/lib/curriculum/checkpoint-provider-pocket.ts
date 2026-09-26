/**
 * L4PA-1 — the official Pocket Partner implementation of the L4VC-1 seam.
 *
 * This is the file the L4VC-1 handoff described as "the only file that knows a
 * Pocket URL exists". It implements `CheckpointBalanceProvider` and nothing
 * else changes: the completion domain, the state machine, the persistence
 * rules, the API contract and the Academy are all untouched, which is the
 * substitutability the provider-neutral phase was built to prove.
 *
 * THE IDENTITY IS RESOLVED SERVER-SIDE, ALWAYS
 * The request the engine hands over carries a LEARNER id and nothing that could
 * name a Pocket account. The trader id is looked up from `PocketTraderIdentity`,
 * which is written only by an authenticated registration postback. There is no
 * parameter — on this method, on the HTTP route, or anywhere between — through
 * which a learner or a staff member could nominate which Pocket account to ask
 * about. Pointing the gate at someone else's funded account is not blocked by a
 * check; it is unreachable.
 *
 * THE AMOUNT NEVER ARRIVES HERE
 * The threshold goes down into the client and a verdict comes back. This module
 * has no variable holding a balance, because the function it calls does not
 * return one.
 */
import {
  resolvePocketPartnerConfig,
  type PocketPartnerConfig,
} from "@/lib/exchange/pocketPartnerConfig";
import {
  verifyPocketPartnerThreshold,
  type PocketFetch,
} from "@/lib/exchange/pocketPartnerClient";
import { resolvePocketTraderIdentity } from "@/lib/exchange/pocketTraderIdentity";
import type {
  CheckpointBalanceProvider,
  CheckpointProviderRequest,
  CheckpointProviderResult,
} from "./checkpoint-provider";

/** The minimum surface of the client the provider needs. Injectable for tests. */
export type PocketProviderDeps = {
  /** Resolves the learner's trusted Pocket trader id, or null when unbound. */
  readonly resolveIdentity?: (userId: number) => Promise<string | null>;
  readonly fetchImpl?: PocketFetch;
};

/** Stable, non-secret provider identity for diagnostics. Carries no credential. */
export const POCKET_PARTNER_PROVIDER_ID = "pocket_partner";

/**
 * Build the adapter around an already-validated configuration.
 *
 * The configuration is validated by the caller (`resolveCheckpointProvider`)
 * rather than here, so a provider object can never exist in a half-configured
 * state: if the config is not usable, the platform holds the `unconfigured`
 * provider instead and this constructor is never reached.
 */
export function createPocketPartnerBalanceProvider(
  config: PocketPartnerConfig,
  deps: PocketProviderDeps = {},
): CheckpointBalanceProvider {
  return {
    id: POCKET_PARTNER_PROVIDER_ID,
    async verifyThreshold(
      request: CheckpointProviderRequest,
    ): Promise<CheckpointProviderResult> {
      // The threshold currency the platform published must be one this adapter
      // can compare against. Pocket reports USD; anything else is refused
      // rather than converted, because a silently coerced comparison would be a
      // wrong answer about someone's money.
      if (request.thresholdCurrency !== "USD") {
        return { outcome: "unsupported_currency" };
      }

      const resolveIdentity =
        deps.resolveIdentity ??
        (async (userId: number) => {
          const { prisma } = await import("@/lib/prisma");
          return resolvePocketTraderIdentity(userId, prisma);
        });

      const pocketUserId = await resolveIdentity(request.learnerId);
      if (pocketUserId === null) {
        // No authenticated registration postback has ever bound this learner.
        // This is a truthful "we do not know who to ask", NOT `not_met`.
        return { outcome: "identity_unlinked" };
      }

      const { outcome, providerRequestId, observedAt } = await verifyPocketPartnerThreshold({
        config,
        pocketUserId,
        thresholdMinorUnits: request.thresholdMinorUnits,
        // The engine's deadline is honoured as given. The adapter neither
        // extends it nor retries inside it.
        signal: request.timeoutSignal,
        fetchImpl: deps.fetchImpl,
      });

      switch (outcome.kind) {
        case "met":
          return { outcome: "met", providerRequestId, observedAt };
        case "not_met":
          return { outcome: "not_met", providerRequestId, observedAt };
        case "identity_mismatch":
          return { outcome: "identity_mismatch", providerRequestId };
        case "invalid_provider_response":
          return { outcome: "invalid_provider_response", providerRequestId };
        case "unavailable":
          return {
            outcome: "unavailable",
            reason: outcome.reason,
            providerRequestId,
            retryAfterSeconds: outcome.retryAfterSeconds ?? null,
          };
      }
    },
  };
}

/**
 * Resolve the adapter from the environment, or explain why there is none.
 *
 * Returning `null` is a first-class answer: the caller then holds the
 * `unconfigured` provider, which reports `provider_unconfigured`. Granting the
 * capability flag without valid configuration must never manufacture a verdict
 * about a learner's money.
 */
export function resolvePocketPartnerProvider(
  env: NodeJS.ProcessEnv = process.env,
  deps: PocketProviderDeps = {},
): CheckpointBalanceProvider | null {
  const config = resolvePocketPartnerConfig(env);
  if (!config.configured) return null;
  return createPocketPartnerBalanceProvider(config, deps);
}
