/**
 * PHASE-C — Content Body v2 regression: format identity, the block catalog,
 * the shared sanitizer, asset and tool references, and v1 backward compatibility.
 *
 * Runs entirely in memory. No database, no network, no live data. Every payload
 * here is SYNTHETIC_TEST_ONLY and is never curriculum content.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTENT_BLOCK_TYPES,
  contentBlockSchema,
  contentBodyV2Schema,
  MAX_BODY_V2_BYTES,
  type ContentBlock,
} from "@/lib/curriculum/content-blocks";
import {
  contentBodyAssetReferences,
  contentBodyHasRiskDisclaimer,
  contentBodySectionCodes,
  contentBodyTeachingCharacters,
  contentBodyToolReferences,
  contentBodyV1Schema,
  isBlocksV2,
  normalizeContentBody,
  parseContentBody,
  probeContentBody,
} from "@/lib/curriculum/content-body";
import { isSafeText } from "@/lib/curriculum/content-safe-text";
import { contentLocalizationPayloadSchema } from "@/lib/curriculum/content-schemas";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const HAPPY_BLOCKS: Record<string, ContentBlock> = {
  heading: { type: "heading", level: 3, text: "Подзаголовок" },
  rich_text: { type: "rich_text", text: "Первый абзац.\n\nВторой абзац." },
  callout: { type: "callout", variant: "risk", title: "Риск", body: "Торговля связана с риском потери средств." },
  image: { type: "image", assetCode: "shema-zony", alt: "Схема зоны реакции", caption: "Пример разметки" },
  video: { type: "video", assetCode: "urok-video", title: "Видеоурок", captionsAssetCode: "urok-subtitry", caption: "" },
  list: { type: "list", ordered: true, items: ["Первый шаг", "Второй шаг"] },
  table: { type: "table", caption: "", headers: ["Режим", "Setup"], rows: [["Тренд", "Продолжение"], ["Боковик", "Отказ"]] },
  example: { type: "example", title: "Пример", body: "Разбор ситуации." },
  common_mistake: { type: "common_mistake", mistake: "Вход без плана.", correction: "Сначала план, потом вход." },
  glossary: { type: "glossary", entries: [{ term: "Payout", definition: "Доля выплаты по сделке." }] },
  exercise: {
    type: "exercise",
    code: "l018-razmetka",
    title: "Разметка",
    instructions: "Разметить три графика.",
    expectedAction: "Загрузить разметку в инструмент.",
    estimatedMinutes: 30,
  },
  tool_link: { type: "tool_link", toolCode: "tool.chart_markup", label: "Chart Markup Tool", context: "" },
  cta: { type: "cta", action: "open_tool", label: "Открыть инструмент", body: "", toolCode: "tool.chart_markup" },
  divider: { type: "divider" },
  download: { type: "download", assetCode: "shablon-plana", label: "Шаблон плана", description: "" },
};

function bodyV2(blocks: ContentBlock[] = [HAPPY_BLOCKS.rich_text]) {
  return {
    format: "ata.lesson.blocks" as const,
    version: 2 as const,
    sections: [{ code: "intro", title: "Введение", blocks }],
  };
}

function bodyV1() {
  return {
    sections: [{ code: "intro", title: "Введение", body: "Текст раздела." }],
    examples: [{ title: "Пример", body: "Разбор." }],
    commonMistakes: [{ mistake: "Ошибка.", correction: "Исправление." }],
    glossary: [{ term: "Payout", definition: "Доля выплаты." }],
    nextAction: { label: "Дальше", body: "Перейти к тесту." },
    riskDisclaimer: "Торговля связана с риском.",
  };
}

/* ------------------------------------------------------------------ *
 * 1. Format identity and versioning (§8)
 * ------------------------------------------------------------------ */

check("1 a v1 body (no format tag) is recognised as legacy", () => {
  assert.equal(probeContentBody(bodyV1()).kind, "v1");
  const parsed = parseContentBody(bodyV1());
  assert.equal(parsed.ok && parsed.format, "legacy_v1");
});

check("2 a v2 body is recognised by its explicit format tag", () => {
  assert.equal(probeContentBody(bodyV2()).kind, "v2");
  const parsed = parseContentBody(bodyV2());
  assert.equal(parsed.ok && parsed.format, "blocks_v2");
});

check("3 an unknown format is refused with a specific code", () => {
  const parsed = parseContentBody({ format: "ata.lesson.markdown", version: 2, sections: [] });
  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.issues[0].code, "CONTENT_BODY_FORMAT_UNKNOWN");
});

check("4 an unsupported version is refused with a specific code", () => {
  const parsed = parseContentBody({ ...bodyV2(), version: 3 });
  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.issues[0].code, "CONTENT_BODY_VERSION_UNSUPPORTED");
  const future = parseContentBody({ ...bodyV2(), version: 99 });
  assert.equal(!future.ok && future.issues[0].code, "CONTENT_BODY_VERSION_UNSUPPORTED");
});

check("5 a non-object body is refused", () => {
  for (const value of [null, 5, "body", [], true]) {
    const parsed = parseContentBody(value);
    assert.equal(parsed.ok, false, `${JSON.stringify(value)} must be refused`);
    assert.equal(!parsed.ok && parsed.issues[0].code, "CONTENT_BODY_NOT_AN_OBJECT");
  }
});

/* ------------------------------------------------------------------ *
 * 2. Block catalog — happy path for every type (§25)
 * ------------------------------------------------------------------ */

check("6 every catalogued block type parses on its happy path", () => {
  assert.equal(CONTENT_BLOCK_TYPES.length, 15);
  for (const type of CONTENT_BLOCK_TYPES) {
    const block = HAPPY_BLOCKS[type];
    assert.ok(block, `no happy-path fixture for ${type}`);
    const parsed = contentBlockSchema.safeParse(block);
    assert.ok(parsed.success, `${type} must parse: ${JSON.stringify(parsed.error?.issues)}`);
  }
});

check("7 a whole body of every block type parses", () => {
  const parsed = contentBodyV2Schema.safeParse(
    bodyV2(CONTENT_BLOCK_TYPES.map((type) => HAPPY_BLOCKS[type])),
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

check("8 an unknown block type is refused", () => {
  const parsed = parseContentBody(bodyV2([{ type: "iframe", src: "https://x" } as never]));
  assert.equal(parsed.ok, false);
});

check("9 an unknown property on a known block is refused", () => {
  const parsed = parseContentBody(
    bodyV2([{ ...HAPPY_BLOCKS.rich_text, html: "<b>x</b>" } as never]),
  );
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok && parsed.issues.some((i) => /Unrecognized key/i.test(i.message)));
});

check("10 there is no executable/raw-HTML block in the catalog", () => {
  for (const forbidden of ["html", "raw_html", "embed", "script", "iframe", "custom"]) {
    assert.ok(!CONTENT_BLOCK_TYPES.includes(forbidden as never), `${forbidden} must not exist`);
  }
});

check("11 there is no completion-bearing quiz block", () => {
  // Assessment stays the sole owner of graded, completion-bearing questions.
  for (const forbidden of ["quiz", "question", "assessment", "knowledge_check"]) {
    assert.ok(!CONTENT_BLOCK_TYPES.includes(forbidden as never), `${forbidden} must not exist`);
  }
  // And the exercise block must carry no completion authority of its own.
  const exercise = HAPPY_BLOCKS.exercise as Record<string, unknown>;
  for (const authority of ["completed", "isCorrect", "correctAnswer", "score", "passPercent"]) {
    assert.equal(exercise[authority], undefined);
  }
});

/* ------------------------------------------------------------------ *
 * 3. Per-block semantics
 * ------------------------------------------------------------------ */

check("12 a table row with the wrong cell count is refused", () => {
  const parsed = parseContentBody(
    bodyV2([{ type: "table", caption: "", headers: ["A", "B"], rows: [["only-one"]] }]),
  );
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok && parsed.issues.some((i) => /one cell per header/.test(i.message)));
});

check("13 cta action/toolCode pairing is enforced both ways", () => {
  const missing = parseContentBody(
    bodyV2([{ type: "cta", action: "open_tool", label: "Открыть", body: "", toolCode: null }]),
  );
  assert.equal(missing.ok, false);
  const extra = parseContentBody(
    bodyV2([{ type: "cta", action: "next_level", label: "Дальше", body: "", toolCode: "tool.watchlist" }]),
  );
  assert.equal(extra.ok, false);
});

check("14 duplicate section codes and duplicate exercise codes are refused", () => {
  const duplicateSection = parseContentBody({
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      { code: "intro", title: "A", blocks: [HAPPY_BLOCKS.rich_text] },
      { code: "intro", title: "B", blocks: [HAPPY_BLOCKS.rich_text] },
    ],
  });
  assert.equal(duplicateSection.ok, false);

  const duplicateExercise = parseContentBody(
    bodyV2([HAPPY_BLOCKS.exercise, { ...HAPPY_BLOCKS.exercise }]),
  );
  assert.equal(duplicateExercise.ok, false);
});

check("15 a video may not use its own asset as captions", () => {
  const parsed = parseContentBody(
    bodyV2([{ type: "video", assetCode: "urok", title: "Видео", captionsAssetCode: "urok", caption: "" }]),
  );
  assert.equal(parsed.ok, false);
});

check("16 an image without alt text is refused", () => {
  const parsed = parseContentBody(
    bodyV2([{ type: "image", assetCode: "shema", alt: "", caption: "" }]),
  );
  assert.equal(parsed.ok, false);
});

check("17 an oversized body is refused", () => {
  const huge = bodyV2([
    { type: "rich_text", text: "а".repeat(7_900) },
  ]);
  huge.sections = Array.from({ length: 30 }, (_, i) => ({
    code: `s${i}`,
    title: "Раздел",
    blocks: Array.from({ length: 3 }, () => ({ type: "rich_text", text: "а".repeat(7_900) }) as ContentBlock),
  }));
  const parsed = parseContentBody(huge);
  assert.equal(parsed.ok, false);
  assert.ok(
    Buffer.byteLength(JSON.stringify(huge), "utf8") > MAX_BODY_V2_BYTES,
    "fixture must actually exceed the bound",
  );
});

/* ------------------------------------------------------------------ *
 * 4. Malicious content (§9) — every text-bearing block
 * ------------------------------------------------------------------ */

const MALICIOUS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "нажми <a href=\"https://x\">сюда</a>",
  "javascript:alert(1)",
  "data:text/html;base64,PHNjcmlwdD4=",
  "vbscript:msgbox(1)",
  "onclick=alert(1)",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#60;script&#62;",
  "[ссылка](javascript:alert(1))",
  "[ссылка](https://example.com)",
  "текст‮обратный",
  "текст ноль",
];

check("18 every malicious payload is refused by the shared sanitizer", () => {
  for (const payload of MALICIOUS) {
    assert.equal(isSafeText(payload, "blocks_v2"), false, `v2 must refuse: ${payload.slice(0, 24)}`);
  }
});

check("19 every text-bearing block refuses a malicious payload in every text field", () => {
  const textFields: Array<[string, (payload: string) => unknown]> = [
    ["heading.text", (p) => ({ type: "heading", level: 3, text: p })],
    ["rich_text.text", (p) => ({ type: "rich_text", text: p })],
    ["callout.body", (p) => ({ type: "callout", variant: "info", title: "", body: p })],
    ["callout.title", (p) => ({ type: "callout", variant: "info", title: p, body: "ок" })],
    ["image.alt", (p) => ({ type: "image", assetCode: "a", alt: p, caption: "" })],
    ["image.caption", (p) => ({ type: "image", assetCode: "a", alt: "альт", caption: p })],
    ["video.title", (p) => ({ type: "video", assetCode: "a", title: p, captionsAssetCode: null, caption: "" })],
    ["list.items", (p) => ({ type: "list", ordered: false, items: [p] })],
    ["table.headers", (p) => ({ type: "table", caption: "", headers: [p], rows: [["x"]] })],
    ["table.rows", (p) => ({ type: "table", caption: "", headers: ["h"], rows: [[p]] })],
    ["example.body", (p) => ({ type: "example", title: "Пример", body: p })],
    ["common_mistake.mistake", (p) => ({ type: "common_mistake", mistake: p, correction: "ок" })],
    ["glossary.definition", (p) => ({ type: "glossary", entries: [{ term: "T", definition: p }] })],
    ["exercise.instructions", (p) => ({ type: "exercise", code: "e1", title: "З", instructions: p, expectedAction: "ок", estimatedMinutes: null })],
    ["tool_link.label", (p) => ({ type: "tool_link", toolCode: "tool.watchlist", label: p, context: "" })],
    ["cta.label", (p) => ({ type: "cta", action: "next_level", label: p, body: "", toolCode: null })],
    ["download.label", (p) => ({ type: "download", assetCode: "a", label: p, description: "" })],
  ];
  for (const [name, build] of textFields) {
    for (const payload of MALICIOUS) {
      const parsed = contentBlockSchema.safeParse(build(payload));
      assert.equal(parsed.success, false, `${name} accepted ${payload.slice(0, 24)}`);
    }
  }
});

check("20 the legacy v1 body keeps refusing HTML and gains the new hardening", () => {
  for (const payload of ["<script>x</script>", "onerror=x", "javascript:x", "&lt;script&gt;", "текст‮обратный"]) {
    const parsed = contentBodyV1Schema.safeParse({ ...bodyV1(), riskDisclaimer: payload });
    assert.equal(parsed.success, false, `v1 accepted ${payload.slice(0, 24)}`);
  }
  // v1's original allowance is preserved exactly: an https markdown link is legal.
  const httpsLink = contentBodyV1Schema.safeParse({
    ...bodyV1(),
    riskDisclaimer: "Подробнее: [правила](https://example.com)",
  });
  assert.equal(httpsLink.success, true);
  // v2 refuses the same string, because v2 has real link blocks.
  assert.equal(isSafeText("Подробнее: [правила](https://example.com)", "blocks_v2"), false);
});

check("21 ordinary lesson prose is NOT rejected", () => {
  const innocent = [
    "Риск на сделку должен быть < 2% депозита.",
    "Мы разберём это на примере: https://example.com — но открывать ссылку не нужно.",
    "Payout 80% означает, что выигрывать нужно чаще половины сделок.",
    "Цена «отскочила» от зоны — это описание, а не гарантия.",
  ];
  for (const text of innocent) {
    assert.equal(isSafeText(text, "blocks_v2"), true, `false positive: ${text}`);
  }
});

/* ------------------------------------------------------------------ *
 * 5. Reading model and progress anchors
 * ------------------------------------------------------------------ */

check("22 section codes are identical across formats and drive progress anchors", () => {
  const v1 = parseContentBody(bodyV1());
  const v2 = parseContentBody(bodyV2());
  assert.ok(v1.ok && v2.ok);
  assert.deepEqual(contentBodySectionCodes(v1.body), ["intro"]);
  assert.deepEqual(contentBodySectionCodes(v2.body), ["intro"]);
});

check("23 the v1 projection preserves anchors and moves the rest to the appendix", () => {
  const parsed = parseContentBody(bodyV1());
  assert.ok(parsed.ok);
  const normalized = normalizeContentBody(parsed.body);
  assert.equal(normalized.sourceFormat, "legacy_v1");
  assert.deepEqual(normalized.sections.map((s) => s.code), ["intro"]);
  const appendixTypes = normalized.appendix.map((b) => b.type);
  assert.deepEqual(appendixTypes, ["example", "common_mistake", "glossary", "cta", "callout"]);
  // Nothing in the appendix is progress-anchored.
  assert.equal(normalized.sections.length, 1);
});

check("24 a v2 body projects with an empty appendix", () => {
  const parsed = parseContentBody(bodyV2());
  assert.ok(parsed.ok && isBlocksV2(parsed.body));
  assert.deepEqual(normalizeContentBody(parsed.body).appendix, []);
});

check("25 learner-empty content is measurable", () => {
  const empty = parseContentBody(
    bodyV2([HAPPY_BLOCKS.heading, HAPPY_BLOCKS.divider, { type: "cta", action: "next_level", label: "Дальше", body: "", toolCode: null }]),
  );
  assert.ok(empty.ok);
  assert.equal(contentBodyTeachingCharacters(empty.body), 0);

  const real = parseContentBody(bodyV2([{ type: "rich_text", text: "а".repeat(500) }]));
  assert.ok(real.ok);
  assert.equal(contentBodyTeachingCharacters(real.body), 500);
});

check("26 risk disclaimer detection works for both formats", () => {
  const v1 = parseContentBody(bodyV1());
  assert.ok(v1.ok && contentBodyHasRiskDisclaimer(v1.body));

  const withRisk = parseContentBody(bodyV2([HAPPY_BLOCKS.callout]));
  assert.ok(withRisk.ok && contentBodyHasRiskDisclaimer(withRisk.body));

  const withoutRisk = parseContentBody(bodyV2([HAPPY_BLOCKS.rich_text]));
  assert.ok(withoutRisk.ok);
  assert.equal(contentBodyHasRiskDisclaimer(withoutRisk.body), false);
});

check("27 asset and tool references are extracted with their expected kinds", () => {
  const parsed = parseContentBody(
    bodyV2([HAPPY_BLOCKS.image, HAPPY_BLOCKS.video, HAPPY_BLOCKS.download, HAPPY_BLOCKS.tool_link, HAPPY_BLOCKS.cta]),
  );
  assert.ok(parsed.ok);
  const assets = contentBodyAssetReferences(parsed.body);
  assert.deepEqual(
    assets.map((a) => [a.assetCode, a.kinds.join("|")]),
    [
      ["shema-zony", "image|chart"],
      ["urok-video", "video"],
      ["urok-subtitry", "subtitles"],
      ["shablon-plana", "attachment"],
    ],
  );
  const tools = contentBodyToolReferences(parsed.body);
  assert.deepEqual(tools.map((t) => t.toolCode), ["tool.chart_markup", "tool.chart_markup"]);
});

/* ------------------------------------------------------------------ *
 * 6. Package-level asset and tool contracts (§10, §11)
 * ------------------------------------------------------------------ */

const APPROVED_SLICE_PATH = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";

function loadApprovedSlice(): Record<string, unknown> {
  return JSON.parse(readFileSync(APPROVED_SLICE_PATH, "utf8")) as Record<string, unknown>;
}

type MutablePackage = {
  status: string;
  contentFingerprint: string;
  modules: Array<{ levels: Array<Record<string, unknown>> }>;
};

/** Rebuild the fingerprint after mutating a package, so unrelated codes stay quiet. */
function refingerprint(pkg: MutablePackage): MutablePackage {
  pkg.contentFingerprint = calculateFingerprint(pkg as never);
  return pkg;
}

function sliceWithLessonBody(body: unknown, assets: unknown[] = []): MutablePackage {
  const pkg = loadApprovedSlice() as unknown as MutablePackage;
  const lesson = pkg.modules[0].levels[1];
  const content = lesson.content as Record<string, unknown>;
  (content.localizations as Array<Record<string, unknown>>)[0].body = body;
  content.assets = assets;
  return refingerprint(pkg);
}

function codesOf(result: ReturnType<typeof validateCurriculumPackage>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

check("28 a v2 lesson body is accepted by the package validator", () => {
  const pkg = sliceWithLessonBody(
    bodyV2([{ type: "rich_text", text: "а".repeat(500) }, HAPPY_BLOCKS.callout]),
  );
  const result = validateCurriculumPackage(pkg);
  assert.ok(result.ok, JSON.stringify(codesOf(result)));
});

check("29 a block referencing an undeclared asset is refused", () => {
  const pkg = sliceWithLessonBody(bodyV2([HAPPY_BLOCKS.image]));
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("CONTENT_ASSET_REFERENCE_MISSING"));
});

check("30 a block referencing an asset of the wrong kind is refused", () => {
  const pkg = sliceWithLessonBody(bodyV2([HAPPY_BLOCKS.image]), [
    {
      kind: "attachment",
      assetCode: "shema-zony",
      locale: null,
      url: "https://cdn.example.com/a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      durationSeconds: null,
      sortOrder: 0,
    },
  ]);
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("CONTENT_ASSET_REFERENCE_KIND_MISMATCH"));
});

check("31 duplicate asset codes are refused", () => {
  const asset = {
    kind: "image",
    assetCode: "shema-zony",
    locale: null,
    url: "https://cdn.example.com/a.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    durationSeconds: null,
    sortOrder: 0,
  };
  const pkg = sliceWithLessonBody(bodyV2([HAPPY_BLOCKS.rich_text]), [asset, { ...asset, sortOrder: 1 }]);
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("CONTENT_ASSET_CODE_DUPLICATE"));
});

check("32 a non-HTTPS asset URL is refused", () => {
  for (const url of ["http://cdn.example.com/a.png", "javascript:alert(1)", "https://u:p@cdn.example.com/a.png", "/local/a.png"]) {
    const pkg = sliceWithLessonBody(bodyV2([HAPPY_BLOCKS.rich_text]), [
      {
        kind: "image",
        assetCode: "shema-zony",
        locale: null,
        url,
        mimeType: "image/png",
        sizeBytes: 1024,
        durationSeconds: null,
        sortOrder: 0,
      },
    ]);
    const result = validateCurriculumPackage(pkg);
    assert.equal(result.ok, false, `accepted ${url}`);
  }
});

check("33 a known tool code is accepted and an unknown one is refused", () => {
  const known = sliceWithLessonBody(
    bodyV2([{ type: "rich_text", text: "а".repeat(500) }, HAPPY_BLOCKS.callout, HAPPY_BLOCKS.tool_link]),
  );
  assert.ok(validateCurriculumPackage(known).ok, "known tool code must be accepted");

  const unknown = sliceWithLessonBody(
    bodyV2([
      { type: "rich_text", text: "а".repeat(500) },
      HAPPY_BLOCKS.callout,
      { type: "tool_link", toolCode: "tool.does_not_exist", label: "X", context: "" },
    ]),
  );
  assert.ok(codesOf(validateCurriculumPackage(unknown)).includes("CONTENT_TOOL_CODE_UNKNOWN"));
});

check("34 the referral-gated secret tool is a legal reference", () => {
  const pkg = sliceWithLessonBody(
    bodyV2([
      { type: "rich_text", text: "а".repeat(500) },
      HAPPY_BLOCKS.callout,
      { type: "tool_link", toolCode: "tool.secret", label: "Секретный инструмент", context: "" },
    ]),
  );
  assert.ok(validateCurriculumPackage(pkg).ok);
});

/* ------------------------------------------------------------------ *
 * 7. Approved-package content contracts (§16, §17)
 * ------------------------------------------------------------------ */

check("35 an approved package refuses learner-empty content", () => {
  const pkg = sliceWithLessonBody(
    bodyV2([HAPPY_BLOCKS.heading, HAPPY_BLOCKS.divider, HAPPY_BLOCKS.callout]),
  );
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("CONTENT_BODY_LEARNER_EMPTY"));
});

check("36 an approved package refuses content with no risk disclaimer", () => {
  const pkg = sliceWithLessonBody(bodyV2([{ type: "rich_text", text: "а".repeat(500) }]));
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("CONTENT_RISK_DISCLAIMER_MISSING"));
});

check("37 an approved package refuses placeholder markers", () => {
  const pkg = sliceWithLessonBody(
    bodyV2([{ type: "rich_text", text: `TODO дописать урок. ${"а".repeat(500)}` }, HAPPY_BLOCKS.callout]),
  );
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("PLACEHOLDER_IN_APPROVED_PACKAGE"));
});

check("38 the placeholder scan does not fire on legitimate lesson prose", () => {
  const innocent = [
    "Рынок скоро может измениться, и это нормально.",
    "Плацебо-эффект уверенности не заменяет статистику.",
    "Готовиться к сессии нужно заранее.",
  ];
  for (const text of innocent) {
    const pkg = sliceWithLessonBody(
      bodyV2([{ type: "rich_text", text: `${text} ${"а".repeat(500)}` }, HAPPY_BLOCKS.callout]),
    );
    const result = validateCurriculumPackage(pkg);
    assert.ok(result.ok, `false positive on «${text}»: ${JSON.stringify(codesOf(result))}`);
  }
});

/**
 * CORRECTIONS §15 — the Cyrillic placeholder markers were unmatchable.
 *
 * JavaScript's `\b` is defined against `[A-Za-z0-9_]`, so no word boundary can
 * exist beside a Cyrillic letter and every Russian marker silently matched
 * nothing. An approved package could ship «Скоро будет доступно» to a learner.
 * The previous suite could not see it: its only positive case was the Latin
 * `TODO`, and its only Cyrillic cases tested the false-positive direction.
 *
 * Both directions are now covered, marker by marker.
 */
check("38a every Cyrillic placeholder marker is actually rejected in an approved package", () => {
  const mustReject: Array<[string, string]> = [
    ["УТОЧНЯЕТСЯ", "Значение уточняется позже."],
    ["УТОЧНЯЮТСЯ", "Детали уточняются редакцией."],
    ["ЗАГЛУШКА", "Здесь заглушка вместо материала."],
    ["ЗАГЛУШКИ", "Ниже заглушки для примеров."],
    ["ГОТОВИТСЯ", "Материал готовится редакцией."],
    ["ГОТОВЯТСЯ", "Примеры готовятся редакцией."],
    ["СКОРО БУДЕТ", "Скоро будет доступно."],
    ["СКОРО ПОЯВИТСЯ", "Скоро появится полный разбор."],
    ["УЖЕ СКОРО", "Уже скоро."],
    ["В РАЗРАБОТКЕ", "Раздел в разработке."],
    ["ЧЕРНОВИК УРОКА", "Это черновик урока."],
    ["ЧЕРНОВАЯ ВЕРСИЯ", "Черновая версия материала."],
  ];
  for (const [marker, text] of mustReject) {
    const pkg = sliceWithLessonBody(
      bodyV2([{ type: "rich_text", text: `${text} ${"а".repeat(500)}` }, HAPPY_BLOCKS.callout]),
    );
    assert.ok(
      codesOf(validateCurriculumPackage(pkg)).includes("PLACEHOLDER_IN_APPROVED_PACKAGE"),
      `${marker} was NOT rejected: «${text}»`,
    );
  }
});

check("38b legitimate Russian prose is still accepted, marker by marker", () => {
  const mustAccept = [
    "Рынок скоро вернётся к диапазону, но угадывать момент нельзя.",
    "Проверь готовность плана перед сессией.",
    "Подготовка к сессии занимает пятнадцать минут.",
    "Разработка стратегии — это итеративный процесс.",
    "Уровни поддержки — это области реакции, а не гарантированные точки.",
    // «черновик» ALONE is ATA product vocabulary: the learner's own draft.
    "Инструменты и черновики помогают сохранять работу между сессиями.",
    "Сохрани черновик отчёта и вернись к нему позже.",
  ];
  for (const text of mustAccept) {
    const pkg = sliceWithLessonBody(
      bodyV2([{ type: "rich_text", text: `${text} ${"а".repeat(500)}` }, HAPPY_BLOCKS.callout]),
    );
    const result = validateCurriculumPackage(pkg);
    assert.ok(result.ok, `false positive on «${text}»: ${JSON.stringify(codesOf(result))}`);
  }
});

check("38c the shipped APPROVED packages are the false-positive corpus", () => {
  // This is how the «черновик» false positive was found: a marker that looked
  // harmless in isolation rejected operator-approved content that had shipped.
  // Real approved prose is a better adversary than invented examples.
  for (const file of [
    "curriculum/packages/ata-v2-first-slice.approved.json",
    "curriculum/packages/ata-v2-first-slice.rev3.approved.json",
  ]) {
    const result = validateCurriculumPackage(JSON.parse(readFileSync(file, "utf8")));
    assert.ok(result.ok, `${file} must keep validating: ${JSON.stringify(result.ok ? [] : result.issues.slice(0, 4))}`);
  }
});

check("38d a DRAFT still tolerates placeholders in every script", () => {
  for (const text of ["TODO дописать", "Скоро будет доступно", "Значение уточняется"]) {
    const pkg = sliceWithLessonBody(
      bodyV2([{ type: "rich_text", text: `${text} ${"а".repeat(500)}` }, HAPPY_BLOCKS.callout]),
    );
    pkg.status = "draft";
    assert.equal(
      codesOf(validateCurriculumPackage(pkg)).includes("PLACEHOLDER_IN_APPROVED_PACKAGE"),
      false,
      `a draft must tolerate «${text}»`,
    );
  }
});

check("39 an approved package refuses the obsolete product brand", () => {
  const pkg = sliceWithLessonBody(
    bodyV2([{ type: "rich_text", text: `TradeQuest — маршрут обучения. ${"а".repeat(500)}` }, HAPPY_BLOCKS.callout]),
  );
  assert.ok(codesOf(validateCurriculumPackage(pkg)).includes("OBSOLETE_BRAND_IN_APPROVED_PACKAGE"));
});

check("40 a draft package tolerates a missing risk disclaimer but never an unknown tool", () => {
  const draft = sliceWithLessonBody(bodyV2([{ type: "rich_text", text: "Короткий черновик." }]));
  draft.status = "draft";
  refingerprint(draft);
  assert.ok(validateCurriculumPackage(draft).ok, "draft content bar is editorial, not structural");

  const draftBadTool = sliceWithLessonBody(
    bodyV2([{ type: "tool_link", toolCode: "tool.nope", label: "X", context: "" }]),
  );
  draftBadTool.status = "draft";
  refingerprint(draftBadTool);
  assert.ok(codesOf(validateCurriculumPackage(draftBadTool)).includes("CONTENT_TOOL_CODE_UNKNOWN"));
});

/* ------------------------------------------------------------------ *
 * 8. Backward compatibility (§7)
 * ------------------------------------------------------------------ */

check("41 every shipped package still validates with an unchanged fingerprint", () => {
  const expected: Record<string, string> = {
    "curriculum/packages/ata-v2-first-slice.approved.json":
      "7e298cc16bdbbf747db31abe467f017681eb2e7eb24c45990d3e5f689da1293c",
    "curriculum/packages/ata-v2-first-slice.draft.json":
      "4a8fde320fff8e5fb9c46f01415c8189d1c142a52c6c288f25c05cac0d42e229",
    "curriculum/packages/ata-v2-first-slice.rev3.approved.json":
      "860751bff541439ac76858c917ed2572e2b3e92b41109cfbea74122eb46625ad",
  };
  for (const [file, fingerprint] of Object.entries(expected)) {
    const result = validateCurriculumPackage(JSON.parse(readFileSync(file, "utf8")));
    assert.ok(result.ok, `${file}: ${JSON.stringify(codesOf(result))}`);
    assert.equal(result.fingerprint, fingerprint, `${file} fingerprint moved`);
  }
});

check("42 the shipped approved lesson body is still legacy v1 and still parses", () => {
  const pkg = loadApprovedSlice() as unknown as MutablePackage;
  const body = (pkg.modules[0].levels[1].content as Record<string, unknown>);
  const localization = (body.localizations as Array<Record<string, unknown>>)[0];
  assert.equal(probeContentBody(localization.body).kind, "v1");
  const parsed = contentLocalizationPayloadSchema.safeParse(localization);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.ok(contentBodyTeachingCharacters(parsed.data.body) > 1_000);
});

check("43 migrating a body from v1 to v2 moves the fingerprint", () => {
  const before = calculateFingerprint(loadApprovedSlice() as never);
  const after = calculateFingerprint(
    sliceWithLessonBody(bodyV2([{ type: "rich_text", text: "а".repeat(500) }, HAPPY_BLOCKS.callout])) as never,
  );
  assert.notEqual(before, after);
});

console.log(`\ncurriculum content blocks regression: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
