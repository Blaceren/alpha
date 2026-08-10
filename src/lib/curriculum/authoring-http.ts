/**
 * PHASE-G1 — the authoring HTTP edge.
 *
 * EVERY OPERATION IS NARROW (§4). One route, one method, one strict body schema,
 * a server-derived actor, `no-store`, and a structured error. There is no
 * generic "update this model" endpoint, no Backend proxy and no path on which a
 * caller-supplied identity or authority field is read.
 *
 * WHAT A CALLER MAY NEVER SEND. `actorId`, `lastAuthoredById`, `submittedById`,
 * `approvedById`, `approvedAt`, `publishedAt`, `editorialState`, `revision`,
 * `contractFingerprint`, `assessmentFingerprint`, `targetRevision` and
 * `snapshotCode` are all server-owned. Because every body below is a
 * `strictObject`, sending one is a 400 at the schema, not a silently dropped
 * field — and `assertNoAuthorityFields` in the regression asserts none of those
 * names appears in any schema in this file.
 *
 * `expectedRevision` IS the client's contribution to concurrency, and it is the
 * ONLY revision it may name: the client says which revision it loaded, and the
 * server decides what the next one is.
 *
 * THE READ/WRITE CSRF ASYMMETRY. `gateCurriculumAuthoring` checks CSRF for any
 * capability other than `read`, which is right for authoring and approval. One
 * operation does not fit that shape: creating a preview snapshot is a WRITE that
 * a `read_only` reviewer must be able to perform (§6 — "can inspect curriculum,
 * review states and preview"). `gateAuthoringMutation` therefore takes the
 * capability AND an explicit `csrf` requirement, so a read-capability write
 * still presents a CSRF token. There is no combination in this file that writes
 * without one.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateCsrfToken, csrfFailureResponse } from "@/lib/csrf";
import {
  gateCurriculumAuthoring,
  type AuthoringActor,
  type AuthoringCapability,
} from "@/lib/curriculum/authoring-authorization";
import {
  authoringErrorStatus,
  isAuthoringDomainError,
} from "@/lib/curriculum/authoring-errors";
import { AUTHORING_TARGET_KINDS } from "@/lib/curriculum/authoring-lifecycle";
import { expectedRevisionSchema } from "@/lib/curriculum/authoring-mutation-guard";
import { Phase4HttpError } from "@/lib/curriculum/phase4-http";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function authoringData(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data }, { status, headers: NO_STORE });
}

export function authoringError(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error, ...(extra ?? {}) }, { status, headers: NO_STORE });
}

/**
 * Turn a domain refusal into the product answer it is.
 *
 * `actualRevision` travels with a conflict so the editor can reload and
 * re-apply. No stack trace and no database detail ever leaves this function
 * (§23): an unrecognised error is logged server-side and answered as a bare 500.
 */
export function authoringException(error: unknown, label: string): NextResponse {
  if (isAuthoringDomainError(error)) {
    const status = authoringErrorStatus(error.code);
    const extra: Record<string, unknown> = {};
    if (error.actualRevision !== null) extra.actualRevision = error.actualRevision;
    if (error.issues.length > 0) extra.issues = error.issues;
    if (status >= 500) console.error(`${label} internal error`);
    return authoringError(error.code, status, extra);
  }
  if (error instanceof Phase4HttpError) {
    return authoringError(error.code, error.status, error.issues.length ? { issues: error.issues } : undefined);
  }
  console.error(`${label} internal error`);
  return authoringError("AUTHORING_INTERNAL_ERROR", 500);
}

/* ------------------------------------------------------------------ *
 * Gates
 * ------------------------------------------------------------------ */

export type AuthoringGateResult =
  | { ok: true; actor: AuthoringActor }
  | { ok: false; response: NextResponse };

/** A pure read. No CSRF, no body. */
export async function gateAuthoringRead(request: Request): Promise<AuthoringGateResult> {
  const gate = await gateCurriculumAuthoring(request, "read");
  if (!gate.ok) return gate;
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) {
    if (!ALLOWED_QUERY.has(key)) {
      return { ok: false, response: authoringError("INVALID_QUERY", 400, { reference: key }) };
    }
  }
  return gate;
}

/**
 * The only query keys any authoring GET accepts.
 *
 * Closed rather than ignored, in the same style as the accepted `strictQuery`:
 * an unexpected parameter usually means a client believes in a filter the server
 * does not implement, and silently returning unfiltered data is how a reviewer
 * ends up looking at the wrong list.
 *
 * REVIEW-SURFACE CORRECTION — the three candidate axes belong here.
 *
 * PHASE-G2 SUCCESSOR taught `candidateFromQuery` to read `contentVersionId`,
 * `assessmentVersionId` and `videoProductionVersionId`, and documented both
 * candidate-aware GETs as accepting them — but never added them to this set. The
 * gate runs BEFORE the route body, so every documented candidate-aware read was
 * answered `400 INVALID_QUERY` and the reachable HTTP surface could only ever
 * open the runtime version. A real authoring session found it the hard way: the
 * successor it had just submitted could not be opened through any staff route.
 *
 * The list stays CLOSED. Three names were added, nothing was opened up, and the
 * ids themselves are still verified against the level's own versions by
 * `resolveCandidate` before they select anything.
 */
const ALLOWED_QUERY: ReadonlySet<string> = new Set([
  "curriculumVersionId",
  "levelNumbers",
  "contentVersionId",
  "assessmentVersionId",
  "videoProductionVersionId",
]);

/**
 * A write. `capability` decides the permission; `csrf` is always enforced.
 *
 * For `author` and `approve` the underlying gate already checks CSRF, so the
 * extra check is a cheap no-op on the same token. For `read` — the preview
 * snapshot — this is the check that makes the write safe.
 */
export async function gateAuthoringMutation(
  request: Request,
  capability: AuthoringCapability,
): Promise<AuthoringGateResult> {
  const gate = await gateCurriculumAuthoring(request, capability);
  if (!gate.ok) return gate;
  if (!validateCsrfToken(request)) {
    const response = await csrfFailureResponse(request);
    response.headers.set("Cache-Control", "no-store");
    return { ok: false, response };
  }
  return gate;
}

/* ------------------------------------------------------------------ *
 * Bodies
 * ------------------------------------------------------------------ */

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Phase4HttpError(
      "AUTHORING_INPUT_INVALID",
      400,
      parsed.error.issues.map((issue) => ({
        code: "INPUT_INVALID",
        path: issue.path.join(".") || "body",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function positiveId(raw: string | undefined, reference: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Phase4HttpError("AUTHORING_INPUT_INVALID", 400, [
      { code: "INPUT_INVALID", path: reference, message: `${reference} must be a positive integer` },
    ]);
  }
  return value;
}

export const authoringTargetKindSchema = z.enum(AUTHORING_TARGET_KINDS);

export function parseTargetKind(raw: string | undefined) {
  const parsed = authoringTargetKindSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Phase4HttpError("AUTHORING_INPUT_INVALID", 400, [
      { code: "INPUT_INVALID", path: "kind", message: `kind must be one of ${AUTHORING_TARGET_KINDS.join(", ")}` },
    ]);
  }
  return parsed.data;
}

/* ---------------------------- shared schemas ---------------------------- */

/**
 * The lifecycle body. Exactly one field.
 *
 * Not `revision`, and not optional. The client names the revision it LOADED; the
 * server owns what the next one is. There is no default anywhere on this path:
 * falling back to the row's current revision would silently restore
 * last-write-wins, which is the single failure the whole aggregate guard exists
 * to prevent, and the accepted surface guard fails the build if such a fallback
 * ever appears.
 */
export const lifecycleBodySchema = z.strictObject({
  expectedRevision: expectedRevisionSchema,
});

export const reviewNoteBodySchema = z.strictObject({
  body: z.string().trim().min(1).max(4_000),
  /**
   * The accepted closed path grammar. Bounded here as well as in the domain so a
   * malformed selector is a 400 rather than a domain round trip.
   */
  path: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\[\d{1,4}\]|\.[a-zA-Z][a-zA-Z0-9_]*)*$/)
    .nullable()
    .optional(),
});

export const cloneBodySchema = z.strictObject({
  changeNotes: z.string().trim().max(4_000).nullable().optional(),
});

export const createPreviewBodySchema = z.strictObject({
  levelDefinitionId: z.number().int().positive().max(2_147_483_647),
  contentVersionId: z.number().int().positive().max(2_147_483_647).nullable(),
  assessmentVersionId: z.number().int().positive().max(2_147_483_647).nullable(),
  videoProductionVersionId: z.number().int().positive().max(2_147_483_647).nullable(),
});

export const handoffBodySchema = z.strictObject({
  curriculumVersionId: z.number().int().positive().max(2_147_483_647),
  /**
   * Omit for "everything that is ready". Naming levels makes the request an
   * assertion — those levels must ALL be ready or the whole call is refused.
   */
  levelNumbers: z.array(z.number().int().min(1).max(100)).min(1).max(100).optional(),
});

export const videoContractBodySchema = z.strictObject({
  expectedRevision: expectedRevisionSchema,
  /**
   * The WHOLE accepted contract, parsed by the accepted
   * `videoProductionContractSchema` in the domain. Deliberately `unknown` here:
   * re-declaring the contract shape at the HTTP edge would create a second
   * definition of it, and the domain's `strictObject` is what rejects a smuggled
   * `contractFingerprint` outright rather than dropping it.
   */
  payload: z.unknown(),
});

export const createVideoContractBodySchema = z.strictObject({
  payload: z.unknown(),
});

/* --------------------------------- PHASE-G2 source-authority adjudication */

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");

/**
 * One field-level decision.
 *
 * THE HASHES ARE REQUIRED, NOT OPTIONAL. They are the caller's statement of
 * WHICH pair it believes it is deciding about, and the domain refuses the whole
 * request if they no longer match the live values. Making them optional would
 * turn "adjudicate the comparison I was shown" into "adjudicate whatever is
 * there now", which is the one thing a source decision must never mean.
 */
export const sourceAuthorityDecisionSchema = z.strictObject({
  questionIndex: z.number().int().min(0).max(63),
  field: z.enum(["prompt", "correctAnswerText"]),
  decision: z.enum(["CURRENT", "BLUEPRINT"]),
  currentValueHash: sha256Schema,
  blueprintValueHash: sha256Schema,
});

export const sourceAuthorityBodySchema = z.strictObject({
  expectedAssessmentRevision: expectedRevisionSchema,
  expectedVideoProductionRevision: expectedRevisionSchema,
  /**
   * What the caller claims to be settling. `assessment` means "every raw
   * conflict this bank has"; `question` narrows it to one ordinal. Either way
   * the domain enforces that the decision set covers the scope EXACTLY, so a
   * caller cannot claim a question is adjudicated while half of it is open.
   */
  scope: z.union([
    z.strictObject({ kind: z.literal("assessment") }),
    z.strictObject({ kind: z.literal("question"), questionIndex: z.number().int().min(0).max(63) }),
  ]),
  decisions: z.array(sourceAuthorityDecisionSchema).min(1).max(64),
  rationale: z.string().trim().min(1).max(2_000),
  evidenceRef: z.string().trim().min(1).max(300),
  evidenceSha256: sha256Schema,
  /** Re-deciding a stale slot must be asked for, never inferred. */
  supersedeStale: z.boolean().optional(),
});

/** `?curriculumVersionId=` — optional; the server resolves the active one. */
export function readCurriculumVersionIdQuery(request: Request): number | null {
  return readPositiveIdQuery(request, "curriculumVersionId");
}

/**
 * PHASE-G2 SUCCESSOR — one positive-integer query reader, for every id.
 *
 * Extracted from `readCurriculumVersionIdQuery` unchanged rather than copied
 * beside it. The candidate axes need exactly this parse, and a second
 * hand-written copy is how two readers of one shape come to disagree about
 * whether `"0"`, `"1.5"` or `""` is acceptable.
 *
 * REVIEW-SURFACE CORRECTION — two ways this reader could be talked into
 * accepting something that is not the id the caller typed.
 *
 * 1. `searchParams.get` returns the FIRST value and discards the rest, so
 *    `?contentVersionId=79&contentVersionId=1` silently selected 79 while a
 *    caller — or a proxy that appended a default — believed it had said 1. An
 *    ambiguous selection must be refused, never resolved by position.
 *
 * 2. `Number()` accepts far more than a decimal id: `"0x4f"`, `"7e1"`, `"+79"`
 *    and `" 79 "` all become 79, and each is a different string arriving from a
 *    different bug. A candidate id decides WHICH VERSION a reviewer approves, so
 *    the spelling is checked before the value is.
 *
 * Both rules apply to `curriculumVersionId` as well, deliberately: the comment
 * above exists because two parse rules for one shape is how they drift apart,
 * and this change only ever narrows what was accepted.
 */
const DECIMAL_ID = /^[0-9]+$/;

export function readPositiveIdQuery(request: Request, param: string): number | null {
  const all = new URL(request.url).searchParams.getAll(param);
  if (all.length === 0) return null;
  const invalid = (message: string): never => {
    throw new Phase4HttpError("AUTHORING_INPUT_INVALID", 400, [
      { code: "INPUT_INVALID", path: param, message },
    ]);
  };
  if (all.length > 1) {
    invalid("must be supplied at most once — an ambiguous selection is refused, not resolved");
  }
  const raw = all[0];
  if (!DECIMAL_ID.test(raw)) invalid("must be a positive integer in plain decimal notation");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    invalid("must be a positive integer");
  }
  return value;
}
