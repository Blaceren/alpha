/**
 * PHASE-C — the content BODY FORMAT contract: identity, versioning, and the
 * compatibility reader that lets v1 and v2 coexist without a database migration.
 *
 * THE PROBLEM THIS SOLVES
 * `ContentLocalization.body` is a `Json` column holding ONE rigid shape:
 * `{ sections, examples, commonMistakes, glossary, nextAction, riskDisclaimer }`.
 * It carries no format tag, so "which contract is this row?" could only ever be
 * answered by guessing at its keys. One approved package (`ata-v2.first-slice`)
 * and every existing draft are stored in that shape, and the learner content
 * route returns it verbatim. Replacing it outright would break approved content;
 * accepting an untagged union forever would make it impossible to evolve.
 *
 * THE STRATEGY CHOSEN (option A + C from the Phase-C brief)
 *  A. EXPLICIT FORMAT IDENTITY on the new format. A v2 body always begins
 *     `{"format":"ata.lesson.blocks","version":2,…}`. The tag is checked FIRST,
 *     so an unknown format and an unsupported version are specific, stable
 *     refusals — not "did not match any branch".
 *  C. DETERMINISTIC SOURCE CONVERSION for reading. `normalizeContentBody`
 *     projects BOTH formats onto one reading model, so every consumer
 *     (learner DTO, Academy renderer, future admin preview) sees blocks and one
 *     section-anchor vocabulary regardless of which format is stored.
 *
 * A body with NO `format` key is legacy v1. That is not an indefinite untagged
 * union: v1 is closed (it will never gain a member), every NEW body must be v2,
 * and the absence of the tag is itself the v1 discriminator. When the last v1
 * row is converted, the v1 branch can be deleted without touching v2.
 *
 * NO DATABASE MIGRATION IS NEEDED. The column is `JSONB … CHECK (json_valid())`
 * (`prisma/migrations/20260715000000_content_assessment_foundation`), which
 * constrains nothing about the shape. Phase C creates no migration file.
 *
 * WHAT MUST NOT DRIFT
 * `UserLessonProgress.completedSections` stores SECTION CODES. Both formats
 * therefore expose exactly one anchor vocabulary through
 * `contentBodySectionCodes`, and `content-read-progress.ts` reads it from here
 * instead of reaching into `body.sections` — otherwise a v2 lesson would silently
 * accept any section code a client sent.
 */
import { z } from "zod";
import {
  contentBodyV2Schema,
  CONTENT_BODY_FORMAT,
  CONTENT_BODY_VERSION,
  type ContentBlock,
  type ContentBodyV2,
} from "@/lib/curriculum/content-blocks";
import { byteLength, safeText, stableContentCode } from "@/lib/curriculum/content-safe-text";

/* ------------------------------------------------------------------ *
 * v1 — the legacy body, frozen
 * ------------------------------------------------------------------ */

/** The v1 size bound, unchanged. v2 has its own, larger, bound. */
export const MAX_BODY_V1_BYTES = 64 * 1024;

const v1Text = (label: string) => safeText(8_000, label, "legacy_v1");
const v1Title = (label: string) => safeText(300, label, "legacy_v1");

/**
 * Byte-for-byte the shape that shipped, with one change: its text primitives now
 * come from the shared sanitizer. That is a STRENGTHENING (encoded tag openers,
 * control/bidi characters and three further URI schemes are now refused) and not
 * a narrowing of legal prose — the approved packages contain none of those
 * sequences, and v1's original "markdown links must be https" rule is preserved
 * exactly by the `legacy_v1` policy.
 */
export const contentBodyV1Schema = z
  .strictObject({
    sections: z
      .array(
        z.strictObject({
          code: stableContentCode(),
          title: v1Title("section title"),
          body: v1Text("section body"),
        }),
      )
      .max(30),
    examples: z
      .array(z.strictObject({ title: v1Title("example title"), body: v1Text("example body") }))
      .max(50),
    commonMistakes: z
      .array(
        z.strictObject({
          mistake: v1Text("common mistake"),
          correction: v1Text("common mistake correction"),
        }),
      )
      .max(50),
    glossary: z
      .array(
        z.strictObject({
          term: v1Title("glossary term"),
          definition: v1Text("glossary definition"),
        }),
      )
      .max(50),
    nextAction: z.strictObject({
      label: v1Title("next action label"),
      body: v1Text("next action body"),
    }),
    riskDisclaimer: v1Text("risk disclaimer"),
  })
  .superRefine((body, context) => {
    const seen = new Set<string>();
    body.sections.forEach((section, index) => {
      if (seen.has(section.code)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "code"],
          message: "section code must be unique within the localization",
        });
      }
      seen.add(section.code);
    });
  })
  .refine(
    (body) => byteLength(JSON.stringify(body)) <= MAX_BODY_V1_BYTES,
    `content body must not exceed ${MAX_BODY_V1_BYTES} UTF-8 bytes`,
  );

export type ContentBodyV1 = z.infer<typeof contentBodyV1Schema>;
export type ContentBody = ContentBodyV1 | ContentBodyV2;

/* ------------------------------------------------------------------ *
 * Format triage
 * ------------------------------------------------------------------ */

export type ContentBodyIssue = { path: (string | number)[]; message: string; code: string };

export type ContentBodyProbe =
  | { kind: "v1" }
  | { kind: "v2" }
  | { kind: "not_an_object" }
  | { kind: "unknown_format" }
  | { kind: "unsupported_version" };

/**
 * Decide which contract a stored body claims to be, WITHOUT parsing it.
 *
 * Runs before any branch schema so that "this is not a format we support" is
 * always answered by a specific code. `version` is checked only for a body that
 * declares the canonical format: a v1 body has neither key and must not be
 * dragged into the v2 error space.
 */
export function probeContentBody(value: unknown): ContentBodyProbe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "not_an_object" };
  const record = value as Record<string, unknown>;
  if (!("format" in record) && !("version" in record)) return { kind: "v1" };
  if (record.format !== CONTENT_BODY_FORMAT) return { kind: "unknown_format" };
  if (record.version !== CONTENT_BODY_VERSION) return { kind: "unsupported_version" };
  return { kind: "v2" };
}

export type ParsedContentBody =
  | { ok: true; format: "legacy_v1"; body: ContentBodyV1 }
  | { ok: true; format: "blocks_v2"; body: ContentBodyV2 }
  | { ok: false; issues: ContentBodyIssue[] };

/** Parse a stored body into whichever supported contract it declares. */
export function parseContentBody(value: unknown): ParsedContentBody {
  const probe = probeContentBody(value);
  switch (probe.kind) {
    case "not_an_object":
      return {
        ok: false,
        issues: [{ path: [], code: "CONTENT_BODY_NOT_AN_OBJECT", message: "content body must be an object" }],
      };
    case "unknown_format":
      return {
        ok: false,
        issues: [
          {
            path: ["format"],
            code: "CONTENT_BODY_FORMAT_UNKNOWN",
            message: `content body format must be ${CONTENT_BODY_FORMAT}`,
          },
        ],
      };
    case "unsupported_version":
      return {
        ok: false,
        issues: [
          {
            path: ["version"],
            code: "CONTENT_BODY_VERSION_UNSUPPORTED",
            message: `content body version must be ${CONTENT_BODY_VERSION}`,
          },
        ],
      };
    case "v2": {
      const parsed = contentBodyV2Schema.safeParse(value);
      if (!parsed.success) {
        return {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path as (string | number)[],
            code: "CONTENT_BODY_BLOCK_INVALID",
            message: issue.message,
          })),
        };
      }
      return { ok: true, format: "blocks_v2", body: parsed.data };
    }
    case "v1": {
      const parsed = contentBodyV1Schema.safeParse(value);
      if (!parsed.success) {
        return {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path as (string | number)[],
            code: "CONTENT_BODY_LEGACY_INVALID",
            message: issue.message,
          })),
        };
      }
      return { ok: true, format: "legacy_v1", body: parsed.data };
    }
  }
}

/**
 * The zod face of `parseContentBody`, for embedding in localization schemas.
 *
 * Deliberately NOT a `z.union`: a union reports "no branch matched" for a v2
 * body with one bad block, which tells an author nothing. Triaging first means
 * every refusal names the field that is actually wrong.
 */
export const contentBodySchema = z.any().transform((value, context) => {
  const parsed = parseContentBody(value);
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
    return z.NEVER;
  }
  return parsed.body as ContentBody;
});

/* ------------------------------------------------------------------ *
 * The reading model — one shape for every consumer
 * ------------------------------------------------------------------ */

export type NormalizedContentSection = {
  code: string;
  title: string;
  blocks: ContentBlock[];
};

export type NormalizedContentBody = {
  sourceFormat: "legacy_v1" | "blocks_v2";
  /**
   * The PROGRESS-ANCHORED sections, in reading order. `code` is the vocabulary
   * `UserLessonProgress.completedSections` is validated against, and it is
   * identical to what the stored body declares — the projection never invents,
   * renames or reorders an anchor.
   */
  sections: NormalizedContentSection[];
  /**
   * v1 only: lesson material the legacy shape kept OUTSIDE its sections
   * (examples, mistakes, glossary, next action, risk disclaimer), projected into
   * blocks so a renderer needs one code path. Never progress-anchored — these
   * never had section codes, and inventing codes for them would let a client
   * claim progress on something no learner ever saw. Always empty for v2.
   */
  appendix: ContentBlock[];
};

/**
 * Project either format onto the reading model.
 *
 * PURE STRUCTURE, NO RE-VALIDATION. The v1 branch produces `ContentBlock`-shaped
 * objects from text that was validated under the v1 policy, which is slightly
 * more permissive than v2 (an https markdown link is legal in v1). Re-parsing
 * the projection through the v2 schemas would therefore reject legitimately
 * approved v1 content; the projection is a reading convenience, not a promotion
 * to v2. Converting a v1 body into a STORED v2 body is a separate, explicit
 * authoring act.
 */
export function normalizeContentBody(body: ContentBody): NormalizedContentBody {
  if (isBlocksV2(body)) {
    return {
      sourceFormat: "blocks_v2",
      sections: body.sections.map((section) => ({
        code: section.code,
        title: section.title,
        blocks: [...section.blocks],
      })),
      appendix: [],
    };
  }

  const appendix: ContentBlock[] = [];
  for (const example of body.examples) {
    appendix.push({ type: "example", title: example.title, body: example.body });
  }
  for (const mistake of body.commonMistakes) {
    appendix.push({
      type: "common_mistake",
      mistake: mistake.mistake,
      correction: mistake.correction,
    });
  }
  if (body.glossary.length > 0) {
    appendix.push({
      type: "glossary",
      entries: body.glossary.map((entry) => ({ term: entry.term, definition: entry.definition })),
    });
  }
  appendix.push({
    type: "cta",
    action: "next_level",
    label: body.nextAction.label,
    body: body.nextAction.body,
    toolCode: null,
  });
  appendix.push({
    type: "callout",
    variant: "risk",
    title: "",
    body: body.riskDisclaimer,
  });

  return {
    sourceFormat: "legacy_v1",
    sections: body.sections.map((section) => ({
      code: section.code,
      title: section.title,
      blocks: [{ type: "rich_text", text: section.body }],
    })),
    appendix,
  };
}

/** Is this a v2 blocks body? The one type guard every consumer should use. */
export function isBlocksV2(body: ContentBody): body is ContentBodyV2 {
  return (body as ContentBodyV2).format === CONTENT_BODY_FORMAT;
}

/**
 * The section-code vocabulary of a body, in reading order.
 *
 * The ONLY supported way to learn which section codes a lesson has. Lesson
 * progress is validated against exactly this set, so a caller that reaches into
 * `body.sections` directly would work for v1 and silently accept anything for
 * v2.
 */
export function contentBodySectionCodes(body: ContentBody): string[] {
  return body.sections.map((section) => section.code);
}

/** Every block in a body, in reading order (sections first, then v1 appendix). */
export function contentBodyBlocks(body: ContentBody): ContentBlock[] {
  const normalized = normalizeContentBody(body);
  return [...normalized.sections.flatMap((section) => section.blocks), ...normalized.appendix];
}

/* ------------------------------------------------------------------ *
 * Learner-facing emptiness — §17
 * ------------------------------------------------------------------ */

/** Blocks that carry no educational prose on their own. */
const NON_TEACHING_BLOCK_TYPES = new Set(["divider", "cta", "tool_link", "heading"]);

/**
 * Does this body actually teach something?
 *
 * A body can be schema-valid and still be learner-empty: one heading, a divider
 * and a CTA parse perfectly and say nothing. "Structurally valid but
 * learner-empty" is the exact failure §17 refuses, so completeness is measured
 * on TEACHING blocks and on how much prose they carry, not on block count.
 */
export function contentBodyTeachingCharacters(body: ContentBody): number {
  let total = 0;
  const add = (value: string | null | undefined) => {
    if (typeof value === "string") total += value.trim().length;
  };
  for (const block of contentBodyBlocks(body)) {
    if (NON_TEACHING_BLOCK_TYPES.has(block.type)) continue;
    switch (block.type) {
      case "rich_text":
        add(block.text);
        break;
      case "callout":
        add(block.body);
        break;
      case "image":
        add(block.caption);
        break;
      case "video":
        add(block.caption);
        break;
      case "list":
        block.items.forEach(add);
        break;
      case "table":
        block.rows.forEach((row) => row.forEach(add));
        break;
      case "example":
        add(block.body);
        break;
      case "common_mistake":
        add(block.mistake);
        add(block.correction);
        break;
      case "glossary":
        block.entries.forEach((entry) => add(entry.definition));
        break;
      case "exercise":
        add(block.instructions);
        add(block.expectedAction);
        break;
      case "download":
        add(block.description);
        break;
      default:
        break;
    }
  }
  return total;
}

/** Does the body carry an explicit risk disclaimer? (v1: always; v2: a risk callout.) */
export function contentBodyHasRiskDisclaimer(body: ContentBody): boolean {
  if (!isBlocksV2(body)) return body.riskDisclaimer.trim().length > 0;
  return contentBodyBlocks(body).some(
    (block) => block.type === "callout" && block.variant === "risk" && block.body.trim().length > 0,
  );
}

/** Asset codes referenced by blocks, with the kinds each reference accepts. */
export function contentBodyAssetReferences(
  body: ContentBody,
): Array<{ path: string; assetCode: string; kinds: readonly string[] }> {
  const references: Array<{ path: string; assetCode: string; kinds: readonly string[] }> = [];
  if (!isBlocksV2(body)) return references;
  body.sections.forEach((section, si) => {
    section.blocks.forEach((block, bi) => {
      const base = `sections[${si}].blocks[${bi}]`;
      if (block.type === "image") {
        references.push({ path: `${base}.assetCode`, assetCode: block.assetCode, kinds: ["image", "chart"] });
      } else if (block.type === "video") {
        references.push({ path: `${base}.assetCode`, assetCode: block.assetCode, kinds: ["video"] });
        if (block.captionsAssetCode !== null) {
          references.push({
            path: `${base}.captionsAssetCode`,
            assetCode: block.captionsAssetCode,
            kinds: ["subtitles"],
          });
        }
      } else if (block.type === "download") {
        references.push({ path: `${base}.assetCode`, assetCode: block.assetCode, kinds: ["attachment"] });
      }
    });
  });
  return references;
}

/** Tool codes referenced by blocks. */
export function contentBodyToolReferences(
  body: ContentBody,
): Array<{ path: string; toolCode: string }> {
  const references: Array<{ path: string; toolCode: string }> = [];
  if (!isBlocksV2(body)) return references;
  body.sections.forEach((section, si) => {
    section.blocks.forEach((block, bi) => {
      const base = `sections[${si}].blocks[${bi}]`;
      if (block.type === "tool_link") {
        references.push({ path: `${base}.toolCode`, toolCode: block.toolCode });
      } else if (block.type === "cta" && block.toolCode !== null) {
        references.push({ path: `${base}.toolCode`, toolCode: block.toolCode });
      }
    });
  });
  return references;
}

export { CONTENT_BODY_FORMAT, CONTENT_BODY_VERSION };
