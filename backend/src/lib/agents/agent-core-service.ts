/**
 * AGENT-FOUNDATION-1 — the Agent Core write services.
 *
 * THE ONLY WAY TO WRITE TO THE NINE AGENT CORE TABLES. There is no public
 * route, no CRM screen and no learner surface that reaches any of it: every
 * function below demands a server-owned internal execution context that request
 * handling code cannot construct.
 *
 * APPEND-ORIENTED, DELIBERATELY. This module exposes no broad update API and no
 * delete API at all. Findings, evidence, decisions and terminal executions are
 * immutable once written. The only mutation anywhere is a status transition
 * along an edge declared in `agent-core-contract.ts`, performed as a
 * COMPARE-AND-SWAP: the update names the status it expects to replace, so an
 * illegal transition and a lost race both fail without mutating anything, and
 * neither depends on the service winning a check-then-write gap.
 *
 * WHAT CANNOT HAPPEN HERE, and where each is enforced:
 *
 *   • a model is called — `invokeModel` throws MODEL_PROVIDER_DISABLED before
 *     touching the database, because the provider registry is an empty array;
 *   • an action is executed — `startActionExecution` throws
 *     EXECUTION_PROVIDER_DISABLED for the same reason;
 *   • an action is approved without a human — the decision service demands a
 *     staff id and the column is NOT NULL;
 *   • a finding without evidence is stored — the write is one transaction and
 *     the evidence is part of it;
 *   • PII, a secret, a prompt or a provider payload enters a JSON column —
 *     `agent-payload-policy.ts` validates every one of them at write time.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  AGENT_ACTION_CLASSES,
  AGENT_ACTION_CHANNELS,
  AGENT_ACTION_TRANSITIONS,
  AGENT_DECISIONS,
  AGENT_EVALUATION_RESULTS,
  AGENT_EVALUATION_TARGET_TYPES,
  AGENT_EVIDENCE_DOMAINS,
  AGENT_FINDING_SEVERITIES,
  AGENT_FINDING_TRANSITIONS,
  AGENT_HANDOFF_CODES,
  AGENT_RUN_TRANSITIONS,
  AGENT_SUBJECT_TYPES,
  AGENT_SUPPORT_TIERS,
  ENABLED_EVALUATOR_TYPES,
  ENABLED_EXECUTION_PROVIDERS,
  ENABLED_MODEL_PROVIDERS,
  IMPLEMENTED_EVIDENCE_DOMAINS,
  MODEL_PROVIDER_DISABLED,
  TERMINAL_RUN_STATUSES,
  type AgentActionChannel,
  type AgentActionClass,
  type AgentActionStatus,
  type AgentDecision,
  type AgentEvaluationResult,
  type AgentEvaluationTargetType,
  type AgentEvidenceDomain,
  type AgentFindingSeverity,
  type AgentFindingStatus,
  type AgentRunStatus,
  type AgentSubjectType,
  type AgentSupportTier,
} from "./agent-core-contract";
import {
  assertInternalContext,
  assertTriggerIsExecutable,
} from "./agent-core-context";
import {
  ACTION_PARAMETER_SCHEMAS,
  AgentPayloadError,
  EVALUATION_EVIDENCE_SCHEMA,
  EVIDENCE_OBSERVED_VALUE_SCHEMA,
  FINDING_OPERAND_SCHEMAS,
  HANDOFF_PAYLOAD_SCHEMAS,
  assertOpaqueReference,
  validatePayload,
  type PayloadSchema,
} from "./agent-payload-policy";
import { resolveAgentForExecution, resolveHandoffTarget } from "./agent-registry";

/* ------------------------------------------------------------ error codes */

export const AGENT_CORE_ERROR_CODES = [
  "AGENT_RUN_SUBJECT_INVALID",
  "AGENT_RUN_NOT_FOUND",
  "AGENT_RUN_TRANSITION_ILLEGAL",
  "AGENT_RUN_TRANSITION_LOST",
  "AGENT_RUN_TERMINAL",
  "AGENT_FINDING_CODE_UNKNOWN",
  "AGENT_FINDING_EVIDENCE_REQUIRED",
  "AGENT_FINDING_SEVERITY_INVALID",
  "AGENT_FINDING_TRANSITION_ILLEGAL",
  "AGENT_FINDING_IMMUTABLE",
  "AGENT_EVIDENCE_DOMAIN_UNSUPPORTED",
  "AGENT_HANDOFF_CODE_UNKNOWN",
  "AGENT_HANDOFF_DUPLICATE",
  "AGENT_ACTION_CLASS_FORBIDDEN",
  "AGENT_ACTION_CHANNEL_INVALID",
  "AGENT_ACTION_APPROVAL_REQUIRED",
  "AGENT_ACTION_DUPLICATE",
  "AGENT_ACTION_NOT_FOUND",
  "AGENT_DECISION_ACTOR_REQUIRED",
  "AGENT_DECISION_DUPLICATE",
  "AGENT_DECISION_INVALID",
  "EXECUTION_PROVIDER_DISABLED",
  "AGENT_EVALUATOR_DISABLED",
  "AGENT_EVALUATION_TARGET_INVALID",
  "MODEL_PROVIDER_DISABLED",
] as const;

export type AgentCoreErrorCode = (typeof AGENT_CORE_ERROR_CODES)[number];

export class AgentCoreError extends Error {
  readonly code: AgentCoreErrorCode;

  constructor(code: AgentCoreErrorCode, message: string) {
    super(message);
    this.name = "AgentCoreError";
    this.code = code;
  }
}

/* --------------------------------------------------------------- helpers */

/** Prisma's unique-constraint failure, which the idempotency paths expect. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Validate the subject pair.
 *
 * BOTH OR NEITHER. A run carrying a subject type and no reference is not a
 * global run and not a subject-scoped one either — it is an answer about an
 * unspecified thing. The database enforces the same rule with a CHECK
 * constraint, so a caller bypassing this service still cannot store one.
 */
function normalizeSubject(input: {
  readonly subjectType?: unknown;
  readonly subjectRef?: unknown;
}): { subjectType: AgentSubjectType | null; subjectRef: string | null } {
  const hasType = input.subjectType !== undefined && input.subjectType !== null;
  const hasRef = input.subjectRef !== undefined && input.subjectRef !== null;

  if (!hasType && !hasRef) {
    return { subjectType: null, subjectRef: null };
  }

  if (hasType !== hasRef) {
    throw new AgentCoreError(
      "AGENT_RUN_SUBJECT_INVALID",
      "subjectType and subjectRef must both be absent (a global run) or both be present (a subject-scoped run).",
    );
  }

  if (
    typeof input.subjectType !== "string" ||
    !(AGENT_SUBJECT_TYPES as readonly string[]).includes(input.subjectType)
  ) {
    throw new AgentCoreError(
      "AGENT_RUN_SUBJECT_INVALID",
      `Unsupported subject type. The list is closed: ${AGENT_SUBJECT_TYPES.join(", ")}.`,
    );
  }

  if (typeof input.subjectRef !== "string") {
    throw new AgentCoreError(
      "AGENT_RUN_SUBJECT_INVALID",
      "subjectRef must be an internal opaque reference string.",
    );
  }

  return {
    subjectType: input.subjectType as AgentSubjectType,
    subjectRef: assertOpaqueReference("subjectRef", input.subjectRef),
  };
}

/** Reject a transition that is not an edge of the declared state graph. */
function assertLegalTransition<S extends string>(
  graph: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
  errorCode: AgentCoreErrorCode,
  what: string,
): void {
  const allowed = graph[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AgentCoreError(
      errorCode,
      `Illegal ${what} transition ${from} -> ${to}. Legal targets from ${from}: ${allowed.length > 0 ? allowed.join(", ") : "none, it is terminal"}.`,
    );
  }
}

/* ================================================================== RUNS */

export type CreateAgentRunInput = {
  readonly agentCode: string;
  readonly agentVersion: string;
  readonly executionMode: string;
  readonly triggerType: string;
  readonly inputFingerprint: string;
  readonly idempotencyKey?: string | null;
  readonly subjectType?: AgentSubjectType | null;
  readonly subjectRef?: string | null;
  readonly engineVersion?: string | null;
  readonly catalogVersion?: string | null;
};

export type CreateAgentRunResult = {
  readonly runId: string;
  /**
   * `true` when an existing run was returned because its idempotency key
   * already existed. The caller has done no new work and must not assume it
   * owns the run's lifecycle.
   */
  readonly reused: boolean;
};

/**
 * Create one bounded execution attempt.
 *
 * IDEMPOTENCY IS RESOLVED BY THE DATABASE, not by a prior read. A check-then-
 * insert would leave a window in which two concurrent callers both see nothing
 * and both insert; instead the insert is attempted and a unique violation is
 * translated into "return the existing run". That is why the contract can say
 * "the same logical question, asked twice, returns the first run" without
 * qualification.
 */
export async function createAgentRun(
  context: unknown,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  const ctx = assertInternalContext(context);
  const triggerType = assertTriggerIsExecutable(input.triggerType);

  // The registry gate: unknown agent, reserved agent, wrong version,
  // unsupported mode and non-executable mode all fail here, before any write.
  const resolved = resolveAgentForExecution({
    agentCode: input.agentCode,
    agentVersion: input.agentVersion,
    executionMode: input.executionMode,
  });

  const subject = normalizeSubject(input);

  const idempotencyKey =
    input.idempotencyKey === undefined || input.idempotencyKey === null
      ? null
      : assertOpaqueReference("idempotencyKey", input.idempotencyKey);

  const inputFingerprint = String(input.inputFingerprint ?? "");
  if (!/^[a-f0-9]{8,64}$/u.test(inputFingerprint)) {
    throw new AgentCoreError(
      "AGENT_RUN_SUBJECT_INVALID",
      "inputFingerprint must be 8..64 lowercase hex characters: a hash of the RESOLVED question, never the raw request.",
    );
  }

  try {
    const run = await prisma.agentRun.create({
      data: {
        agentCode: resolved.agentCode,
        agentVersion: resolved.agentVersion,
        executionMode: resolved.executionMode,
        triggerType,
        status: "created",
        engineVersion: input.engineVersion ?? null,
        catalogVersion: input.catalogVersion ?? null,
        requestId: ctx.requestId,
        inputFingerprint,
        idempotencyKey,
        subjectType: subject.subjectType,
        subjectRef: subject.subjectRef,
        initiatedByStaffId: ctx.actorStaffId,
        createdAt: ctx.now,
      },
      select: { id: true },
    });

    return { runId: run.id, reused: false };
  } catch (error) {
    if (idempotencyKey !== null && isUniqueViolation(error)) {
      const existing = await prisma.agentRun.findFirst({
        where: { agentCode: resolved.agentCode, idempotencyKey },
        select: { id: true },
      });

      if (existing) {
        return { runId: existing.id, reused: true };
      }
    }

    throw error;
  }
}

/**
 * Move a run from one status to another.
 *
 * COMPARE-AND-SWAP. `updateMany` with the expected status in its WHERE clause
 * either affects exactly one row or none. Zero rows means somebody else already
 * moved it — a lost race, reported as such — and no partial write happened
 * either way. This is the whole concurrency story for runs, and it needs no
 * version column because a status is never permitted to transition to itself.
 */
export async function transitionAgentRun(
  context: unknown,
  input: {
    readonly runId: string;
    readonly from: AgentRunStatus;
    readonly to: AgentRunStatus;
    readonly failureCode?: string | null;
    readonly findingCount?: number;
    readonly warningCount?: number;
  },
): Promise<{ readonly status: AgentRunStatus }> {
  const ctx = assertInternalContext(context);

  assertLegalTransition(
    AGENT_RUN_TRANSITIONS,
    input.from,
    input.to,
    "AGENT_RUN_TRANSITION_ILLEGAL",
    "run",
  );

  const data: Prisma.AgentRunUpdateManyMutationInput = { status: input.to };

  if (input.to === "running") {
    data.startedAt = ctx.now;
  }
  if (input.to === "completed") {
    data.completedAt = ctx.now;
    if (input.findingCount !== undefined) data.findingCount = input.findingCount;
    if (input.warningCount !== undefined) data.warningCount = input.warningCount;
  }
  if (input.to === "failed") {
    data.failedAt = ctx.now;
    data.failureCode = input.failureCode ?? "unspecified";
  }
  if (input.to === "cancelled") {
    data.completedAt = ctx.now;
  }

  const updated = await prisma.agentRun.updateMany({
    where: { id: input.runId, status: input.from },
    data,
  });

  if (updated.count === 1) {
    return { status: input.to };
  }

  // Nothing moved. Distinguish "no such run" from "somebody else won" so the
  // caller learns which, rather than retrying a run that does not exist.
  const current = await prisma.agentRun.findUnique({
    where: { id: input.runId },
    select: { status: true },
  });

  if (!current) {
    throw new AgentCoreError(
      "AGENT_RUN_NOT_FOUND",
      `No agent run ${input.runId}.`,
    );
  }

  if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(current.status)) {
    throw new AgentCoreError(
      "AGENT_RUN_TERMINAL",
      `Run ${input.runId} is already terminal at ${current.status}. A terminal run is finished forever and nothing may move it again.`,
    );
  }

  throw new AgentCoreError(
    "AGENT_RUN_TRANSITION_LOST",
    `Run ${input.runId} was expected at ${input.from} but is at ${current.status}: a concurrent transition won and this one mutated nothing.`,
  );
}

/* ============================================================== FINDINGS */

export type EvidenceInput = {
  readonly sourceDomain: AgentEvidenceDomain;
  readonly sourceType: string;
  readonly sourceRef: string;
  readonly fieldPath: string;
  readonly sourceVersion?: string | null;
  readonly sourceFingerprint?: string | null;
  readonly observedValue?: unknown;
};

export type RecordFindingInput = {
  readonly runId: string;
  readonly findingKey: string;
  readonly code: string;
  readonly category: string;
  readonly severity: AgentFindingSeverity;
  readonly messageKey: string;
  readonly operands: unknown;
  readonly supportTier: AgentSupportTier;
  readonly expiresAt?: Date | null;
  readonly evidence: readonly EvidenceInput[];
};

/**
 * Write one structured finding together with all of its evidence.
 *
 * ONE TRANSACTION, ON PURPOSE. A finding with zero evidence rows is exactly the
 * unsupported claim this design exists to prevent, so it must not be possible
 * for one to exist even transiently — not even in the window between two
 * successful writes, and not at all if the second write fails.
 *
 * The finding's CONTENT is immutable after this returns. There is no update
 * path for `code`, `operandsJson`, `severity`, `messageKey` or evidence
 * anywhere in this module.
 */
export async function recordFinding(
  context: unknown,
  input: RecordFindingInput,
): Promise<{ readonly findingId: string }> {
  const ctx = assertInternalContext(context);

  const schema: PayloadSchema | undefined = FINDING_OPERAND_SCHEMAS[input.code];
  if (!schema) {
    throw new AgentCoreError(
      "AGENT_FINDING_CODE_UNKNOWN",
      `Unknown finding code "${input.code}". The catalog is closed and each code carries its own operand schema.`,
    );
  }

  if (!(AGENT_FINDING_SEVERITIES as readonly string[]).includes(input.severity)) {
    throw new AgentCoreError(
      "AGENT_FINDING_SEVERITY_INVALID",
      `Unknown severity. Legal severities: ${AGENT_FINDING_SEVERITIES.join(", ")}.`,
    );
  }

  if (!(AGENT_SUPPORT_TIERS as readonly string[]).includes(input.supportTier)) {
    throw new AgentCoreError(
      "AGENT_FINDING_SEVERITY_INVALID",
      `Unknown support tier. Legal tiers: ${AGENT_SUPPORT_TIERS.join(", ")}.`,
    );
  }

  const operands = validatePayload(schema, input.operands);

  // A statement whose numbers cannot be traced back to a stored value is a
  // fabrication. `insufficient` is the one tier that legitimately has nothing
  // to cite, because its whole content is "there was not enough data".
  if (input.supportTier !== "insufficient" && input.evidence.length === 0) {
    throw new AgentCoreError(
      "AGENT_FINDING_EVIDENCE_REQUIRED",
      `A ${input.supportTier} finding must cite at least one evidence reference. Only an "insufficient" finding may cite none.`,
    );
  }

  const evidenceRows = input.evidence.map((evidence) => {
    if (
      !(AGENT_EVIDENCE_DOMAINS as readonly string[]).includes(evidence.sourceDomain)
    ) {
      throw new AgentCoreError(
        "AGENT_EVIDENCE_DOMAIN_UNSUPPORTED",
        `Unknown evidence domain "${evidence.sourceDomain}". The list is closed.`,
      );
    }

    if (
      !(IMPLEMENTED_EVIDENCE_DOMAINS as readonly string[]).includes(
        evidence.sourceDomain,
      )
    ) {
      throw new AgentCoreError(
        "AGENT_EVIDENCE_DOMAIN_UNSUPPORTED",
        `Evidence domain "${evidence.sourceDomain}" is declared in the schema but has no accepted owner to re-read from today. Implemented domains: ${IMPLEMENTED_EVIDENCE_DOMAINS.join(", ")}.`,
      );
    }

    return {
      sourceDomain: evidence.sourceDomain,
      sourceType: evidence.sourceType,
      sourceRef: assertOpaqueReference("sourceRef", evidence.sourceRef),
      fieldPath: evidence.fieldPath,
      sourceVersion: evidence.sourceVersion ?? null,
      sourceFingerprint: evidence.sourceFingerprint ?? null,
      observedValueJson:
        evidence.observedValue === undefined || evidence.observedValue === null
          ? Prisma.DbNull
          : (validatePayload(
              EVIDENCE_OBSERVED_VALUE_SCHEMA,
              evidence.observedValue,
            ) as Prisma.InputJsonValue),
      createdAt: ctx.now,
    };
  });

  const finding = await prisma.$transaction(async (tx) => {
    const created = await tx.agentFinding.create({
      data: {
        runId: input.runId,
        findingKey: input.findingKey,
        code: input.code,
        category: input.category,
        severity: input.severity,
        messageKey: input.messageKey,
        operandsJson: operands as Prisma.InputJsonValue,
        operandsSchemaVersion: schema.version,
        supportTier: input.supportTier,
        status: "active",
        expiresAt: input.expiresAt ?? null,
        createdAt: ctx.now,
      },
      select: { id: true },
    });

    for (const row of evidenceRows) {
      await tx.agentEvidenceReference.create({
        data: { ...row, findingId: created.id },
      });
    }

    return created;
  });

  return { findingId: finding.id };
}

/**
 * Move a finding's STATUS. Its content stays immutable.
 *
 * Same compare-and-swap discipline as a run, and the same reason: there is no
 * path back to `active`, so a withdrawn statement stays withdrawn and
 * re-asserting it means a new run producing a new finding.
 */
export async function transitionFinding(
  context: unknown,
  input: {
    readonly findingId: string;
    readonly from: AgentFindingStatus;
    readonly to: AgentFindingStatus;
  },
): Promise<{ readonly status: AgentFindingStatus }> {
  assertInternalContext(context);

  assertLegalTransition(
    AGENT_FINDING_TRANSITIONS,
    input.from,
    input.to,
    "AGENT_FINDING_TRANSITION_ILLEGAL",
    "finding",
  );

  const updated = await prisma.agentFinding.updateMany({
    where: { id: input.findingId, status: input.from },
    data: { status: input.to },
  });

  if (updated.count !== 1) {
    throw new AgentCoreError(
      "AGENT_FINDING_TRANSITION_ILLEGAL",
      `Finding ${input.findingId} was not at ${input.from}: nothing was mutated.`,
    );
  }

  return { status: input.to };
}

/* ============================================================== HANDOFFS */

/**
 * Propose a structured request from this run to another agent.
 *
 * INERT. Nothing in this phase consumes a handoff, no background worker exists,
 * and no target run is ever created from one. A handoff to a RESERVED agent is
 * deliberately legal — proposing one is how a future phase learns what
 * `curie_pulse` would have been asked — and it stays inert because accepting
 * one would require the target to be executable, which no reserved agent is.
 */
export async function proposeHandoff(
  context: unknown,
  input: {
    readonly sourceRunId: string;
    readonly targetAgentCode: string;
    readonly targetAgentVersion?: string | null;
    readonly handoffCode: string;
    readonly payload: unknown;
    readonly deduplicationKey?: string | null;
    readonly expiresAt?: Date | null;
  },
): Promise<{ readonly handoffId: string; readonly reused: boolean }> {
  const ctx = assertInternalContext(context);

  const target = resolveHandoffTarget({
    targetAgentCode: input.targetAgentCode,
    targetAgentVersion: input.targetAgentVersion ?? null,
  });

  if (!(AGENT_HANDOFF_CODES as readonly string[]).includes(input.handoffCode)) {
    throw new AgentCoreError(
      "AGENT_HANDOFF_CODE_UNKNOWN",
      `Unknown handoff code "${input.handoffCode}". Legal codes: ${AGENT_HANDOFF_CODES.join(", ")}.`,
    );
  }

  const schema = HANDOFF_PAYLOAD_SCHEMAS[input.handoffCode];
  const payload = validatePayload(schema, input.payload);

  const deduplicationKey =
    input.deduplicationKey === undefined || input.deduplicationKey === null
      ? null
      : assertOpaqueReference("deduplicationKey", input.deduplicationKey);

  try {
    const handoff = await prisma.agentHandoff.create({
      data: {
        sourceRunId: input.sourceRunId,
        targetAgentCode: target.targetAgentCode,
        targetAgentVersion: target.targetAgentVersion,
        handoffCode: input.handoffCode,
        payloadJson: payload as Prisma.InputJsonValue,
        payloadSchemaVersion: schema.version,
        deduplicationKey,
        status: "proposed",
        expiresAt: input.expiresAt ?? null,
        createdAt: ctx.now,
      },
      select: { id: true },
    });

    return { handoffId: handoff.id, reused: false };
  } catch (error) {
    if (deduplicationKey !== null && isUniqueViolation(error)) {
      const existing = await prisma.agentHandoff.findFirst({
        where: { deduplicationKey },
        select: { id: true },
      });

      if (existing) {
        return { handoffId: existing.id, reused: true };
      }
    }

    throw error;
  }
}

/* ============================================================ PROPOSALS */

/**
 * Propose an action. It is INERT until a human decides it.
 *
 * `requiresHumanApproval` is not a parameter. There is no way for a caller to
 * request an auto-approved proposal, the column has a CHECK constraint
 * permitting exactly one value, and no code path anywhere approves without a
 * staff id. Those are three independent barriers against the same mistake.
 */
export async function proposeAction(
  context: unknown,
  input: {
    readonly sourceRunId: string;
    readonly sourceFindingId?: string | null;
    readonly actionClass: AgentActionClass;
    readonly subjectType: AgentSubjectType;
    readonly subjectRef: string;
    readonly reasonCodes: unknown;
    readonly channel: AgentActionChannel;
    readonly templateKey: string;
    readonly parameters: unknown;
    readonly deduplicationKey?: string | null;
    readonly expiresAt?: Date | null;
  },
): Promise<{ readonly proposalId: string; readonly reused: boolean }> {
  const ctx = assertInternalContext(context);

  if (!(AGENT_ACTION_CLASSES as readonly string[]).includes(input.actionClass)) {
    throw new AgentCoreError(
      "AGENT_ACTION_CLASS_FORBIDDEN",
      `Action class "${String(input.actionClass)}" is not permitted. The list is closed and every member is educational or supportive: ${AGENT_ACTION_CLASSES.join(", ")}. Deposit encouragement, trading encouragement, bid, CPA and payout changes, affiliate enablement and financial-pressure messaging are permanently absent.`,
    );
  }

  if (!(AGENT_ACTION_CHANNELS as readonly string[]).includes(input.channel)) {
    throw new AgentCoreError(
      "AGENT_ACTION_CHANNEL_INVALID",
      `Unknown channel. Legal channels: ${AGENT_ACTION_CHANNELS.join(", ")}. No provider is implemented for any of them.`,
    );
  }

  const subject = normalizeSubject({
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
  });

  if (subject.subjectType === null || subject.subjectRef === null) {
    throw new AgentCoreError(
      "AGENT_RUN_SUBJECT_INVALID",
      "A proposal is always about something: unlike a run there is no global proposal, because an action with no subject has nobody it could apply to.",
    );
  }

  const parameterSchema = ACTION_PARAMETER_SCHEMAS[input.actionClass];
  const parameters = validatePayload(parameterSchema, input.parameters);

  // The reason codes reuse the parameter validator's guarantees: bounded, flat,
  // no forbidden key, no forbidden value shape. A rationale SENTENCE cannot be
  // stored, which is what keeps a proposal's justification traceable to codes.
  const reasonCodes = validatePayload(
    {
      schemaKey: "action.reason_codes",
      version: 1,
      keys: {
        primaryCode: "string",
        secondaryCode: "string",
        findingCount: "number",
      },
      required: ["primaryCode"],
    },
    input.reasonCodes,
  );

  const templateKey = assertOpaqueReference("templateKey", input.templateKey);

  const deduplicationKey =
    input.deduplicationKey === undefined || input.deduplicationKey === null
      ? null
      : assertOpaqueReference("deduplicationKey", input.deduplicationKey);

  try {
    const proposal = await prisma.agentActionProposal.create({
      data: {
        sourceRunId: input.sourceRunId,
        sourceFindingId: input.sourceFindingId ?? null,
        actionClass: input.actionClass,
        subjectType: subject.subjectType,
        subjectRef: subject.subjectRef,
        reasonCodesJson: reasonCodes as Prisma.InputJsonValue,
        channel: input.channel,
        templateKey,
        parametersJson: parameters as Prisma.InputJsonValue,
        parametersSchemaVersion: parameterSchema.version,
        deduplicationKey,
        status: "proposed",
        requiresHumanApproval: true,
        expiresAt: input.expiresAt ?? null,
        createdAt: ctx.now,
      },
      select: { id: true },
    });

    return { proposalId: proposal.id, reused: false };
  } catch (error) {
    if (deduplicationKey !== null && isUniqueViolation(error)) {
      const existing = await prisma.agentActionProposal.findFirst({
        where: { deduplicationKey },
        select: { id: true },
      });

      if (existing) {
        return { proposalId: existing.id, reused: true };
      }
    }

    throw error;
  }
}

/**
 * Move a proposal's status along a legal edge. Compare-and-swap, as everywhere.
 */
export async function transitionProposal(
  context: unknown,
  input: {
    readonly proposalId: string;
    readonly from: AgentActionStatus;
    readonly to: AgentActionStatus;
  },
): Promise<{ readonly status: AgentActionStatus }> {
  assertInternalContext(context);

  assertLegalTransition(
    AGENT_ACTION_TRANSITIONS,
    input.from,
    input.to,
    "AGENT_ACTION_APPROVAL_REQUIRED",
    "proposal",
  );

  const updated = await prisma.agentActionProposal.updateMany({
    where: { id: input.proposalId, status: input.from },
    data: { status: input.to },
  });

  if (updated.count !== 1) {
    throw new AgentCoreError(
      "AGENT_ACTION_NOT_FOUND",
      `Proposal ${input.proposalId} was not at ${input.from}: nothing was mutated.`,
    );
  }

  return { status: input.to };
}

/* ============================================================= DECISIONS */

/**
 * Record the HUMAN decision on a proposal.
 *
 * `decidedByStaffId` comes from the CONTEXT, never from the input. A caller
 * cannot name somebody else as the decider, because the only field that could
 * carry that claim is not a parameter of this function.
 *
 * ONE DECISION EVER. The unique index on `proposalId` is what enforces it — a
 * second decision is a duplicate-key failure at the database rather than a race
 * this service is trusted to win. The decision row itself is immutable: there
 * is no update path for it anywhere in this module.
 */
export async function decideAction(
  context: unknown,
  input: {
    readonly proposalId: string;
    readonly decision: AgentDecision;
    readonly decisionCode: string;
    readonly policyVersion: string;
  },
): Promise<{ readonly decisionId: string }> {
  const ctx = assertInternalContext(context);

  if (!(AGENT_DECISIONS as readonly string[]).includes(input.decision)) {
    throw new AgentCoreError(
      "AGENT_DECISION_INVALID",
      `Unknown decision. Legal decisions: ${AGENT_DECISIONS.join(", ")}.`,
    );
  }

  if (ctx.actorStaffId === null) {
    throw new AgentCoreError(
      "AGENT_DECISION_ACTOR_REQUIRED",
      "A decision requires an identified staff actor. There is no system approval and no anonymous approval: an agent never holds more authority than the human who decided.",
    );
  }

  try {
    const decision = await prisma.agentActionDecision.create({
      data: {
        proposalId: input.proposalId,
        decision: input.decision,
        decisionCode: input.decisionCode,
        decidedByStaffId: ctx.actorStaffId,
        policyVersion: input.policyVersion,
        createdAt: ctx.now,
      },
      select: { id: true },
    });

    return { decisionId: decision.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AgentCoreError(
        "AGENT_DECISION_DUPLICATE",
        `Proposal ${input.proposalId} already has a final decision. One decision per proposal, ever.`,
      );
    }

    throw error;
  }
}

/* ============================================================ EXECUTIONS */

/**
 * Begin executing an approved action.
 *
 * ALWAYS THROWS. `ENABLED_EXECUTION_PROVIDERS` is an empty array, so no input
 * satisfies the check. This function exists so that the seam is reviewed now
 * and the failure is a named, tested behaviour rather than an absence somebody
 * has to notice.
 *
 * The throw happens BEFORE any database access, so a disabled execution leaves
 * no row, no attempt, no partial state and no audit entry.
 */
export async function startActionExecution(
  context: unknown,
  input: {
    readonly proposalId: string;
    readonly attemptNumber: number;
    readonly executionProvider: string;
    readonly idempotencyKey: string;
  },
): Promise<never> {
  assertInternalContext(context);

  if (!ENABLED_EXECUTION_PROVIDERS.includes(input.executionProvider)) {
    throw new AgentCoreError(
      "EXECUTION_PROVIDER_DISABLED",
      `Execution provider "${input.executionProvider}" is disabled. No execution provider is registered, no execution service is enabled and no external call can be made from the Agent Core.`,
    );
  }

  // Unreachable while the registry is empty. Kept as an explicit throw rather
  // than an implementation so that enabling a provider is a deliberate edit
  // here, under review, and never an accident of configuration.
  throw new AgentCoreError(
    "EXECUTION_PROVIDER_DISABLED",
    "No execution service is implemented.",
  );
}

/* =========================================================== EVALUATIONS */

/**
 * Record a deterministic assessment of a run, a finding or a proposal.
 *
 * Only deterministic evaluators are enabled: `human` and `model` are legal
 * schema values with no runtime, because there is no Curie Sentinel and no
 * model grader. Evaluations are kept separate from their target so that
 * re-evaluating a historical run never mutates it.
 */
export async function recordEvaluation(
  context: unknown,
  input: {
    readonly evaluatorType: string;
    readonly evaluatorCode: string;
    readonly targetType: AgentEvaluationTargetType;
    readonly targetRef: string;
    readonly evaluationCode: string;
    readonly scoreValue?: string | null;
    readonly result: AgentEvaluationResult;
    readonly evidence?: unknown;
  },
): Promise<{ readonly evaluationId: string }> {
  const ctx = assertInternalContext(context);

  if (!(ENABLED_EVALUATOR_TYPES as readonly string[]).includes(input.evaluatorType)) {
    throw new AgentCoreError(
      "AGENT_EVALUATOR_DISABLED",
      `Evaluator type "${input.evaluatorType}" is disabled. There is no Curie Sentinel runtime and no model grader in this phase. Enabled evaluator types: ${ENABLED_EVALUATOR_TYPES.join(", ")}.`,
    );
  }

  if (
    !(AGENT_EVALUATION_TARGET_TYPES as readonly string[]).includes(input.targetType)
  ) {
    throw new AgentCoreError(
      "AGENT_EVALUATION_TARGET_INVALID",
      `Unknown evaluation target type. Legal types: ${AGENT_EVALUATION_TARGET_TYPES.join(", ")}.`,
    );
  }

  if (!(AGENT_EVALUATION_RESULTS as readonly string[]).includes(input.result)) {
    throw new AgentCoreError(
      "AGENT_EVALUATION_TARGET_INVALID",
      `Unknown evaluation result. Legal results: ${AGENT_EVALUATION_RESULTS.join(", ")}.`,
    );
  }

  const targetRef = assertOpaqueReference("targetRef", input.targetRef);

  const evidence =
    input.evidence === undefined || input.evidence === null
      ? Prisma.DbNull
      : (validatePayload(
          EVALUATION_EVIDENCE_SCHEMA,
          input.evidence,
        ) as Prisma.InputJsonValue);

  const evaluation = await prisma.agentEvaluation.create({
    data: {
      evaluatorType: "deterministic",
      evaluatorCode: input.evaluatorCode,
      targetType: input.targetType,
      targetRef,
      evaluationCode: input.evaluationCode,
      scoreValue: input.scoreValue ?? null,
      result: input.result,
      evidenceJson: evidence,
      evidenceSchemaVersion: EVALUATION_EVIDENCE_SCHEMA.version,
      createdAt: ctx.now,
    },
    select: { id: true },
  });

  return { evaluationId: evaluation.id };
}

/* ======================================================= MODEL INVOCATION */

/**
 * THE MODEL BOUNDARY, as a runtime guard.
 *
 * ALWAYS THROWS `MODEL_PROVIDER_DISABLED`. `ENABLED_MODEL_PROVIDERS` is an
 * empty array, so no provider code satisfies the check and there is no branch
 * past it. No API key is read, no network client is constructed and no request
 * leaves the process — this module imports nothing that could make one.
 *
 * THE THROW PRECEDES ANY DATABASE ACCESS. A disabled invocation writes no
 * `ModelInvocation` row, which is why the table can be asserted empty rather
 * than merely asserted to contain no successful call.
 */
export async function invokeModel(
  context: unknown,
  input: {
    readonly runId?: string | null;
    readonly providerCode: string;
    readonly modelCode: string;
    readonly attemptNumber?: number;
  },
): Promise<never> {
  assertInternalContext(context);

  if (!ENABLED_MODEL_PROVIDERS.includes(input.providerCode)) {
    throw new AgentCoreError(
      MODEL_PROVIDER_DISABLED,
      `Model provider "${input.providerCode}" is disabled. No model provider is selected, no API key is configured and no network client exists in the Agent Core. Every model invocation attempt fails closed.`,
    );
  }

  // Unreachable while the registry is empty.
  throw new AgentCoreError(
    MODEL_PROVIDER_DISABLED,
    "No model invocation service is implemented.",
  );
}

/* ------------------------------------------------------------------ re-export */

export { AgentPayloadError };
