/**
 * AGENT-FOUNDATION-1 — the agent registry.
 *
 * WHY THIS IS SOURCE AND NOT A TABLE. An agent's code, version, execution mode
 * and capability set are reviewable artefacts. A row would let an operator
 * invent an agent at runtime that no review ever saw, and the database would
 * quietly become the source of agent identity. There is deliberately no
 * `AgentDefinition` model in `schema.prisma`, and a regression asserts its
 * absence.
 *
 * `AgentRun` stores `agentCode` and `agentVersion` as DENORMALISED STRINGS. A
 * run stays interpretable after this file moves on, which is the property that
 * makes a stored run auditable a year later.
 *
 * WHAT "reserved" MEANS. Three of the four agents below are named, versionless
 * and unrunnable. They are here so that the closed target list of
 * `AgentHandoff.targetAgentCode` is reviewable now, not so that anything can
 * execute them: `resolveAgentForExecution` refuses every one of them, and the
 * only way to change that is to edit this file under review.
 */

/* ------------------------------------------------------------------ codes */

/**
 * The COMPLETE set of agent identities the platform recognises.
 *
 * A code is a stable identifier. It may be added to; it may never be
 * repurposed, because stored `AgentRun` rows carry it verbatim.
 */
export const AGENT_CODES = [
  "curie_atlas",
  "curie_pulse",
  "curie_mentor",
  "curie_sentinel",
] as const;

export type AgentCode = (typeof AGENT_CODES)[number];

/* ------------------------------------------------------------------ modes */

/**
 * How an agent turns inputs into findings.
 *
 * All three exist in the schema so that adding a provider later is a review
 * decision rather than a migration under time pressure. Only `deterministic`
 * is permitted at runtime in this phase — see `EXECUTABLE_EXECUTION_MODES`.
 */
export const AGENT_EXECUTION_MODES = [
  "deterministic",
  "model_assisted",
  "model_only",
] as const;

export type AgentExecutionMode = (typeof AGENT_EXECUTION_MODES)[number];

/**
 * The modes current runtime policy will actually start a run in.
 *
 * This is the single place the model boundary is enforced for RUNS. It is
 * deliberately a one-element list rather than a boolean flag: adding a second
 * member is a visible diff in a reviewed file, and no environment variable,
 * request body or database row can widen it.
 */
export const EXECUTABLE_EXECUTION_MODES = ["deterministic"] as const;

export type ExecutableExecutionMode = (typeof EXECUTABLE_EXECUTION_MODES)[number];

/* --------------------------------------------------------- implementation */

/**
 * `available` — the agent has a reviewed implementation and may run.
 * `reserved` — the identity is claimed and nothing may execute it.
 */
export const AGENT_IMPLEMENTATION_STATUSES = ["available", "reserved"] as const;

export type AgentImplementationStatus = (typeof AGENT_IMPLEMENTATION_STATUSES)[number];

/* --------------------------------------------------------------- registry */

export type AgentDefinition = {
  readonly code: AgentCode;
  readonly displayName: string;
  /**
   * The published contract version, or `null` for a reserved agent.
   *
   * A reserved agent has no version ON PURPOSE. Inventing "0.0.0" for something
   * with no contract would let a caller pass a version string that validates
   * and means nothing.
   */
  readonly currentVersion: string | null;
  /** The mode this agent runs in today. `null` while reserved. */
  readonly currentMode: AgentExecutionMode | null;
  readonly implementationStatus: AgentImplementationStatus;
  /**
   * Whether this agent may cause an effect without a human decision.
   *
   * `false` for every agent, and there is no code path that reads it as `true`.
   * It is recorded per agent rather than as a global constant so that a future
   * phase proposing an exception has to state it here, against one named agent,
   * in a reviewed diff.
   */
  readonly automaticActionsAllowed: false;
  /** Why this agent exists, in one line, for the operator reading a run. */
  readonly purpose: string;
};

/**
 * The four agents, exactly.
 *
 * `curie_atlas` is the only one with an implementation: the accepted AFD-5D1
 * deterministic analysis engine, published at contract 1.0.0 by PRODUCT-RC-1.
 * Its version here MUST equal `CURIE_ATLAS_AGENT_VERSION` in
 * `src/lib/analysis/analysis-contract.ts`, and a regression asserts that rather
 * than trusting two hand-maintained copies to agree.
 */
export const AGENT_REGISTRY: Readonly<Record<AgentCode, AgentDefinition>> = {
  curie_atlas: {
    code: "curie_atlas",
    displayName: "Curie Atlas",
    currentVersion: "1.0.0",
    currentMode: "deterministic",
    implementationStatus: "available",
    automaticActionsAllowed: false,
    purpose:
      "Describes already-computed affiliate analytics aggregates as structured findings. States no cause, no forecast and no recommendation.",
  },
  curie_pulse: {
    code: "curie_pulse",
    displayName: "Curie Pulse",
    currentVersion: null,
    currentMode: null,
    implementationStatus: "reserved",
    automaticActionsAllowed: false,
    purpose:
      "Reserved for learner-engagement observation. No implementation, no retention decision and no message exists.",
  },
  curie_mentor: {
    code: "curie_mentor",
    displayName: "Curie Mentor",
    currentVersion: null,
    currentMode: null,
    implementationStatus: "reserved",
    automaticActionsAllowed: false,
    purpose:
      "Reserved for mentor-side support. No feedback is generated, stored or delivered in this phase.",
  },
  curie_sentinel: {
    code: "curie_sentinel",
    displayName: "Curie Sentinel",
    currentVersion: null,
    currentMode: null,
    implementationStatus: "reserved",
    automaticActionsAllowed: false,
    purpose:
      "Reserved for evaluating other agents' output. No evaluation runtime and no grader exists in this phase.",
  },
} as const;

/* ------------------------------------------------------------ error codes */

/**
 * Stable rejection codes. A caller branches on these, never on a message.
 */
export const AGENT_REGISTRY_ERROR_CODES = [
  "AGENT_UNKNOWN",
  "AGENT_NOT_IMPLEMENTED",
  "AGENT_VERSION_MISMATCH",
  "AGENT_MODE_UNSUPPORTED",
  "AGENT_MODE_NOT_EXECUTABLE",
] as const;

export type AgentRegistryErrorCode = (typeof AGENT_REGISTRY_ERROR_CODES)[number];

export class AgentRegistryError extends Error {
  readonly code: AgentRegistryErrorCode;

  constructor(code: AgentRegistryErrorCode, message: string) {
    super(message);
    this.name = "AgentRegistryError";
    this.code = code;
  }
}

/* -------------------------------------------------------------- accessors */

export function isAgentCode(value: unknown): value is AgentCode {
  return typeof value === "string" && (AGENT_CODES as readonly string[]).includes(value);
}

export function isAgentExecutionMode(value: unknown): value is AgentExecutionMode {
  return (
    typeof value === "string" &&
    (AGENT_EXECUTION_MODES as readonly string[]).includes(value)
  );
}

/** Look an agent up without asserting anything about whether it can run. */
export function findAgent(code: unknown): AgentDefinition | null {
  return isAgentCode(code) ? AGENT_REGISTRY[code] : null;
}

/** Every agent, in the canonical declaration order. */
export function listAgents(): readonly AgentDefinition[] {
  return AGENT_CODES.map((code) => AGENT_REGISTRY[code]);
}

/**
 * The one gate every run creation passes through.
 *
 * FAILS CLOSED on all five axes: an unknown code, a reserved agent, a version
 * that is not the registered one, a mode that is not in the enum at all, and a
 * mode that is in the enum but not currently executable. The last two are
 * separate codes on purpose — `model_only` is a REAL mode that is DISABLED,
 * and reporting it as "unsupported" would hide that distinction from the
 * operator reading the rejection.
 */
export function resolveAgentForExecution(input: {
  readonly agentCode: unknown;
  readonly agentVersion: unknown;
  readonly executionMode: unknown;
}): {
  readonly definition: AgentDefinition;
  readonly agentCode: AgentCode;
  readonly agentVersion: string;
  readonly executionMode: ExecutableExecutionMode;
} {
  const definition = findAgent(input.agentCode);

  if (!definition) {
    throw new AgentRegistryError(
      "AGENT_UNKNOWN",
      `Unknown agent code. The registry is closed and source-owned; it holds exactly: ${AGENT_CODES.join(", ")}.`,
    );
  }

  if (definition.implementationStatus !== "available") {
    throw new AgentRegistryError(
      "AGENT_NOT_IMPLEMENTED",
      `Agent ${definition.code} is reserved. It has an identity but no implementation, and nothing may execute it.`,
    );
  }

  if (
    definition.currentVersion === null ||
    input.agentVersion !== definition.currentVersion
  ) {
    throw new AgentRegistryError(
      "AGENT_VERSION_MISMATCH",
      `Agent ${definition.code} is registered at version ${definition.currentVersion ?? "none"}. A run must pin the registered version exactly.`,
    );
  }

  if (!isAgentExecutionMode(input.executionMode)) {
    throw new AgentRegistryError(
      "AGENT_MODE_UNSUPPORTED",
      `Unsupported execution mode. Legal modes are: ${AGENT_EXECUTION_MODES.join(", ")}.`,
    );
  }

  if (
    !(EXECUTABLE_EXECUTION_MODES as readonly string[]).includes(input.executionMode)
  ) {
    throw new AgentRegistryError(
      "AGENT_MODE_NOT_EXECUTABLE",
      `Execution mode ${input.executionMode} is a legal schema value but is not executable: no model provider is selected. Executable modes: ${EXECUTABLE_EXECUTION_MODES.join(", ")}.`,
    );
  }

  if (input.executionMode !== definition.currentMode) {
    throw new AgentRegistryError(
      "AGENT_MODE_UNSUPPORTED",
      `Agent ${definition.code} is registered in mode ${definition.currentMode ?? "none"} and cannot run as ${input.executionMode}.`,
    );
  }

  return {
    definition,
    agentCode: definition.code,
    agentVersion: definition.currentVersion,
    executionMode: input.executionMode as ExecutableExecutionMode,
  };
}

/**
 * The gate for naming an agent as a HANDOFF TARGET.
 *
 * Deliberately weaker than `resolveAgentForExecution`: a handoff to a reserved
 * agent is legal, because proposing one is exactly how a future phase learns
 * what `curie_pulse` would have been asked. It is inert — nothing consumes a
 * handoff in this phase — and accepting one still requires the target to be
 * executable, which no reserved agent is.
 *
 * A target VERSION, when given, must match the registered one; a reserved agent
 * therefore accepts only `null`.
 */
export function resolveHandoffTarget(input: {
  readonly targetAgentCode: unknown;
  readonly targetAgentVersion: unknown;
}): {
  readonly definition: AgentDefinition;
  readonly targetAgentCode: AgentCode;
  readonly targetAgentVersion: string | null;
} {
  const definition = findAgent(input.targetAgentCode);

  if (!definition) {
    throw new AgentRegistryError(
      "AGENT_UNKNOWN",
      `Unknown handoff target. The registry is closed and source-owned; it holds exactly: ${AGENT_CODES.join(", ")}.`,
    );
  }

  if (input.targetAgentVersion === null || input.targetAgentVersion === undefined) {
    return {
      definition,
      targetAgentCode: definition.code,
      targetAgentVersion: null,
    };
  }

  if (
    typeof input.targetAgentVersion !== "string" ||
    input.targetAgentVersion !== definition.currentVersion
  ) {
    throw new AgentRegistryError(
      "AGENT_VERSION_MISMATCH",
      `Agent ${definition.code} is registered at version ${definition.currentVersion ?? "none"}. A pinned handoff target version must match it exactly.`,
    );
  }

  return {
    definition,
    targetAgentCode: definition.code,
    targetAgentVersion: input.targetAgentVersion,
  };
}
