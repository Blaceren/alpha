/**
 * G4-H5 — the ONE operation that owns "bind a trusted Pocket player to an ATA
 * learner", and therefore the one place a `pocket_reg` growth event is decided.
 *
 * THE DEFECT THIS CORRECTS. Before this wave, `recordPocketRegistrationGrowthEvent`
 * had exactly one caller: the typed `ow` handler. The LEGACY header-authenticated
 * branch of the same route also called `bindPocketTraderIdentity`, created a real
 * `PocketTraderIdentity`, and emitted nothing. Migration 47 meanwhile backfills
 * `pocket_reg` from `PocketTraderIdentity` rows — including the nine on PREPROD,
 * every one of which was created by that legacy path. So history counted those
 * bindings and runtime would not: a permanent, silent, undetectable under-count
 * of Pocket conversions with no reconciliation to repair it.
 *
 * WHY A DOMAIN OPERATION RATHER THAN A SECOND EMITTER CALL. Adding
 * `recordPocketRegistrationGrowthEvent(...)` beside the second
 * `bindPocketTraderIdentity(...)` call would have fixed today's two call sites and
 * guaranteed that a future third one is added without it. The audit's finding was
 * not "one call site was forgotten" — it was "the emission is attached to the
 * RECEIVER instead of to the MUTATION". So the mutation and its projection are
 * now one operation, and `bindPocketTraderIdentity` is no longer called directly
 * by any route.
 *
 * WHAT THIS DOES NOT CHANGE. `bindPocketTraderIdentity` keeps its narrow database
 * type, its `create`-never-`upsert` discipline and its conflict vocabulary — the
 * properties that make "no silent rebind" provable. This module composes it; it
 * does not reach inside it. The emission remains idempotent on the Pocket PLAYER,
 * so calling this twice, from two different receivers, or once per retry produces
 * exactly one canonical event.
 */
import type { PrismaClient } from "@prisma/client";
import {
  bindPocketTraderIdentity,
  type PocketIdentityBindResult,
} from "@/lib/exchange/pocketTraderIdentity";
import {
  recordPocketRegistrationGrowthEvent,
  type PocketRegGrowthResult,
} from "@/lib/growth/pocket/registration";

export type BindPocketIdentityCanonicalInput = {
  readonly userId: number;
  /** Untrusted value straight off the delivery. Validated by the binder. */
  readonly pocketUserId: unknown;
  readonly clickId: string;
  readonly db: PrismaClient;
  /**
   * The ingress evidence row this binding arrived on, when the caller wrote one.
   * Null for callers that legitimately have no provider delivery to point at.
   */
  readonly ingressEventId?: number | null;
  readonly now?: Date;
};

export type BindPocketIdentityCanonicalResult = {
  readonly binding: PocketIdentityBindResult;
  /**
   * Null when the binding did not succeed — a conflict or a malformed identifier
   * produces no canonical event, because no business fact became true.
   */
  readonly growth: PocketRegGrowthResult | null;
};

/**
 * `bound` and `already_bound` are the two outcomes that mean "the claimed binding
 * is now the stored truth". Both must project, and for the same reason the
 * accepted route already reconciles on both: a request can bind the identity and
 * then die before the projection, and gating on "newly created" would strand that
 * learner's conversion forever.
 */
export function bindingEstablishedIdentity(result: PocketIdentityBindResult): boolean {
  return result.outcome === "bound" || result.outcome === "already_bound";
}

/**
 * Bind the identity and, if that established the binding, record the canonical
 * `pocket_reg` event for it.
 *
 * THE PROJECTION CANNOT FAIL THE BINDING. It runs after, and
 * `recordPocketRegistrationGrowthEvent` swallows its own failures, because a
 * binding that committed must not be reported as a failure by the row describing
 * it. That asymmetry is deliberate and unchanged from the accepted design; what
 * changed is that every path now reaches it.
 */
export async function bindPocketIdentityCanonical(
  input: BindPocketIdentityCanonicalInput,
): Promise<BindPocketIdentityCanonicalResult> {
  const binding = await bindPocketTraderIdentity({
    userId: input.userId,
    pocketUserId: input.pocketUserId,
    clickId: input.clickId,
    db: input.db,
    ...(input.now ? { now: input.now } : {}),
  });

  if (!bindingEstablishedIdentity(binding)) {
    return { binding, growth: null };
  }

  // The binder canonicalises the identifier, so the event is keyed on the stored
  // spelling rather than on whatever the caller sent — `"007"` and `"7"` must not
  // key two events for one player.
  const identity = await input.db.pocketTraderIdentity.findUnique({
    where: { userId: input.userId },
    select: { pocketUserId: true },
  });

  if (identity === null) {
    // The binding said it exists and the read says it does not. Report the
    // binding truthfully and record no event rather than inventing a key.
    return { binding, growth: { kind: "no_identity" } };
  }

  const growth = await recordPocketRegistrationGrowthEvent(
    input.db,
    identity.pocketUserId,
    input.ingressEventId ?? null,
  );

  return { binding, growth };
}
