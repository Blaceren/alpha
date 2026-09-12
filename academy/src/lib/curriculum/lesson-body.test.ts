/**
 * THE CANONICAL LESSON BODY READER.
 *
 * Three things are asserted here, in order of how much they matter:
 *   1. NOTHING IS FABRICATED. A field the canonical curriculum does not own must
 *      not appear with a made-up value (§7).
 *   2. IT FAILS CLOSED. A malformed block is dropped, never half-rendered; an
 *      unknown block type is inert; an unreadable body is null, not empty.
 *   3. IT DECIDES NOTHING. No output of this module is a state, a verdict or a
 *      completion (§11).
 */
import { describe, expect, it } from "vitest";
import {
  collectResources,
  normalizeLessonBody,
  readBlock,
  toParagraphs,
  type LessonAssetInput,
} from "@/lib/curriculum/lesson-body";

const NO_ASSETS = new Map<string, LessonAssetInput>();

/** A body in the shape the preprod curriculum actually publishes. */
function v2(sections: unknown[]): unknown {
  return { format: "ata.lesson.blocks", version: 2, sections };
}

describe("normalizeLessonBody — format triage", () => {
  it("reads the v2 block format the published curriculum uses", () => {
    const body = normalizeLessonBody(
      v2([
        {
          code: "hook",
          title: "С чего начинается урок",
          blocks: [
            { type: "callout", variant: "key_idea", title: "", body: "План риска пишется в спокойном состоянии." },
            { type: "rich_text", text: "Первый абзац.\n\nВторой абзац." },
          ],
        },
      ]),
    );

    expect(body?.sourceFormat).toBe("blocks_v2");
    expect(body?.sections).toHaveLength(1);
    expect(body?.sections[0]!.code).toBe("hook");
    expect(body?.sections[0]!.blocks).toHaveLength(2);
    expect(body?.appendix).toEqual([]);
  });

  it("reads the legacy v1 body and projects its appendix exactly as the Backend does", () => {
    const body = normalizeLessonBody({
      sections: [{ code: "intro", title: "Введение", body: "Абзац один.\n\nАбзац два." }],
      examples: [{ title: "Пример", body: "Текст примера" }],
      commonMistakes: [{ mistake: "Ошибка", correction: "Как правильно" }],
      glossary: [{ term: "Термин", definition: "Определение" }],
      nextAction: { label: "Дальше", body: "Что делать" },
      riskDisclaimer: "Торговля сопряжена с риском.",
    });

    expect(body?.sourceFormat).toBe("legacy_v1");
    expect(body?.sections[0]!.blocks).toEqual([
      { type: "rich_text", paragraphs: ["Абзац один.", "Абзац два."] },
    ]);
    expect(body?.appendix.map((block) => block.type)).toEqual([
      "example",
      "common_mistake",
      "glossary",
      "cta",
      "callout",
    ]);
  });

  it("refuses a declared v2 body at a version this build does not support", () => {
    // Reading a future format as legacy would silently drop most of a lesson.
    expect(normalizeLessonBody({ format: "ata.lesson.blocks", version: 3, sections: [] })).toBeNull();
  });

  it("answers null rather than an empty lesson", () => {
    expect(normalizeLessonBody(null)).toBeNull();
    expect(normalizeLessonBody("not a body")).toBeNull();
    expect(normalizeLessonBody({})).toBeNull();
    expect(normalizeLessonBody(v2([]))).toBeNull();
    // Every section dropped => no readable lesson at all.
    expect(normalizeLessonBody(v2([{ code: "a", title: "A", blocks: [{ type: "nonsense" }] }]))).toBeNull();
  });

  it("keeps the canonical section codes untouched — they are the progress anchors", () => {
    const body = normalizeLessonBody(
      v2([
        { code: "hook", title: "A", blocks: [{ type: "rich_text", text: "x" }] },
        { code: "sostav", title: "B", blocks: [{ type: "rich_text", text: "y" }] },
      ]),
    );
    expect(body?.sections.map((section) => section.code)).toEqual(["hook", "sostav"]);
  });

  it("drops a duplicate section code instead of merging it", () => {
    // `completedSections` keys on this code; two sections sharing one would make
    // "прочитано" ambiguous.
    const body = normalizeLessonBody(
      v2([
        { code: "hook", title: "Первый", blocks: [{ type: "rich_text", text: "x" }] },
        { code: "hook", title: "Второй", blocks: [{ type: "rich_text", text: "y" }] },
      ]),
    );
    expect(body?.sections).toHaveLength(1);
    expect(body?.sections[0]!.title).toBe("Первый");
  });
});

describe("readBlock — fail-closed, block by block", () => {
  it("is inert for a block type this build does not know", () => {
    expect(readBlock({ type: "future_block", text: "…" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "script", src: "https://evil" }, NO_ASSETS)).toBeNull();
  });

  it("drops a block whose required fields are missing rather than rendering a blank", () => {
    expect(readBlock({ type: "heading", level: 3 }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "heading", level: 2, text: "h2" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "rich_text", text: "   " }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "callout", body: "x" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "callout", variant: "neon", body: "x" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "example", title: "t" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "common_mistake", mistake: "m" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "glossary", entries: [] }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "list", items: [] }, NO_ASSETS)).toBeNull();
  });

  it("refuses a ragged table rather than misaligning every cell after it", () => {
    const ragged = {
      type: "table",
      headers: ["A", "B", "C"],
      rows: [["1", "2", "3"], ["4", "5"]],
    };
    expect(readBlock(ragged, NO_ASSETS)).toBeNull();

    const rectangular = { type: "table", headers: ["A", "B"], rows: [["1", "2"], ["3", null]] };
    const block = readBlock(rectangular, NO_ASSETS);
    // An empty cell is legal in the canonical schema and becomes "".
    expect(block).toEqual({ type: "table", caption: null, headers: ["A", "B"], rows: [["1", "2"], ["3", ""]] });
  });

  it("carries an exercise's estimated minutes only when the author wrote one", () => {
    const withMinutes = readBlock(
      {
        type: "exercise",
        code: "risk-plan",
        title: "Составь Risk Plan",
        instructions: "Заполни пять строк.",
        expectedAction: "Записать план",
        estimatedMinutes: 25,
      },
      NO_ASSETS,
    );
    expect(withMinutes).toMatchObject({ estimatedMinutes: 25 });

    // §7: no default, no average, no extrapolation.
    for (const value of [null, undefined, 0, -5, 12.5, "20"]) {
      const block = readBlock(
        {
          type: "exercise",
          code: "c",
          title: "t",
          instructions: "i",
          expectedAction: "a",
          estimatedMinutes: value,
        },
        NO_ASSETS,
      );
      expect(block).toMatchObject({ estimatedMinutes: null });
    }
  });

  it("carries no completion field on an exercise", () => {
    // The canonical exercise block deliberately has none: a practical level is
    // finished by its canonical owner, never by ticking the text.
    const block = readBlock(
      { type: "exercise", code: "c", title: "t", instructions: "i", expectedAction: "a", estimatedMinutes: null },
      NO_ASSETS,
    );
    const keys = Object.keys(block!);
    for (const forbidden of ["completed", "done", "status", "xp", "score"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("refuses a tool link whose code is not a canonical tool code", () => {
    expect(readBlock({ type: "tool_link", toolCode: "../admin", label: "x" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "tool_link", toolCode: "https://evil", label: "x" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "tool_link", toolCode: "tool.trading_journal", label: "Журнал" }, NO_ASSETS)).toEqual({
      type: "tool_link",
      toolCode: "tool.trading_journal",
      label: "Журнал",
      context: null,
    });
  });

  it("refuses a CTA whose action is outside the canonical vocabulary", () => {
    expect(readBlock({ type: "cta", action: "complete_level", label: "Готово" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "cta", action: "award_xp", label: "XP" }, NO_ASSETS)).toBeNull();
    // `open_tool` with nowhere to go is not rendered as a dead link.
    expect(readBlock({ type: "cta", action: "open_tool", label: "Открыть", toolCode: null }, NO_ASSETS)).toBeNull();
  });

  it("drops a media block whose asset cannot be resolved", () => {
    // Never a broken image, never a dead download.
    expect(readBlock({ type: "image", assetCode: "missing", alt: "схема" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "download", assetCode: "missing", label: "PDF" }, NO_ASSETS)).toBeNull();
    expect(readBlock({ type: "video", assetCode: "missing", title: "Урок" }, NO_ASSETS)).toBeNull();
  });

  it("refuses an asset served over anything but https", () => {
    const assets = new Map<string, LessonAssetInput>([
      ["a1", { kind: "image", assetCode: "a1", url: "http://cdn/x.png", mimeType: "image/png", sizeBytes: null, durationSeconds: null }],
    ]);
    expect(readBlock({ type: "image", assetCode: "a1", alt: "x" }, assets)).toBeNull();
  });

  it("refuses an asset whose kind does not match the block that references it", () => {
    const assets = new Map<string, LessonAssetInput>([
      ["a1", { kind: "attachment", assetCode: "a1", url: "https://cdn/x.pdf", mimeType: "application/pdf", sizeBytes: 10, durationSeconds: null }],
    ]);
    // An attachment is not an image.
    expect(readBlock({ type: "image", assetCode: "a1", alt: "x" }, assets)).toBeNull();
    expect(readBlock({ type: "download", assetCode: "a1", label: "PDF" }, assets)).not.toBeNull();
  });

  it("drops an image that lost its alt text", () => {
    const assets = new Map<string, LessonAssetInput>([
      ["a1", { kind: "image", assetCode: "a1", url: "https://cdn/x.png", mimeType: "image/png", sizeBytes: null, durationSeconds: null }],
    ]);
    expect(readBlock({ type: "image", assetCode: "a1", alt: "" }, assets)).toBeNull();
    expect(readBlock({ type: "image", assetCode: "a1" }, assets)).toBeNull();
  });
});

describe("toParagraphs", () => {
  it("splits on blank lines only — the whole of the canonical formatting model", () => {
    expect(toParagraphs("a\nb\n\nc")).toEqual(["a\nb", "c"]);
    expect(toParagraphs("  \n\n  ")).toEqual([]);
  });

  it("interprets no markup", () => {
    // Not a markdown renderer: the text is carried through verbatim and is
    // never handed to dangerouslySetInnerHTML downstream.
    expect(toParagraphs("**bold** <b>x</b>")).toEqual(["**bold** <b>x</b>"]);
  });
});

describe("collectResources", () => {
  it("lists only assets a block actually referenced", () => {
    const assets: LessonAssetInput[] = [
      { kind: "attachment", assetCode: "pdf", url: "https://cdn/p.pdf", mimeType: "application/pdf", sizeBytes: 100, durationSeconds: null },
      // Published but never referenced by the written lesson.
      { kind: "attachment", assetCode: "orphan", url: "https://cdn/o.pdf", mimeType: "application/pdf", sizeBytes: 1, durationSeconds: null },
    ];
    const body = normalizeLessonBody(
      v2([{ code: "s", title: "S", blocks: [{ type: "download", assetCode: "pdf", label: "Шаблон" }] }]),
      assets,
    );
    expect(collectResources(body!)).toEqual([
      { kind: "download", label: "Шаблон", url: "https://cdn/p.pdf", sizeBytes: 100 },
    ]);
  });

  it("is empty when the lesson is text-only", () => {
    const body = normalizeLessonBody(
      v2([{ code: "s", title: "S", blocks: [{ type: "rich_text", text: "текст" }] }]),
    );
    expect(collectResources(body!)).toEqual([]);
  });
});
