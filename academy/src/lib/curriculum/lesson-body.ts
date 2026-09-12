/**
 * THE CANONICAL LESSON BODY, made readable.
 *
 * WHAT WAS WRONG. The Backend has always published a complete lesson: seven or
 * so titled sections per level, built from a fifteen-member block vocabulary —
 * prose, key ideas, worked examples, tables, glossaries, common mistakes,
 * exercises, tool links and one next step. The Academy asked for it on every
 * level page and then threw all of it away, rendering the one-paragraph
 * `summary` and a "видео: N мин" fact line. Four to twelve kilobytes of written
 * lesson per level reached the browser and none of it reached the learner.
 *
 * WHAT THIS FILE IS. The reader for that payload, and only the reader. It maps
 * the Backend's own body onto a closed Academy vocabulary so a renderer has one
 * code path for both stored formats.
 *
 * FAIL-CLOSED, BLOCK BY BLOCK. `body` arrives as `unknown` across an HTTP
 * boundary, so nothing here trusts its shape. Every block is validated
 * individually and a block that does not check out is DROPPED rather than
 * throwing: one malformed table must not blank an entire lesson. A block type
 * this build does not know is likewise dropped — never rendered as raw JSON,
 * never guessed at. If everything drops, the result is `null` and the caller
 * shows its honest "материал недоступен" state, exactly as it does today when
 * no content is configured.
 *
 * WHAT IT REFUSES TO INVENT (§7). Estimated reading time, teacher metadata,
 * completion percentages, difficulty, tags, section durations. None of those is
 * owned by the canonical curriculum, so none of them exists here. The one
 * duration that DOES exist is `exercise.estimatedMinutes`, which an author
 * writes per exercise — it is carried through when present and absent when not,
 * never averaged, extrapolated or defaulted.
 *
 * IT DECIDES NOTHING (§11). There is no state, no gate, no completion and no
 * progression in this module. A `cta` block resolves to navigation the product
 * already owns; reaching the end of the reading does not finish a level, and no
 * function here can be made to say that it does.
 */

/* ------------------------------------------------------------------ types -- */

/** The canonical callout variants, mirrored exactly. Nothing widened. */
export type LessonCalloutVariant = "info" | "key_idea" | "tip" | "warning" | "risk";

/**
 * The canonical CTA vocabulary. Closed on purpose: each member maps onto a
 * destination the Academy already routes to, so a lesson can never carry an
 * arbitrary href out of the product.
 */
export type LessonCtaAction =
  | "next_level"
  | "open_tool"
  | "start_assessment"
  | "open_report"
  | "request_mentor_review"
  | "pocket_registration";

/**
 * A resolved media/attachment reference.
 *
 * Blocks name an `assetCode`; the published content version carries the assets.
 * Resolution happens HERE so an unresolvable code drops its block instead of
 * reaching the renderer as a broken image or a dead download.
 */
export type LessonAssetRef = {
  readonly url: string;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly durationSeconds: number | null;
};

export type LessonBlock =
  | { readonly type: "heading"; readonly level: 3 | 4; readonly text: string }
  | { readonly type: "rich_text"; readonly paragraphs: readonly string[] }
  | { readonly type: "callout"; readonly variant: LessonCalloutVariant; readonly title: string | null; readonly body: string }
  | { readonly type: "image"; readonly asset: LessonAssetRef; readonly alt: string; readonly caption: string | null }
  | {
      readonly type: "video";
      readonly asset: LessonAssetRef;
      readonly title: string;
      readonly captions: LessonAssetRef | null;
      readonly caption: string | null;
    }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | {
      readonly type: "table";
      readonly caption: string | null;
      readonly headers: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: "example"; readonly title: string; readonly body: string }
  | { readonly type: "common_mistake"; readonly mistake: string; readonly correction: string }
  | { readonly type: "glossary"; readonly entries: readonly { readonly term: string; readonly definition: string }[] }
  | {
      readonly type: "exercise";
      readonly code: string;
      readonly title: string;
      readonly instructions: string;
      readonly expectedAction: string;
      /** Author-written, per exercise. Null when the author wrote none. */
      readonly estimatedMinutes: number | null;
    }
  | { readonly type: "tool_link"; readonly toolCode: string; readonly label: string; readonly context: string | null }
  | {
      readonly type: "cta";
      readonly action: LessonCtaAction;
      readonly label: string;
      readonly body: string | null;
      readonly toolCode: string | null;
    }
  | { readonly type: "divider" }
  | { readonly type: "download"; readonly asset: LessonAssetRef; readonly label: string; readonly description: string | null };

export type LessonSection = {
  /**
   * The canonical progress anchor. Identical to the code the Backend validates
   * `UserLessonProgress.completedSections` against — never renamed, never
   * reordered, never invented.
   */
  readonly code: string;
  readonly title: string;
  readonly blocks: readonly LessonBlock[];
};

export type LessonBody = {
  readonly sourceFormat: "legacy_v1" | "blocks_v2";
  readonly sections: readonly LessonSection[];
  /** v1 only: material the legacy shape kept outside its sections. Never anchored. */
  readonly appendix: readonly LessonBlock[];
};

/** One published asset, as the content payload carries it. */
export type LessonAssetInput = {
  readonly kind: string;
  readonly assetCode: string;
  readonly url: string;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly durationSeconds: number | null;
};

/* ------------------------------------------------------------- primitives -- */

/** Bounds mirroring the Backend's own, so a hostile payload cannot be huge. */
const MAX_SECTIONS = 30;
const MAX_BLOCKS_PER_SECTION = 60;
const MAX_LIST_ITEMS = 30;
const MAX_TABLE_COLS = 8;
const MAX_TABLE_ROWS = 40;
const MAX_GLOSSARY_ENTRIES = 30;

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or null. Whitespace-only counts as absent. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** An optional string: absent, null and empty all resolve to null. */
function optStr(value: unknown): string | null {
  return typeof value === "string" ? str(value) : null;
}

function posInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function strArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  const out: string[] = [];
  for (const item of value) {
    const text = str(item);
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

/**
 * Prose split into paragraphs on blank lines.
 *
 * The canonical contract says `\n\n` separates paragraphs and nothing else
 * carries structure, so this is the whole of the formatting model. No markdown
 * is interpreted and no HTML is ever produced — a lesson author writes prose.
 */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/* ----------------------------------------------------------------- assets -- */

type AssetIndex = ReadonlyMap<string, LessonAssetInput>;

function indexAssets(assets: readonly LessonAssetInput[]): AssetIndex {
  const index = new Map<string, LessonAssetInput>();
  for (const asset of assets) {
    if (typeof asset?.assetCode === "string" && typeof asset.url === "string") {
      index.set(asset.assetCode, asset);
    }
  }
  return index;
}

/**
 * Resolve an asset reference, refusing anything that is not an https URL.
 *
 * The Backend's asset schema already asserts https; this asserts it again at the
 * point of USE, because this is where a bad value would become an element in the
 * learner's page.
 */
function resolveAsset(index: AssetIndex, code: unknown, kinds: readonly string[]): LessonAssetRef | null {
  if (typeof code !== "string" || code.length === 0) return null;
  const asset = index.get(code);
  if (!asset || !kinds.includes(asset.kind)) return null;
  if (!asset.url.startsWith("https://")) return null;
  return {
    url: asset.url,
    mimeType: typeof asset.mimeType === "string" ? asset.mimeType : "application/octet-stream",
    sizeBytes: typeof asset.sizeBytes === "number" ? asset.sizeBytes : null,
    durationSeconds: typeof asset.durationSeconds === "number" ? asset.durationSeconds : null,
  };
}

/* ----------------------------------------------------------------- blocks -- */

const CALLOUT_VARIANTS: readonly string[] = ["info", "key_idea", "tip", "warning", "risk"];
const CTA_ACTIONS: readonly string[] = [
  "next_level",
  "open_tool",
  "start_assessment",
  "open_report",
  "request_mentor_review",
  "pocket_registration",
];
const TOOL_CODE = /^tool\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * One block, or null if it cannot be rendered truthfully.
 *
 * Every branch is a total check of the fields that branch uses. The default
 * case — an unrecognised `type` — returns null, which is the fail-closed rule:
 * a future block type is INERT in this build rather than half-rendered.
 */
export function readBlock(raw: unknown, assets: AssetIndex): LessonBlock | null {
  const block = obj(raw);
  if (!block) return null;

  switch (block.type) {
    case "heading": {
      const text = str(block.text);
      const level = block.level === 3 || block.level === 4 ? block.level : null;
      return text && level ? { type: "heading", level, text } : null;
    }

    case "rich_text": {
      const text = str(block.text);
      if (!text) return null;
      const paragraphs = toParagraphs(text);
      return paragraphs.length > 0 ? { type: "rich_text", paragraphs } : null;
    }

    case "callout": {
      const body = str(block.body);
      const variant = typeof block.variant === "string" && CALLOUT_VARIANTS.includes(block.variant)
        ? (block.variant as LessonCalloutVariant)
        : null;
      return body && variant ? { type: "callout", variant, title: optStr(block.title), body } : null;
    }

    case "image": {
      const asset = resolveAsset(assets, block.assetCode, ["image", "chart"]);
      // `alt` is required by the canonical schema precisely because an image
      // without it is inaccessible. An image that lost its alt is dropped, not
      // rendered with an empty one.
      const alt = str(block.alt);
      return asset && alt ? { type: "image", asset, alt, caption: optStr(block.caption) } : null;
    }

    case "video": {
      const asset = resolveAsset(assets, block.assetCode, ["video"]);
      const title = str(block.title);
      if (!asset || !title) return null;
      return {
        type: "video",
        asset,
        title,
        captions: resolveAsset(assets, block.captionsAssetCode, ["subtitles"]),
        caption: optStr(block.caption),
      };
    }

    case "list": {
      const items = strArray(block.items, MAX_LIST_ITEMS);
      return items ? { type: "list", ordered: block.ordered === true, items } : null;
    }

    case "table": {
      const headers = strArray(block.headers, MAX_TABLE_COLS);
      if (!headers || !Array.isArray(block.rows) || block.rows.length === 0) return null;
      if (block.rows.length > MAX_TABLE_ROWS) return null;
      const rows: string[][] = [];
      for (const rawRow of block.rows) {
        if (!Array.isArray(rawRow)) return null;
        // Rectangular or nothing: a ragged row would misalign every cell after
        // it, and a table read wrong is worse than a table not shown.
        if (rawRow.length !== headers.length) return null;
        // Cells are OPTIONAL text in the canonical schema, so an empty cell is
        // legal and becomes "".
        rows.push(rawRow.map((cell) => optStr(cell) ?? ""));
      }
      return { type: "table", caption: optStr(block.caption), headers, rows };
    }

    case "example": {
      const title = str(block.title);
      const body = str(block.body);
      return title && body ? { type: "example", title, body } : null;
    }

    case "common_mistake": {
      const mistake = str(block.mistake);
      const correction = str(block.correction);
      return mistake && correction ? { type: "common_mistake", mistake, correction } : null;
    }

    case "glossary": {
      if (!Array.isArray(block.entries) || block.entries.length === 0) return null;
      const entries: { term: string; definition: string }[] = [];
      for (const rawEntry of block.entries.slice(0, MAX_GLOSSARY_ENTRIES)) {
        const entry = obj(rawEntry);
        const term = str(entry?.term);
        const definition = str(entry?.definition);
        if (term && definition) entries.push({ term, definition });
      }
      return entries.length > 0 ? { type: "glossary", entries } : null;
    }

    case "exercise": {
      const code = str(block.code);
      const title = str(block.title);
      const instructions = str(block.instructions);
      const expectedAction = str(block.expectedAction);
      if (!code || !title || !instructions || !expectedAction) return null;
      return {
        type: "exercise",
        code,
        title,
        instructions,
        expectedAction,
        // Carried only when the author wrote one. Never defaulted (§7).
        estimatedMinutes: posInt(block.estimatedMinutes),
      };
    }

    case "tool_link": {
      const label = str(block.label);
      const toolCode = str(block.toolCode);
      if (!label || !toolCode || !TOOL_CODE.test(toolCode)) return null;
      return { type: "tool_link", toolCode, label, context: optStr(block.context) };
    }

    case "cta": {
      const label = str(block.label);
      const action = typeof block.action === "string" && CTA_ACTIONS.includes(block.action)
        ? (block.action as LessonCtaAction)
        : null;
      if (!label || !action) return null;
      const toolCode = str(block.toolCode);
      const validTool = toolCode !== null && TOOL_CODE.test(toolCode) ? toolCode : null;
      // `open_tool` without a resolvable tool has nowhere to go.
      if (action === "open_tool" && validTool === null) return null;
      return { type: "cta", action, label, body: optStr(block.body), toolCode: validTool };
    }

    case "divider":
      return { type: "divider" };

    case "download": {
      const asset = resolveAsset(assets, block.assetCode, ["attachment"]);
      const label = str(block.label);
      return asset && label
        ? { type: "download", asset, label, description: optStr(block.description) }
        : null;
    }

    default:
      // Unknown block type. Inert, by design.
      return null;
  }
}

/* ------------------------------------------------------------------- body -- */

function readBlocks(raw: unknown, assets: AssetIndex): LessonBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: LessonBlock[] = [];
  for (const item of raw.slice(0, MAX_BLOCKS_PER_SECTION)) {
    const block = readBlock(item, assets);
    if (block) out.push(block);
  }
  return out;
}

/** The v1 appendix, projected exactly as the Backend's own normalizer does. */
function readV1Appendix(body: Record<string, unknown>): LessonBlock[] {
  const appendix: LessonBlock[] = [];

  if (Array.isArray(body.examples)) {
    for (const raw of body.examples) {
      const item = obj(raw);
      const title = str(item?.title);
      const text = str(item?.body);
      if (title && text) appendix.push({ type: "example", title, body: text });
    }
  }
  if (Array.isArray(body.commonMistakes)) {
    for (const raw of body.commonMistakes) {
      const item = obj(raw);
      const mistake = str(item?.mistake);
      const correction = str(item?.correction);
      if (mistake && correction) appendix.push({ type: "common_mistake", mistake, correction });
    }
  }
  if (Array.isArray(body.glossary)) {
    const entries: { term: string; definition: string }[] = [];
    for (const raw of body.glossary.slice(0, MAX_GLOSSARY_ENTRIES)) {
      const item = obj(raw);
      const term = str(item?.term);
      const definition = str(item?.definition);
      if (term && definition) entries.push({ term, definition });
    }
    if (entries.length > 0) appendix.push({ type: "glossary", entries });
  }

  const nextAction = obj(body.nextAction);
  const label = str(nextAction?.label);
  if (label) {
    appendix.push({ type: "cta", action: "next_level", label, body: optStr(nextAction?.body), toolCode: null });
  }

  const disclaimer = str(body.riskDisclaimer);
  if (disclaimer) {
    appendix.push({ type: "callout", variant: "risk", title: null, body: disclaimer });
  }

  return appendix;
}

/**
 * Read the canonical body into the Academy's reading model.
 *
 * The FORMAT TAG is checked first, exactly as the Backend does: a body that
 * declares `ata.lesson.blocks` at a version this build does not support is
 * refused outright rather than read as legacy, because guessing at a future
 * format is how a renderer silently drops half a lesson.
 */
export function normalizeLessonBody(
  raw: unknown,
  assets: readonly LessonAssetInput[] = [],
): LessonBody | null {
  const body = obj(raw);
  if (!body) return null;

  const index = indexAssets(assets);
  const isV2 = body.format === "ata.lesson.blocks";
  if (isV2 && body.version !== 2) return null;

  if (!Array.isArray(body.sections)) return null;

  const sections: LessonSection[] = [];
  const seen = new Set<string>();
  for (const raw of body.sections.slice(0, MAX_SECTIONS)) {
    const section = obj(raw);
    const code = str(section?.code);
    const title = str(section?.title);
    if (!code || !title) continue;
    // Duplicate anchors are refused rather than merged: `completedSections`
    // keys on this code, and two sections sharing one would make "прочитано"
    // ambiguous.
    if (seen.has(code)) continue;

    const blocks = isV2
      ? readBlocks(section!.blocks, index)
      : // v1 keeps one prose run per section.
        (() => {
          const text = str(section!.body);
          if (!text) return [];
          const paragraphs = toParagraphs(text);
          return paragraphs.length > 0 ? [{ type: "rich_text", paragraphs } as LessonBlock] : [];
        })();

    if (blocks.length === 0) continue;
    seen.add(code);
    sections.push({ code, title, blocks });
  }

  if (sections.length === 0) return null;

  return {
    sourceFormat: isV2 ? "blocks_v2" : "legacy_v1",
    sections,
    appendix: isV2 ? [] : readV1Appendix(body),
  };
}

/* -------------------------------------------------------------- resources -- */

/**
 * The lesson's downloadable/viewable resources, as the learner may see them.
 *
 * Built from the DECLARED blocks, not from the raw asset list: an asset that no
 * block references is not part of the written lesson, and listing it would show
 * the learner a file the author never put in front of them.
 */
export type LessonResource = {
  readonly kind: "download" | "video" | "image";
  readonly label: string;
  readonly url: string;
  readonly sizeBytes: number | null;
};

export function collectResources(body: LessonBody): LessonResource[] {
  const resources: LessonResource[] = [];
  const seen = new Set<string>();
  const all = [...body.sections.flatMap((section) => section.blocks), ...body.appendix];

  for (const block of all) {
    if (block.type !== "download" && block.type !== "video") continue;
    if (seen.has(block.asset.url)) continue;
    seen.add(block.asset.url);
    resources.push({
      kind: block.type,
      label: block.type === "download" ? block.label : block.title,
      url: block.asset.url,
      sizeBytes: block.asset.sizeBytes,
    });
  }
  return resources;
}
