/**
 * G4-GROWTH — one switch per provider event family, all of them off by default.
 *
 * THE FAILURE THIS EXISTS TO PREVENT. Before this phase, `POCKET_POSTBACK_ENABLED`
 * alone admitted `goal=reg`, and the legacy alias table let the same authenticated
 * caller reach commission and withdrawal handling. So an operator who wanted to
 * turn on Pocket REGISTRATION — a non-monetary identity binding — was also turning
 * on every financial family the receiver could dispatch. One switch, several
 * blast radii.
 *
 * THE RULE NOW. A family is enabled only when the MASTER gate and its OWN switch
 * are both on. The master gate keeps its meaning ("Pocket is integrated at all",
 * and it owns the secret), and the family switches decide what may actually
 * happen. Nothing here can widen the master gate — every function AND-s with it.
 *
 * DEP ALSO REQUIRES THE ACCEPTED FIRST-DEPOSIT RESOLUTION. `POCKET_FIRST_DEPOSIT_ENABLED`
 * is not replaced by `POCKET_DEP_INGEST_ENABLED`, because that flag owns the
 * deposit CURRENCY contract, and moving a money semantic in a phase that is not
 * permitted to change live behaviour would be the wrong trade. Deposits therefore
 * need both, which is strictly narrowing and never widening.
 *
 * ACTIVATION-ORDER CONSEQUENCE, RECORDED HERE BECAUSE IT WILL BITE SOMEBODY.
 * Turning `POCKET_POSTBACK_ENABLED=true` on its own no longer admits `goal=reg`.
 * A cutover must set `POCKET_REG_INGEST_ENABLED=true` at the same time, or Pocket
 * registrations stop binding identities and the L1 completion that depends on
 * them stops happening. This is stated again in the deployment handoff.
 */
import { resolvePocketPostbackConfig } from "@/lib/exchange/pocketPostbackAuth";
import { isPocketFirstDepositEnabled } from "@/lib/exchange/pocketFirstDepositConfig";

export const POCKET_REG_INGEST_ENABLED_KEY = "POCKET_REG_INGEST_ENABLED";
export const POCKET_DEP_INGEST_ENABLED_KEY = "POCKET_DEP_INGEST_ENABLED";
export const POCKET_RDEP_INGEST_ENABLED_KEY = "POCKET_RDEP_INGEST_ENABLED";

function readsTrue(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] === "true";
}

/** Is the Pocket integration itself on, with a usable secret? */
function masterGateEnabled(env: NodeJS.ProcessEnv): boolean {
  return resolvePocketPostbackConfig(env as Record<string, string | undefined>).enabled;
}

/**
 * Pocket REGISTRATION ingestion.
 *
 * Binds a `PocketTraderIdentity` and reconciles the L1 completion that depends
 * on it. Moves no money.
 */
export function isPocketRegIngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return masterGateEnabled(env) && readsTrue(env, POCKET_REG_INGEST_ENABLED_KEY);
}

/**
 * Pocket FIRST DEPOSIT ingestion.
 *
 * Three conditions, all required. The third is the accepted AFD-4 resolution,
 * which also decides whether a currency may be stamped at all.
 */
export function isPocketDepIngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    masterGateEnabled(env) &&
    readsTrue(env, POCKET_DEP_INGEST_ENABLED_KEY) &&
    isPocketFirstDepositEnabled(env)
  );
}

/**
 * Pocket REDEPOSIT ingestion.
 *
 * ON, deliveries are parsed, authenticated, validated, recorded as durable
 * evidence AND counted as canonical redeposits.
 *
 * THIS COMMENT USED TO SAY THE OPPOSITE. It said the switch did "NOT by itself
 * permit a canonical `rdep` event" because that "additionally requires a
 * provider event identity, which requires POCKET_RDEP_EVENT_ID_PARAM". That
 * second gate is gone: ATA derives its own deterministic identity from the
 * authenticated provider attributes, so a valid authenticated delivery is
 * countable on its own. Leaving the old sentence in place would tell the next
 * operator to go looking for a switch that no longer exists.
 */
export function isPocketRdepIngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return masterGateEnabled(env) && readsTrue(env, POCKET_RDEP_INGEST_ENABLED_KEY);
}

/**
 * POCKET-DEP-RDEP-1 (RDEP-AVAIL-1) — whether this deployment can count canonical
 * redeposits, and if not, WHY NOT truthfully.
 *
 * WHAT CHANGED AND WHY. This used to be `RedepositIdentityPolicy`, which asked a
 * different question: "has an operator named a parameter carrying a
 * PROVIDER-ISSUED unique event id?" When none was named it answered
 * `provider_event_identity_contract_absent`, and every surface downstream
 * repeated that as the reason redeposits could not be counted.
 *
 * THAT PREMISE IS SUPERSEDED. The accepted product decision is that a valid
 * authenticated `goal=redep` callback is itself authoritative evidence that a
 * redeposit occurred, and that ATA derives its OWN deterministic business
 * identity from the authenticated attributes
 * (`v1:pocket:redeposit:<player>:<local time>:<amount>`). Pocket issues no event
 * id and is not required to. Continuing to report "the provider supplies no
 * identity" would state a missing capability that ATA no longer needs and does
 * not lack.
 *
 * WHAT THIS ANSWERS INSTEAD is the question that actually gates counting:
 * is the ingest family switched on. It stays truthful when it is not, and it
 * NEVER reports the superseded reason.
 */
export type RedepositCapability =
  | { readonly kind: "available" }
  | {
      readonly kind: "unavailable";
      readonly reason: "master_gate_disabled" | "redeposit_ingest_disabled";
    };

/**
 * The accepted authority, read from configuration.
 *
 * DELIBERATELY NOT A CONSTANT `available`. A surface that claims a capability it
 * does not have is the same defect in the opposite direction, and an operator
 * who has switched RDEP off must be told exactly that.
 */
export function resolveRedepositCapability(
  env: NodeJS.ProcessEnv = process.env,
): RedepositCapability {
  if (!masterGateEnabled(env)) {
    return { kind: "unavailable", reason: "master_gate_disabled" };
  }
  if (!isPocketRdepIngestEnabled(env)) {
    return { kind: "unavailable", reason: "redeposit_ingest_disabled" };
  }
  return { kind: "available" };
}

/** A single snapshot for the ingress-health surface and for tests. */
export type PocketIngressSwitches = {
  readonly masterEnabled: boolean;
  readonly regEnabled: boolean;
  readonly depEnabled: boolean;
  readonly rdepEnabled: boolean;
  readonly redepositCapability: RedepositCapability;
};

export function readPocketIngressSwitches(
  env: NodeJS.ProcessEnv = process.env,
): PocketIngressSwitches {
  return {
    masterEnabled: masterGateEnabled(env),
    regEnabled: isPocketRegIngestEnabled(env),
    depEnabled: isPocketDepIngestEnabled(env),
    rdepEnabled: isPocketRdepIngestEnabled(env),
    redepositCapability: resolveRedepositCapability(env),
  };
}
