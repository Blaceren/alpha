/**
 * L4DSP-1 — the DEV-only checkpoint balance provider.
 *
 * WHAT IT IS FOR
 * L4 is a real financial gate. Exercising its ten outcomes today needs a funded
 * Pocket account, a Partner API credential and a real deposit — which means the
 * states designers and operators most need to look at (timeout, maintenance,
 * mismatch, stale) are the ones nobody can produce on demand. This provider
 * makes each of them a one-line operator command instead.
 *
 * WHAT IT IS NOT
 * It is not a completion override and not an XP grant. It answers the same
 * single question every provider answers — "does this learner meet the
 * threshold?" — and hands the answer back to the same engine, which then applies
 * the same cooldown, the same rate limit, the same idempotency, the same race
 * handling and the same completion owner. An operator who sets `met` has not
 * completed anything; they have arranged for the next verification the LEARNER
 * triggers to succeed. Everything downstream of that is unchanged code.
 *
 * WHAT IT CANNOT DO, STRUCTURALLY
 *   * Reach the network. This file imports `fs` and `path` transitively through
 *     the state reader and nothing else — no fetch, no http, no dns, no socket,
 *     and none of the Pocket adapter. There is no code path to a URL because
 *     there is no URL.
 *   * Produce, compare or store an amount. `request.thresholdMinorUnits` is
 *     never read here. That is a stronger contract than the test mock, which
 *     does compare a synthetic observation — a simulator that compared amounts
 *     would need an amount to compare, and an amount is the one thing this
 *     system is built not to have.
 *   * Bind, move or clear a `PocketTraderIdentity`. It reads identity and never
 *     writes it. An operator cannot use a scenario to link a learner to a Pocket
 *     account, which is why `met` cannot be used to paper over a missing link.
 *
 * IDENTITY PRECEDENCE — THE DELIBERATE PART
 * `met` and `not_met` are the two scenarios that make a claim about a specific
 * learner's money. Both therefore require the learner to actually be linked: if
 * no `PocketTraderIdentity` exists, the simulator answers `identity_unlinked` and
 * IGNORES the configured scenario. Every other scenario is a statement about the
 * provider or the link rather than about the money, so each is returned as
 * written — including `identity_mismatch`, which stays an explicit operator
 * choice rather than something inferred.
 *
 * The effect is that the simulator reproduces the real adapter's precedence
 * instead of bypassing it: a learner who never completed an authenticated
 * registration postback sees exactly what Pocket would have made them see.
 */
import { isDevEnvironment } from "@/lib/environment";
import { resolvePocketTraderIdentity } from "@/lib/exchange/pocketTraderIdentity";
import type {
  CheckpointBalanceProvider,
  CheckpointProviderRequest,
  CheckpointProviderResult,
} from "./checkpoint-provider";
import {
  lookupScenario,
  readSimulatorState,
  type SimulatorScenario,
} from "./checkpoint-simulator-state";

/** Stable, non-secret provider identity for diagnostics. Carries no credential. */
export const DEV_SIMULATOR_PROVIDER_ID = "dev_simulator";

/**
 * Advertised back-pressure for the rate-limited scenario.
 *
 * Fixed rather than operator-supplied: it is a number the learner sees, and the
 * state file has no business carrying learner-visible numbers.
 */
const SIMULATED_RETRY_AFTER_SECONDS = 120;

/** The scenarios that assert something about this learner's money. */
const MONEY_CLAIM_SCENARIOS = new Set<SimulatorScenario>(["met", "not_met"]);

export type DevSimulatorDeps = {
  /** Injectable for tests. Resolves the learner's trusted Pocket trader id. */
  readonly resolveIdentity?: (userId: number) => Promise<string | null>;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
};

/**
 * Every refusal collapses to one typed unavailable result.
 *
 * Missing state, malformed state, an expired scenario and a learner with no
 * scenario are all `provider_unconfigured`: the simulator has not been told what
 * to say, and inventing an answer about a financial gate is never the safe
 * response. Using the EXISTING reason rather than a new one is what keeps
 * Academy unchanged — there is no simulator-specific state for a client to learn.
 */
function unconfigured(): CheckpointProviderResult {
  return { outcome: "unavailable", reason: "provider_unconfigured" };
}

function outcomeFor(scenario: SimulatorScenario): CheckpointProviderResult {
  switch (scenario) {
    case "met":
      return { outcome: "met" };
    case "not_met":
      return { outcome: "not_met" };
    case "identity_unlinked":
      return { outcome: "identity_unlinked" };
    case "identity_mismatch":
      return { outcome: "identity_mismatch" };
    case "unsupported_currency":
      return { outcome: "unsupported_currency" };
    case "stale":
      return { outcome: "stale" };
    case "invalid_provider_response":
      return { outcome: "invalid_provider_response" };
    case "provider_timeout":
      // Returned IMMEDIATELY as the typed outcome rather than by hanging until
      // the engine's five-second deadline fires. The engine's own timeout path
      // is already proven by the core suite's mock; making every designer wait
      // five seconds to look at a screen would buy nothing and would make the
      // rehearsal wall-clock dependent.
      return { outcome: "unavailable", reason: "provider_timeout" };
    case "provider_maintenance":
      return { outcome: "unavailable", reason: "provider_maintenance" };
    case "provider_rate_limited":
      return {
        outcome: "unavailable",
        reason: "provider_rate_limited",
        retryAfterSeconds: SIMULATED_RETRY_AFTER_SECONDS,
      };
  }
}

export function createDevCheckpointBalanceProvider(
  deps: DevSimulatorDeps = {},
): CheckpointBalanceProvider {
  return {
    id: DEV_SIMULATOR_PROVIDER_ID,
    async verifyThreshold(
      request: CheckpointProviderRequest,
    ): Promise<CheckpointProviderResult> {
      const env = deps.env ?? process.env;

      // 1. The environment gate, re-asserted at call time.
      //
      // `resolveCheckpointProvider` already refused to build this provider
      // outside DEV, so reaching here in production would mean something else
      // constructed it directly. Checking again costs nothing and means the
      // guarantee does not depend on every future caller remembering.
      if (!isDevEnvironment(env)) return unconfigured();

      // 2. Currency, checked exactly as the official adapter checks it, so the
      //    simulator cannot make a gate look answerable that Pocket would refuse.
      if (request.thresholdCurrency !== "USD") {
        return { outcome: "unsupported_currency" };
      }

      // 3. Operator state. Any problem at all — absent, unreadable, oversized,
      //    symlinked, group-readable, malformed, wrong schema — is one refusal.
      const read = readSimulatorState(env);
      if (!read.ok) return unconfigured();

      const now = deps.now?.() ?? new Date();
      const lookup = lookupScenario(read.state, request.learnerId, now);
      if (lookup.kind !== "active") return unconfigured();

      const scenario = lookup.entry.scenario;

      // 4. Identity precedence. Only the two money-claiming scenarios require a
      //    link; the rest describe the provider or the link itself.
      if (MONEY_CLAIM_SCENARIOS.has(scenario)) {
        const resolveIdentity =
          deps.resolveIdentity ??
          (async (userId: number) => {
            const { prisma } = await import("@/lib/prisma");
            return resolvePocketTraderIdentity(userId, prisma);
          });

        const pocketUserId = await resolveIdentity(request.learnerId);
        if (pocketUserId === null) {
          // The configured scenario is deliberately DISCARDED. `met` must not be
          // a way to pass a gate the real provider could not even have been
          // asked about.
          return { outcome: "identity_unlinked" };
        }
      }

      return outcomeFor(scenario);
    },
  };
}

/**
 * Build the simulator, or explain by returning null that it may not run.
 *
 * `null` is returned when the environment is not authoritatively `dev`. The
 * caller then holds the `unconfigured` provider — never the Pocket adapter, and
 * never a silently different implementation.
 */
export function resolveDevSimulatorProvider(
  env: NodeJS.ProcessEnv = process.env,
  deps: DevSimulatorDeps = {},
): CheckpointBalanceProvider | null {
  if (!isDevEnvironment(env)) return null;
  return createDevCheckpointBalanceProvider({ ...deps, env: deps.env ?? env });
}
