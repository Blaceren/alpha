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

/**
 * The query parameter that carries a provider-generated, retry-stable unique
 * event identifier for a redeposit.
 *
 * UNSET BY DEFAULT, AND THAT IS THE POINT. Pocket's documented macro set carries
 * no such field. Naming one here is an operator asserting that a provider
 * contract now supplies it — a deliberate, auditable act, not something the
 * platform may infer from a parameter happening to be present in a payload.
 * Until it is set, no canonical redeposit can be emitted by any code path.
 */
export const POCKET_RDEP_EVENT_ID_PARAM_KEY = "POCKET_RDEP_EVENT_ID_PARAM";

/** Parameter names an operator may NOT nominate as the redeposit event identity. */
const FORBIDDEN_EVENT_ID_PARAMS = new Set([
  // Authentication material. Naming any of these would route the secret into a
  // stored identity column and into a unique index.
  "ow",
  "secret",
  "token",
  // Fields that are not event identities, however tempting. A player repeats
  // across every one of their deposits, a click repeats across a whole journey,
  // an amount and a timestamp are the exact pair this platform has already
  // refused to synthesise a key from.
  "playerid",
  "clickid",
  "click_id",
  "sum",
  "sumdep",
  "date_time",
  "datetime",
  "date",
  "goal",
]);

const PARAM_NAME_SHAPE = /^[a-z][a-z0-9_]{0,39}$/;

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
 * Note carefully what this switch does and does not do. ON, deliveries are
 * parsed, authenticated, validated and recorded as durable evidence. It does
 * NOT by itself permit a canonical `rdep` event — that additionally requires a
 * provider event identity, which requires `POCKET_RDEP_EVENT_ID_PARAM`. The two
 * are separate because capturing evidence is safe and counting money is not.
 */
export function isPocketRdepIngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return masterGateEnabled(env) && readsTrue(env, POCKET_RDEP_INGEST_ENABLED_KEY);
}

export type RedepositIdentityPolicy =
  | {
      /** No operator has asserted a provider event-identity contract. */
      readonly kind: "unavailable";
      readonly reason: "provider_event_identity_contract_absent" | "configured_param_rejected";
    }
  | { readonly kind: "available"; readonly parameterName: string };

/**
 * Whether this deployment may derive a canonical redeposit identity, and from
 * which parameter.
 *
 * A MALFORMED OR FORBIDDEN VALUE RESOLVES TO `unavailable`, NEVER TO A DEFAULT.
 * The failure mode being avoided is an operator typo silently selecting a field
 * that repeats across deposits — which would make two real redeposits collide on
 * one key and disappear.
 */
export function resolveRedepositIdentityPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RedepositIdentityPolicy {
  const raw = env[POCKET_RDEP_EVENT_ID_PARAM_KEY];

  if (raw === undefined || raw.trim() === "") {
    return { kind: "unavailable", reason: "provider_event_identity_contract_absent" };
  }

  const name = raw.trim().toLowerCase();

  if (!PARAM_NAME_SHAPE.test(name) || FORBIDDEN_EVENT_ID_PARAMS.has(name)) {
    return { kind: "unavailable", reason: "configured_param_rejected" };
  }

  return { kind: "available", parameterName: name };
}

/** A single snapshot for the ingress-health surface and for tests. */
export type PocketIngressSwitches = {
  readonly masterEnabled: boolean;
  readonly regEnabled: boolean;
  readonly depEnabled: boolean;
  readonly rdepEnabled: boolean;
  readonly redepositIdentity: RedepositIdentityPolicy;
};

export function readPocketIngressSwitches(
  env: NodeJS.ProcessEnv = process.env,
): PocketIngressSwitches {
  return {
    masterEnabled: masterGateEnabled(env),
    regEnabled: isPocketRegIngestEnabled(env),
    depEnabled: isPocketDepIngestEnabled(env),
    rdepEnabled: isPocketRdepIngestEnabled(env),
    redepositIdentity: resolveRedepositIdentityPolicy(env),
  };
}
