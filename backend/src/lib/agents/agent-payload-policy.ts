/**
 * AGENT-FOUNDATION-1 — the payload policy.
 *
 * Five columns in the Core hold JSON: `AgentFinding.operandsJson`,
 * `AgentEvidenceReference.observedValueJson`, `AgentHandoff.payloadJson`,
 * `AgentActionProposal.parametersJson` and `AgentEvaluation.evidenceJson`.
 * Every one of them is a place where an unbounded blob of product data, a
 * prompt, a secret or a person's email address could enter the Agent Core if
 * nothing stopped it. This file is what stops it.
 *
 * THE ARGUMENT. "No PII in the agent tables" is worth nothing as a promise. It
 * is worth something as a WRITE-TIME REJECTION with a stable error code and a
 * test for each rule, which is what this module is. Every guarantee in
 * `12_PRIVACY_CLASSIFICATION.md` maps to a function here.
 *
 * WHAT THIS IS NOT. It is not a content filter that tries to recognise a
 * person's name. That approach fails on the first unusual name and gives false
 * confidence. This module works structurally instead: a bounded flat map of
 * scalars, keys drawn from a closed per-code allow-list, values shape-checked
 * against the things they must never look like. A payload that cannot express
 * an email address is a stronger guarantee than one that tries to detect it —
 * and the shape checks below are a second line for the mistake that slips
 * through a wrongly-permissive allow-list, not the primary defence.
 */

/* ------------------------------------------------------------------ limits */

/**
 * Bounds, in one place.
 *
 * These are deliberately small. A finding is a structured statement about a
 * handful of numbers, not a document: if an operand set does not fit in twelve
 * scalars, the finding is trying to carry a payload and should be several
 * findings citing several pieces of evidence instead.
 */
export const PAYLOAD_LIMITS = {
  /** Serialized bytes for any single JSON column. */
  maxSerializedBytes: 2048,
  /** Keys in one payload map. */
  maxKeys: 12,
  /** Characters in one key. */
  maxKeyLength: 48,
  /** Characters in one string value. */
  maxStringValueLength: 128,
  /**
   * Nesting depth. ONE means a flat map of scalars and nothing else.
   *
   * This single number is what makes "no entire DTO", "no entire API response",
   * "no user profile" and "no raw provider payload" structurally impossible
   * rather than merely forbidden: none of those things is a flat map of
   * scalars, so none of them can be stored no matter what key it is given.
   */
  maxDepth: 1,
} as const;

/* ------------------------------------------------------------ error codes */

export const PAYLOAD_ERROR_CODES = [
  "PAYLOAD_NOT_AN_OBJECT",
  "PAYLOAD_TOO_LARGE",
  "PAYLOAD_TOO_MANY_KEYS",
  "PAYLOAD_KEY_TOO_LONG",
  "PAYLOAD_KEY_UNKNOWN",
  "PAYLOAD_KEY_FORBIDDEN",
  "PAYLOAD_NESTED_VALUE",
  "PAYLOAD_VALUE_TYPE",
  "PAYLOAD_VALUE_TOO_LONG",
  "PAYLOAD_VALUE_FORBIDDEN",
  "PAYLOAD_SCHEMA_VERSION_UNKNOWN",
] as const;

export type PayloadErrorCode = (typeof PAYLOAD_ERROR_CODES)[number];

export class AgentPayloadError extends Error {
  readonly code: PayloadErrorCode;
  /** The offending key, when the rejection is about one. */
  readonly key: string | null;

  constructor(code: PayloadErrorCode, message: string, key: string | null = null) {
    super(message);
    this.name = "AgentPayloadError";
    this.code = code;
    this.key = key;
  }
}

/* --------------------------------------------------------- forbidden keys */

/**
 * Key fragments that may never appear in an Agent Core payload OR as a column
 * name anywhere in the Agent Core schema.
 *
 * Matched case-insensitively as SUBSTRINGS of the normalized key, so
 * `learnerEmail`, `learner_email` and `EMAIL_ADDRESS` are all caught by
 * `email`. The same list drives the automated schema scan in
 * `agentForbiddenFieldScan`, which is the point: the rule that governs a
 * runtime payload and the rule that governs a migration are the same rule, read
 * from the same array, so they cannot disagree.
 */
export const FORBIDDEN_KEY_FRAGMENTS = [
  /* ---- credentials and session material ------------------------------- */
  "password",
  "passwd",
  "secret",
  "credential",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "bearer",
  "authorization",
  "cookie",
  "session",
  "csrf",
  "postback_secret",
  "sessionsecret",
  "privatekey",
  "private_key",
  "signature",

  /* ---- direct identifiers --------------------------------------------- */
  "email",
  "phone",
  "msisdn",
  "telephone",
  "fullname",
  "full_name",
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "surname",
  "birthday",
  "birthdate",
  "dateofbirth",
  "passport",
  "address",
  "postcode",
  "zipcode",
  "geolocation",
  "ipaddress",
  "ip_address",
  "useragent",
  "user_agent",

  /* ---- payment instruments -------------------------------------------- */
  "card",
  "pan",
  "cvv",
  "iban",
  "swift",
  "wallet",

  /* ---- raw provider and attribution identifiers ------------------------ */
  "pocketplayerid",
  "pocket_player_id",
  "pocketuserid",
  "pocket_user_id",
  "clickid",
  "click_id",
  "rawpayload",
  "raw_payload",
  "querystring",
  "query_string",
  "callbackurl",
  "callback_url",

  /* ---- model material -------------------------------------------------- */
  "prompt",
  "systemprompt",
  "system_prompt",
  "completion",
  "rawresponse",
  "raw_response",
  "modeloutput",
  "model_output",
  "messages",
] as const;

/**
 * Column names that CONTAIN a forbidden fragment but are not the forbidden
 * thing, exempted explicitly and one at a time.
 *
 * `promptVersion` and `outputSchemaVersion` NAME a reviewed artefact held in
 * source. They are pointers, not content: storing "v3" is not storing a prompt,
 * and the whole point of `ModelInvocation` is that it records THAT a call
 * happened and what it cost while never recording what was said.
 *
 * THIS LIST APPLIES ONLY TO THE SCHEMA SCAN. A runtime payload key is still
 * judged by `findForbiddenKeyFragment` with no exemptions at all, so no operand,
 * handoff payload or action parameter may ever be called `promptVersion` — the
 * one place a caller could smuggle content is the one place nothing is excused.
 */
export const SCHEMA_SCAN_EXEMPT_COLUMNS = [
  "promptVersion",
  "outputSchemaVersion",
] as const;

/** Normalize a key for fragment matching: lowercase, punctuation removed. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

/**
 * The one place a key is judged.
 *
 * Returns the matched fragment or `null`. Callers turn that into either a
 * runtime rejection or a failed schema scan — same rule, two consumers.
 */
export function findForbiddenKeyFragment(key: string): string | null {
  const normalized = normalizeKey(key);
  const collapsed = normalized.replace(/_/g, "");

  for (const fragment of FORBIDDEN_KEY_FRAGMENTS) {
    const target = fragment.replace(/_/g, "");
    if (collapsed.includes(target)) {
      return fragment;
    }
  }

  return null;
}

/* ------------------------------------------------------- forbidden values */

/**
 * Value shapes that betray a leak regardless of the key they arrive under.
 *
 * This is the second line, not the first. The allow-list is what actually keeps
 * these payloads clean; these patterns catch the case where a legitimately
 * named operand is filled with the wrong thing — `memberLabel` holding an email
 * address, `note` holding a callback URL with a secret in its query string.
 */
const FORBIDDEN_VALUE_PATTERNS: ReadonlyArray<{
  readonly name: string;
  readonly pattern: RegExp;
}> = [
  { name: "email address", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/u },
  { name: "url", pattern: /\bhttps?:\/\//iu },
  { name: "query string", pattern: /[?&][\w-]+=/u },
  {
    name: "long digit run resembling a phone number or provider id",
    pattern: /\d{9,}/u,
  },
  { name: "sql statement", pattern: /\b(select|insert|update|delete|drop|union)\s/iu },
  { name: "template placeholder", pattern: /\{\{|\}\}|\$\{/u },
  // Any separator, not only whitespace: a reference column already forbids
  // whitespace, so a smuggled token would arrive as `Bearer_abc` or `Bearer-abc`
  // and a whitespace-only pattern would wave it through.
  { name: "bearer token", pattern: /\bbearer[\s_.:-]*\S/iu },
];

/**
 * Reject a value whose SHAPE is forbidden.
 *
 * Numbers are exempt from the digit-run rule for an important reason: a count
 * of 1_000_000_000 clicks is a legitimate measurement, while the STRING
 * "79001234567" in a text operand is a phone number wearing a number's clothes.
 * Typed numeric operands are the safe way to carry a large quantity, and this
 * asymmetry is what pushes callers towards them.
 */
export function assertNoForbiddenValue(key: string, value: string): void {
  for (const { name, pattern } of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      throw new AgentPayloadError(
        "PAYLOAD_VALUE_FORBIDDEN",
        `Value for "${key}" looks like a forbidden ${name}. Agent Core stores references to authoritative facts, never the facts themselves.`,
        key,
      );
    }
  }
}

/* ------------------------------------------------------------ value types */

/**
 * The scalar types a payload value may have.
 *
 * `bigint`, `symbol`, `function`, `object` and `undefined` are all absent. An
 * array is an object and is therefore rejected by `maxDepth`, which is what
 * keeps `reasonCodesJson`-style lists from becoming a smuggling route.
 */
export type PayloadScalar = string | number | boolean | null;

export type PayloadMap = Readonly<Record<string, PayloadScalar>>;

function assertScalar(key: string, value: unknown): PayloadScalar {
  if (value === null) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AgentPayloadError(
        "PAYLOAD_VALUE_TYPE",
        `Operand "${key}" must be a finite number. NaN and Infinity are not measurements.`,
        key,
      );
    }
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > PAYLOAD_LIMITS.maxStringValueLength) {
      throw new AgentPayloadError(
        "PAYLOAD_VALUE_TOO_LONG",
        `Operand "${key}" exceeds ${PAYLOAD_LIMITS.maxStringValueLength} characters. A finding carries operands, not prose.`,
        key,
      );
    }
    assertNoForbiddenValue(key, value);
    return value;
  }

  if (typeof value === "object") {
    throw new AgentPayloadError(
      "PAYLOAD_NESTED_VALUE",
      `Operand "${key}" is an object or array. Agent Core payloads are a FLAT map of scalars: this is what makes an entire DTO, API response, user profile or provider payload structurally unstorable.`,
      key,
    );
  }

  throw new AgentPayloadError(
    "PAYLOAD_VALUE_TYPE",
    `Operand "${key}" has unsupported type ${typeof value}.`,
    key,
  );
}

/* ------------------------------------------------------------ the schemas */

/**
 * A versioned payload schema: a closed key set with an explicit type per key.
 *
 * VERSIONED, because a stored payload must stay interpretable after the schema
 * moves. The version is recorded on the row, so a reader always knows which key
 * set the operands were validated against.
 */
export type PayloadSchema = {
  readonly schemaKey: string;
  readonly version: number;
  readonly keys: Readonly<Record<string, "string" | "number" | "boolean">>;
  /** Keys that must be present. Everything else is optional. */
  readonly required: readonly string[];
};

/**
 * Validate a payload against its schema.
 *
 * Order matters and is deliberate: size before keys, keys before values. A
 * 4 MB blob is rejected without ever iterating it, and an unknown key is
 * reported as unknown rather than as whatever its value happens to look like.
 */
export function validatePayload(
  schema: PayloadSchema,
  input: unknown,
): PayloadMap {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentPayloadError(
      "PAYLOAD_NOT_AN_OBJECT",
      `Payload for ${schema.schemaKey} must be a plain object.`,
    );
  }

  const serialized = JSON.stringify(input);
  const byteLength = Buffer.byteLength(serialized ?? "", "utf8");

  if (byteLength > PAYLOAD_LIMITS.maxSerializedBytes) {
    throw new AgentPayloadError(
      "PAYLOAD_TOO_LARGE",
      `Payload for ${schema.schemaKey} is ${byteLength} bytes, over the ${PAYLOAD_LIMITS.maxSerializedBytes} byte bound.`,
    );
  }

  const entries = Object.entries(input as Record<string, unknown>);

  if (entries.length > PAYLOAD_LIMITS.maxKeys) {
    throw new AgentPayloadError(
      "PAYLOAD_TOO_MANY_KEYS",
      `Payload for ${schema.schemaKey} has ${entries.length} keys, over the ${PAYLOAD_LIMITS.maxKeys} key bound.`,
    );
  }

  const result: Record<string, PayloadScalar> = {};

  for (const [key, value] of entries) {
    if (key.length > PAYLOAD_LIMITS.maxKeyLength) {
      throw new AgentPayloadError(
        "PAYLOAD_KEY_TOO_LONG",
        `Key "${key.slice(0, 32)}…" exceeds ${PAYLOAD_LIMITS.maxKeyLength} characters.`,
        key,
      );
    }

    const forbidden = findForbiddenKeyFragment(key);
    if (forbidden) {
      throw new AgentPayloadError(
        "PAYLOAD_KEY_FORBIDDEN",
        `Key "${key}" matches the forbidden fragment "${forbidden}". Agent Core holds no PII, no credential, no raw provider identifier and no model material.`,
        key,
      );
    }

    const expectedType = schema.keys[key];
    if (!expectedType) {
      throw new AgentPayloadError(
        "PAYLOAD_KEY_UNKNOWN",
        `Key "${key}" is not declared by ${schema.schemaKey} v${schema.version}. The key set is closed.`,
        key,
      );
    }

    const scalar = assertScalar(key, value);

    if (scalar !== null && typeof scalar !== expectedType) {
      throw new AgentPayloadError(
        "PAYLOAD_VALUE_TYPE",
        `Key "${key}" must be ${expectedType}, received ${typeof scalar}.`,
        key,
      );
    }

    result[key] = scalar;
  }

  for (const required of schema.required) {
    if (!(required in result) || result[required] === null) {
      throw new AgentPayloadError(
        "PAYLOAD_KEY_UNKNOWN",
        `Key "${required}" is required by ${schema.schemaKey} v${schema.version} and is missing.`,
        required,
      );
    }
  }

  return Object.freeze(result);
}

/* ------------------------------------------------------- registered schemas */

/**
 * The finding operand schemas, keyed by finding code.
 *
 * ONE SCHEMA PER CODE, not one schema for all findings. A shared schema would
 * have to be the union of every code's keys, which is the same as having no
 * allow-list at all: `insufficient_data` could then carry a `memberLabel` and
 * nothing would notice.
 *
 * The four codes below are the Core's OWN codes — the ones an internal service
 * may write today. They are deliberately NOT the AFD-5D1 Curie Atlas catalog:
 * the current Atlas endpoint persists nothing (§14), so importing its 33 codes
 * here would create a write surface for rows that must not exist yet.
 */
export const FINDING_OPERAND_SCHEMAS: Readonly<Record<string, PayloadSchema>> = {
  "agent_core.self_test": {
    schemaKey: "agent_core.self_test",
    version: 1,
    keys: { checkName: "string", observedCount: "number", passed: "boolean" },
    required: ["checkName"],
  },
  "agent_core.subject_observation": {
    schemaKey: "agent_core.subject_observation",
    version: 1,
    keys: {
      metricKey: "string",
      metricValue: "string",
      observedCount: "number",
      windowDays: "number",
    },
    required: ["metricKey", "metricValue"],
  },
  "agent_core.insufficient_data": {
    schemaKey: "agent_core.insufficient_data",
    version: 1,
    keys: { reasonCode: "string", observedCount: "number" },
    required: ["reasonCode"],
  },
  "agent_core.operational_fault": {
    schemaKey: "agent_core.operational_fault",
    version: 1,
    keys: { faultCode: "string", observedCount: "number" },
    required: ["faultCode"],
  },
} as const;

/** The closed set of finding codes the Core itself may write. */
export const AGENT_CORE_FINDING_CODES = Object.keys(
  FINDING_OPERAND_SCHEMAS,
) as readonly string[];

/**
 * Handoff payload schemas, keyed by handoff code.
 *
 * Note what is NOT here: a `message`, a `note`, an `instruction` or a `reason`
 * free-text field. A handoff is a code plus operands. An agent asking another
 * agent to do something in a sentence is exactly the uncontrolled surface this
 * design exists to prevent.
 */
export const HANDOFF_PAYLOAD_SCHEMAS: Readonly<Record<string, PayloadSchema>> = {
  retention_candidate: {
    schemaKey: "handoff.retention_candidate",
    version: 1,
    keys: { signalCode: "string", observedCount: "number", windowDays: "number" },
    required: ["signalCode"],
  },
  engagement_review: {
    schemaKey: "handoff.engagement_review",
    version: 1,
    keys: { signalCode: "string", windowDays: "number" },
    required: ["signalCode"],
  },
  evaluation_requested: {
    schemaKey: "handoff.evaluation_requested",
    version: 1,
    keys: { evaluationCode: "string", targetRunCount: "number" },
    required: ["evaluationCode"],
  },
} as const;

/**
 * Action parameter schemas, keyed by action class.
 *
 * Every one of them is `templateKey` + bounded scalars. There is no `body`, no
 * `text`, no `url`, no `recipient` and no `destination` key anywhere in this
 * map — an agent names a REVIEWED TEMPLATE and supplies typed parameters to it,
 * so it can never author the message, choose the link or address the recipient.
 */
export const ACTION_PARAMETER_SCHEMAS: Readonly<Record<string, PayloadSchema>> = {
  education_reminder: {
    schemaKey: "action.education_reminder",
    version: 1,
    keys: { levelCode: "string", daysSinceLastActivity: "number" },
    required: ["levelCode"],
  },
  continue_learning: {
    schemaKey: "action.continue_learning",
    version: 1,
    keys: { levelCode: "string", completedLevelCount: "number" },
    required: ["levelCode"],
  },
  complete_registration: {
    schemaKey: "action.complete_registration",
    version: 1,
    keys: { stepCode: "string", daysSinceStart: "number" },
    required: ["stepCode"],
  },
  review_feedback: {
    schemaKey: "action.review_feedback",
    version: 1,
    keys: { reportRevision: "number", levelCode: "string" },
    required: ["levelCode"],
  },
  support_followup: {
    schemaKey: "action.support_followup",
    version: 1,
    keys: { topicCode: "string", daysSinceContact: "number" },
    required: ["topicCode"],
  },
} as const;

/**
 * Evidence `observedValueJson` — one schema for all domains.
 *
 * Its key set is the smallest thing that can reproduce a finding: the metric's
 * name, its exact value as a string, and the unit. That is the ONLY reason this
 * column exists, and the allow-list is what enforces "no entire DTO, no entire
 * API response, no PII, no user profile, no provider payload" — none of those
 * has a `metricKey`.
 */
export const EVIDENCE_OBSERVED_VALUE_SCHEMA: PayloadSchema = {
  schemaKey: "evidence.observed_value",
  version: 1,
  keys: { metricKey: "string", metricValue: "string", unit: "string" },
  required: ["metricKey", "metricValue"],
} as const;

/** Evaluation evidence — a code, a count and a bound. Never a report. */
export const EVALUATION_EVIDENCE_SCHEMA: PayloadSchema = {
  schemaKey: "evaluation.evidence",
  version: 1,
  keys: {
    checkCode: "string",
    observedCount: "number",
    expectedCount: "number",
    toleranceCount: "number",
  },
  required: ["checkCode"],
} as const;

/* --------------------------------------------------------- opaque references */

/**
 * Validate an opaque internal reference — `subjectRef`, `sourceRef`,
 * `targetRef`, `externalReceiptRef`.
 *
 * The rule is SHAPE, not provenance: bounded length, no whitespace, and none of
 * the forbidden value patterns. A caller that tries to put an email address, a
 * URL, a callback query string or a long provider digit-run into a reference
 * column is rejected with the same code as one that tries it in an operand.
 */
export function assertOpaqueReference(field: string, value: string): string {
  if (value.length === 0 || value.length > 128) {
    throw new AgentPayloadError(
      "PAYLOAD_VALUE_TOO_LONG",
      `${field} must be 1..128 characters. It is an internal opaque reference, not a payload.`,
      field,
    );
  }

  if (/\s/u.test(value)) {
    throw new AgentPayloadError(
      "PAYLOAD_VALUE_FORBIDDEN",
      `${field} must not contain whitespace.`,
      field,
    );
  }

  assertNoForbiddenValue(field, value);
  return value;
}
