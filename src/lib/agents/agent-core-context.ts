/**
 * AGENT-FOUNDATION-1 — the internal execution context.
 *
 * EVERY Agent Core write service requires one of these. It cannot be
 * constructed by a learner, by CRM staff, or from an HTTP request, and there is
 * no route anywhere in this phase that produces one.
 *
 * WHY A BRANDED OBJECT RATHER THAN A PERMISSION CHECK. A permission check
 * answers "is this caller allowed to do this". That is the wrong question here,
 * because the answer for every human caller in this phase is NO — the Agent
 * Core has no public surface at all. What must be enforced is stronger: that
 * the call originated INSIDE the server, from a reviewed code path, and not
 * from anything a request could reach. A brand carried on an object that
 * request-handling code cannot mint expresses exactly that, and it fails closed
 * by construction rather than by remembering to check.
 *
 * HOW THE BRAND WORKS. `INTERNAL_BRAND` is a module-private symbol. It is not
 * exported, so no other module can write an object literal carrying it, and a
 * plain object, a JSON body, a parsed cookie or a deserialized session can
 * never satisfy `assertInternalContext`. The only way to obtain a context is
 * `createInternalAgentContext`, which is itself gated on a closed origin list.
 */

import {
  AGENT_TRIGGER_TYPES,
  EXECUTABLE_TRIGGER_TYPES,
  type AgentTriggerType,
} from "./agent-core-contract";

/* -------------------------------------------------------------- the brand */

const INTERNAL_BRAND = Symbol("ata.agent-core.internal-context");

/* ------------------------------------------------------------------ origins */

/**
 * Where an internal context may come from.
 *
 * `internal_service` — a reviewed server-side module.
 * `regression_harness` — the test suites, which must exercise the real service
 *   rather than a parallel mock, or the tests would prove nothing about it.
 *
 * The list is deliberately short. Every member is a code path a reviewer can
 * enumerate, which is the property that makes the boundary checkable.
 */
export const INTERNAL_CONTEXT_ORIGINS = [
  "internal_service",
  "regression_harness",
] as const;

export type InternalContextOrigin = (typeof INTERNAL_CONTEXT_ORIGINS)[number];

/**
 * Origins that are NAMED so they can be REFUSED.
 *
 * A caller reaching for one of these is not making a mistake about a value —
 * it is trying to give a request the authority of the server. Naming them
 * produces a specific rejection code instead of a generic "unknown origin",
 * which is the difference between a log line an operator can act on and one
 * they cannot.
 */
export const FORBIDDEN_CONTEXT_ORIGINS = [
  "http_request",
  "learner_session",
  "crm_session",
  "public_api",
  "webhook",
] as const;

/* -------------------------------------------------------------- error codes */

export const AGENT_CONTEXT_ERROR_CODES = [
  "AGENT_CONTEXT_REQUIRED",
  "AGENT_CONTEXT_FORGED",
  "AGENT_CONTEXT_ORIGIN_FORBIDDEN",
  "AGENT_CONTEXT_ORIGIN_UNKNOWN",
  "AGENT_CONTEXT_ACTOR_INVALID",
  "AGENT_TRIGGER_NOT_EXECUTABLE",
] as const;

export type AgentContextErrorCode = (typeof AGENT_CONTEXT_ERROR_CODES)[number];

export class AgentContextError extends Error {
  readonly code: AgentContextErrorCode;

  constructor(code: AgentContextErrorCode, message: string) {
    super(message);
    this.name = "AgentContextError";
    this.code = code;
  }
}

/* ------------------------------------------------------------- the context */

export type InternalAgentContext = {
  readonly origin: InternalContextOrigin;
  /**
   * The canonical CRM staff identity acting, when a human is acting.
   *
   * `null` for a future system run. It is NOT an authorisation token: holding a
   * staff id here grants nothing, because there is no route that accepts one.
   * It is recorded so a run has an accountable initiator.
   */
  readonly actorStaffId: string | null;
  /** Correlates every row this context writes with the causing request. */
  readonly requestId: string;
  /** Fixed at creation so every row in one unit of work shares a timestamp. */
  readonly now: Date;
};

type BrandedInternalAgentContext = InternalAgentContext & {
  readonly [INTERNAL_BRAND]: true;
};

/**
 * The ONLY way to obtain an internal context.
 *
 * Note what this function does NOT do: it does not read a session, a cookie, a
 * header or an environment variable, and it takes no credential. It cannot be
 * tricked into promoting a request, because it has no input that a request
 * controls other than the origin — which it validates against a closed list.
 */
export function createInternalAgentContext(input: {
  readonly origin: string;
  readonly actorStaffId?: string | null;
  readonly requestId: string;
  readonly now?: Date;
}): InternalAgentContext {
  if ((FORBIDDEN_CONTEXT_ORIGINS as readonly string[]).includes(input.origin)) {
    throw new AgentContextError(
      "AGENT_CONTEXT_ORIGIN_FORBIDDEN",
      `Origin "${input.origin}" may never construct an Agent Core execution context. Agent Core has no public surface: a learner, a CRM session and an HTTP request all lack the authority to write to it.`,
    );
  }

  if (!(INTERNAL_CONTEXT_ORIGINS as readonly string[]).includes(input.origin)) {
    throw new AgentContextError(
      "AGENT_CONTEXT_ORIGIN_UNKNOWN",
      `Unknown Agent Core context origin "${input.origin}". Legal origins: ${INTERNAL_CONTEXT_ORIGINS.join(", ")}.`,
    );
  }

  const actorStaffId = input.actorStaffId ?? null;

  if (actorStaffId !== null) {
    if (
      typeof actorStaffId !== "string" ||
      actorStaffId.length === 0 ||
      actorStaffId.length > 64 ||
      /\s/u.test(actorStaffId)
    ) {
      throw new AgentContextError(
        "AGENT_CONTEXT_ACTOR_INVALID",
        "actorStaffId must be a bounded, whitespace-free canonical staff identity, or null for a system run.",
      );
    }
  }

  if (
    typeof input.requestId !== "string" ||
    input.requestId.length === 0 ||
    input.requestId.length > 64 ||
    /[\s/?&@]/u.test(input.requestId)
  ) {
    throw new AgentContextError(
      "AGENT_CONTEXT_ACTOR_INVALID",
      "requestId must be a bounded opaque correlation id. It is never a URL and never a query string.",
    );
  }

  const context = {
    origin: input.origin as InternalContextOrigin,
    actorStaffId,
    requestId: input.requestId,
    now: input.now ?? new Date(),
  };

  // THE BRAND IS NON-ENUMERABLE, and that is not a detail.
  //
  // An enumerable symbol property is copied by object spread, so `{ ...ctx }`
  // would produce a second object that passes `assertInternalContext`. Defined
  // this way it is not: spread drops it, `Object.assign` drops it,
  // `structuredClone` drops it and JSON has never carried it. The ONLY object
  // that satisfies the gate is the one this factory returned, which is what
  // makes "server-owned" a property of identity rather than of shape.
  Object.defineProperty(context, INTERNAL_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(context) as BrandedInternalAgentContext;
}

/**
 * The gate every write service calls first.
 *
 * Rejects `undefined`, `null`, a plain object, a parsed JSON body, a session
 * object and anything else that did not come out of
 * `createInternalAgentContext` — because none of them carries the module-private
 * brand.
 */
export function assertInternalContext(value: unknown): InternalAgentContext {
  if (value === null || typeof value !== "object") {
    throw new AgentContextError(
      "AGENT_CONTEXT_REQUIRED",
      "An Agent Core write requires a server-owned internal execution context.",
    );
  }

  if ((value as Record<PropertyKey, unknown>)[INTERNAL_BRAND] !== true) {
    throw new AgentContextError(
      "AGENT_CONTEXT_FORGED",
      "The supplied object is not a server-owned Agent Core execution context. It was not produced by createInternalAgentContext, so it cannot carry the internal brand.",
    );
  }

  return value as InternalAgentContext;
}

/**
 * Refuse a trigger type that has no implementation behind it.
 *
 * `scheduled`, `handoff` and `system` are legal SCHEMA values with no runtime:
 * there is no scheduler, no handoff consumer and no system caller in this
 * phase. Accepting one would create a run that claims to have been caused by
 * machinery that does not exist.
 */
export function assertTriggerIsExecutable(
  triggerType: unknown,
): AgentTriggerType {
  if (
    typeof triggerType !== "string" ||
    !(AGENT_TRIGGER_TYPES as readonly string[]).includes(triggerType)
  ) {
    throw new AgentContextError(
      "AGENT_TRIGGER_NOT_EXECUTABLE",
      `Unknown trigger type. Legal types: ${AGENT_TRIGGER_TYPES.join(", ")}.`,
    );
  }

  if (!(EXECUTABLE_TRIGGER_TYPES as readonly string[]).includes(triggerType)) {
    throw new AgentContextError(
      "AGENT_TRIGGER_NOT_EXECUTABLE",
      `Trigger type "${triggerType}" is a legal schema value with no runtime behind it: this phase implements no scheduler, no handoff consumer and no system caller. Executable triggers: ${EXECUTABLE_TRIGGER_TYPES.join(", ")}.`,
    );
  }

  return triggerType as AgentTriggerType;
}
