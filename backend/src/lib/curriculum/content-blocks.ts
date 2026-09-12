/**
 * PHASE-C — Content Body v2: the discriminated block catalog.
 *
 * WHAT THIS IS
 * The production content model for `ContentLocalization.body`. A lesson is a
 * list of SECTIONS, and a section is a list of BLOCKS. Every block is a strict,
 * closed, discriminated object: `type` decides the shape, unknown properties are
 * a hard error, and nothing in a block is free-form markup.
 *
 * WHY SECTIONS OF BLOCKS, AND NOT A FLAT BLOCK LIST
 * `UserLessonProgress.completedSections` already stores SECTION CODES, and
 * `content-read-progress.ts` builds its accepted vocabulary from
 * `body.sections[].code`. Those codes are durable learner state. A flat block
 * list would have forced progress anchors to be DERIVED (from heading positions,
 * or from an optional per-block code), which means an editorial edit that
 * inserts a heading silently renumbers a learner's saved progress. Sections stay
 * first-class so the anchor vocabulary stays an explicit, reviewable contract and
 * the v1 → v2 projection is anchor-identical.
 *
 * WHY THERE IS NO QUIZ BLOCK (evaluated and deliberately rejected, §5)
 * An inline quiz needs answer authority to be worth anything, and answer
 * authority inside a content body is refused at two independent layers today:
 * `content-validation.ts` rejects `correctAnswer`/`correctOptionCodes`/
 * `isCorrect` keys anywhere in a stored body, and the learner content route
 * returns the body verbatim, so any answer key placed there ships to the
 * browser. A quiz block would therefore be either (a) a second grading engine
 * with its own authorization, idempotency and audit story competing with
 * `AssessmentVersion`, or (b) a quiz with no answers. Both are worse than the
 * `exercise` block, which states the task and hands completion to the canonical
 * level workflow. Assessment stays the exclusive owner of graded, completion-
 * bearing questions.
 *
 * NO EXECUTABLE BLOCKS
 * There is no `html`, `embed`, `script`, `iframe` or `custom` block, and there
 * never should be. Every media reference is an `assetCode` resolved against the
 * package's own asset table; every link target is a bounded vocabulary.
 */
import { z } from "zod";
import {
  optionalSafeText,
  safeText,
  stableContentCode,
} from "@/lib/curriculum/content-safe-text";

/** Canonical body format identity. Both fields are checked before anything else. */
export const CONTENT_BODY_FORMAT = "ata.lesson.blocks" as const;
export const CONTENT_BODY_VERSION = 2 as const;

/** Tool codes as the product spells them: `tool.<snake_case>`. */
export const TOOL_CODE_PATTERN = /^tool\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

const text = (max: number, label: string) => safeText(max, label, "blocks_v2");
const optionalText = (max: number, label: string) => optionalSafeText(max, label, "blocks_v2");

/* ------------------------------------------------------------------ *
 * Block catalog
 * ------------------------------------------------------------------ */

/** Sub-heading INSIDE a section. h1 is the level title; h2 is the section title. */
const headingBlock = z.strictObject({
  type: z.literal("heading"),
  level: z.union([z.literal(3), z.literal(4)]),
  text: text(300, "heading text"),
});

/** A prose run. `\n\n` separates paragraphs; nothing else carries structure. */
const richTextBlock = z.strictObject({
  type: z.literal("rich_text"),
  text: text(8_000, "rich_text text"),
});

export const CALLOUT_VARIANTS = ["info", "key_idea", "tip", "warning", "risk"] as const;

const calloutBlock = z.strictObject({
  type: z.literal("callout"),
  variant: z.enum(CALLOUT_VARIANTS),
  title: optionalText(300, "callout title"),
  body: text(4_000, "callout body"),
});

/**
 * `alt` is REQUIRED and non-empty. An image that carries meaning without alt
 * text is inaccessible, and an image that carries no meaning does not belong in
 * a lesson; either way there is no case for an empty value.
 */
const imageBlock = z.strictObject({
  type: z.literal("image"),
  assetCode: stableContentCode(),
  alt: text(300, "image alt"),
  caption: optionalText(600, "image caption"),
});

/**
 * `title` is required (it is what a player, a transcript list and a screen
 * reader announce). `captionsAssetCode` points at a `subtitles` asset when one
 * exists — the future player needs to know it exists before it can offer it.
 */
const videoBlock = z.strictObject({
  type: z.literal("video"),
  assetCode: stableContentCode(),
  title: text(300, "video title"),
  captionsAssetCode: stableContentCode().nullable(),
  caption: optionalText(600, "video caption"),
});

const listBlock = z.strictObject({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(text(1_000, "list item")).min(1).max(30),
});

/**
 * A rectangular table. Every row must have exactly `headers.length` cells; the
 * check lives in `contentBodyV2Schema` so the message can name the row.
 */
const tableBlock = z.strictObject({
  type: z.literal("table"),
  caption: optionalText(300, "table caption"),
  headers: z.array(text(200, "table header")).min(1).max(8),
  rows: z.array(z.array(optionalText(500, "table cell")).min(1).max(8)).min(1).max(40),
});

const exampleBlock = z.strictObject({
  type: z.literal("example"),
  title: text(300, "example title"),
  body: text(8_000, "example body"),
});

const commonMistakeBlock = z.strictObject({
  type: z.literal("common_mistake"),
  mistake: text(2_000, "common mistake"),
  correction: text(2_000, "common mistake correction"),
});

const glossaryBlock = z.strictObject({
  type: z.literal("glossary"),
  entries: z
    .array(
      z.strictObject({
        term: text(300, "glossary term"),
        definition: text(2_000, "glossary definition"),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * The practical task. It carries NO completion field, no answer, no score and no
 * "done" flag by design: completion for a level whose exercise this is comes
 * from the canonical level workflow (`lesson:manual`, `mentor_review:mentor_review`
 * or `report:report_approval`) and from nowhere else. `code` exists so an
 * authoring tool and a future report/mentor rubric can reference the same
 * exercise without matching on prose.
 */
const exerciseBlock = z.strictObject({
  type: z.literal("exercise"),
  code: stableContentCode(),
  title: text(300, "exercise title"),
  instructions: text(4_000, "exercise instructions"),
  /** What the learner is expected to DO, stated as an observable action. */
  expectedAction: text(1_000, "exercise expectedAction"),
  estimatedMinutes: z.number().int().positive().max(600).nullable(),
});

const toolLinkBlock = z.strictObject({
  type: z.literal("tool_link"),
  toolCode: z.string().trim().max(64).regex(TOOL_CODE_PATTERN),
  label: text(120, "tool_link label"),
  context: optionalText(600, "tool_link context"),
});

/**
 * The one next step. `action` is a closed vocabulary that maps onto navigation
 * the product already owns — it can never become an arbitrary href.
 * `open_tool` is the only action that takes a `toolCode`.
 */
export const CTA_ACTIONS = [
  "next_level",
  "open_tool",
  "start_assessment",
  "open_report",
  "request_mentor_review",
  "pocket_registration",
] as const;

const ctaBlock = z.strictObject({
  type: z.literal("cta"),
  action: z.enum(CTA_ACTIONS),
  label: text(120, "cta label"),
  body: optionalText(1_000, "cta body"),
  toolCode: z.string().trim().max(64).regex(TOOL_CODE_PATTERN).nullable(),
});

const dividerBlock = z.strictObject({ type: z.literal("divider") });

const downloadBlock = z.strictObject({
  type: z.literal("download"),
  assetCode: stableContentCode(),
  label: text(200, "download label"),
  description: optionalText(600, "download description"),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  headingBlock,
  richTextBlock,
  calloutBlock,
  imageBlock,
  videoBlock,
  listBlock,
  tableBlock,
  exampleBlock,
  commonMistakeBlock,
  glossaryBlock,
  exerciseBlock,
  toolLinkBlock,
  ctaBlock,
  dividerBlock,
  downloadBlock,
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type ContentBlockType = ContentBlock["type"];

/** Every block type, in catalog order. Used by docs, tests and the editor contract. */
export const CONTENT_BLOCK_TYPES = [
  "heading",
  "rich_text",
  "callout",
  "image",
  "video",
  "list",
  "table",
  "example",
  "common_mistake",
  "glossary",
  "exercise",
  "tool_link",
  "cta",
  "divider",
  "download",
] as const satisfies readonly ContentBlockType[];

/** Block types that reference a package asset, and the asset kinds each accepts. */
export const BLOCK_ASSET_REFERENCES: Record<
  string,
  ReadonlyArray<{ field: string; kinds: readonly string[]; required: boolean }>
> = {
  image: [{ field: "assetCode", kinds: ["image", "chart"], required: true }],
  video: [
    { field: "assetCode", kinds: ["video"], required: true },
    { field: "captionsAssetCode", kinds: ["subtitles"], required: false },
  ],
  download: [{ field: "assetCode", kinds: ["attachment"], required: true }],
};

/** Block types that reference a canonical product tool code. */
export const BLOCK_TOOL_REFERENCES: Record<
  string,
  ReadonlyArray<{ field: string; required: boolean }>
> = {
  tool_link: [{ field: "toolCode", required: true }],
  cta: [{ field: "toolCode", required: false }],
};

/* ------------------------------------------------------------------ *
 * Body v2
 * ------------------------------------------------------------------ */

/** Bounded so one localization can never become a denial-of-service payload. */
export const MAX_BODY_V2_BYTES = 128 * 1024;

const sectionSchema = z.strictObject({
  code: stableContentCode(),
  title: text(300, "section title"),
  blocks: z.array(contentBlockSchema).min(1).max(60),
});

export const contentBodyV2Schema = z
  .strictObject({
    format: z.literal(CONTENT_BODY_FORMAT),
    version: z.literal(CONTENT_BODY_VERSION),
    sections: z.array(sectionSchema).min(1).max(30),
  })
  .superRefine((body, context) => {
    const seenSections = new Set<string>();
    const seenExercises = new Set<string>();
    body.sections.forEach((section, si) => {
      if (seenSections.has(section.code)) {
        context.addIssue({
          code: "custom",
          path: ["sections", si, "code"],
          message: "section code must be unique within the localization",
        });
      }
      seenSections.add(section.code);

      section.blocks.forEach((block, bi) => {
        const at = (field: string) => ["sections", si, "blocks", bi, field];
        if (block.type === "table") {
          block.rows.forEach((row, ri) => {
            if (row.length !== block.headers.length) {
              context.addIssue({
                code: "custom",
                path: ["sections", si, "blocks", bi, "rows", ri],
                message: "table row must have exactly one cell per header",
              });
            }
          });
        }
        if (block.type === "cta") {
          // The vocabulary is closed on purpose: `open_tool` is the ONLY action
          // that has a target, so a CTA can never smuggle a destination past the
          // navigation the product owns.
          if (block.action === "open_tool" && block.toolCode === null) {
            context.addIssue({
              code: "custom",
              path: at("toolCode"),
              message: "cta action open_tool requires a toolCode",
            });
          }
          if (block.action !== "open_tool" && block.toolCode !== null) {
            context.addIssue({
              code: "custom",
              path: at("toolCode"),
              message: `cta action ${block.action} must not carry a toolCode`,
            });
          }
        }
        if (block.type === "exercise") {
          if (seenExercises.has(block.code)) {
            context.addIssue({
              code: "custom",
              path: at("code"),
              message: "exercise code must be unique within the localization",
            });
          }
          seenExercises.add(block.code);
        }
        if (block.type === "video" && block.captionsAssetCode === block.assetCode) {
          context.addIssue({
            code: "custom",
            path: at("captionsAssetCode"),
            message: "captions asset must differ from the video asset",
          });
        }
      });
    });
  })
  .refine(
    (body) => Buffer.byteLength(JSON.stringify(body), "utf8") <= MAX_BODY_V2_BYTES,
    `content body must not exceed ${MAX_BODY_V2_BYTES} UTF-8 bytes`,
  );

export type ContentBodyV2 = z.infer<typeof contentBodyV2Schema>;
export type ContentBodyV2Section = ContentBodyV2["sections"][number];
