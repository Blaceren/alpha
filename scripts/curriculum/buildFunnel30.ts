/**
 * PROGRAM STRUCTURE (2026-10-02) — the builder of the 30-level program package.
 *
 * ============================== WHAT IT DOES ==============================
 * Assembles `curriculum/packages/ata-v2-funnel-30.v5.draft.json` from ONE input:
 *
 *   curriculum/canonical/ata-funnel-30.source.json
 *
 * which is the product owner's document «Содержание воронки обучения · уровни
 * 1–30» (2026-10-02) carried over word for word, plus what a document does not
 * say and a program needs: stable codes, the learner-facing kind of each level,
 * its completion pair, its XP reward, which levels are open, and which level
 * opens which tool.
 *
 * It reads no other repository, opens no database, makes no network call and
 * uses no clock or randomness. Same input → byte-identical output → identical
 * fingerprint. `--check` proves the checked-in artifact still matches its input.
 *
 *   tsx scripts/curriculum/buildFunnel30.ts [--curriculum-version-number N] [--check]
 *
 * ========================== WHAT IT REFUSES TO DO ==========================
 * IT WRITES NO LESSON. A lesson of this program is a video; what the owner
 * wrote about each one is two short paragraphs — what it is about and what the
 * learner takes away — and those are carried verbatim. Where the document says
 * a level is not produced yet, the level is emitted CLOSED (`status:
 * "disabled"`) with no content at all, and a `pendingApprovals` entry says what
 * is outstanding. Nothing is filled in to make a level look finished.
 *
 * IT INVENTS NO TEST. Every question, option, correct answer, explanation and
 * rewatch second comes from the source; the builder assigns option codes a–d by
 * position and nothing else.
 *
 * THE PACKAGE IS A DRAFT, and says so: videos are not on the platform yet, two
 * levels of the first chapter are not produced, and two assignments have no
 * forms. A draft may be imported and — because every resource a learner needs
 * on an OPEN level ships `published` — the resulting version can be published;
 * the outstanding items are listed, not hidden.
 *
 * ============================ THE LEVEL-9 REPORT ============================
 * «Ручной проверки нет. Система проверяет формально: пять записей сделок,
 * обязательные поля, минимум один отказ, основание не пустое.» So level 9 is
 * `report:formal_check`: five trade records of ten fields each and one record
 * of a refused entry are REQUIRED fields of the form; two more refusal records
 * can be added. The rubric is the written statement of what the check looks at
 * — `LevelReportBinding` requires one — and nobody scores against it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import type {
  CurriculumPackage,
  PackageLevel,
  PackageLevelKind,
  ProvenanceRecord,
} from "@/lib/curriculum/package/schema";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import type { ContentBodyV2 } from "@/lib/curriculum/content-blocks";

const REPO_ROOT = process.cwd();
const SOURCE_PATH = "curriculum/canonical/ata-funnel-30.source.json";
const PACKAGE_CODE = "ata-v2.funnel-30";
const PACKAGE_REVISION = 1;
const LOCALE = "ru";

/**
 * The version this program was first built as. An explicit build input for the
 * reason `buildCanonical100.ts` gives at length: the artifact is the release
 * identity, and a version taken from a database would make two builds of one
 * source disagree.
 */
const DEFAULT_CURRICULUM_VERSION_NUMBER = 5;

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

type SourceQuestion = {
  question: string;
  options: string[];
  correct: string;
  explanation: string;
  rewatchFromSeconds: number;
  takeaway?: string;
};

type SourceLevel = {
  number: number;
  slug: string;
  kind: PackageLevelKind;
  open: boolean;
  type: PackageLevel["type"];
  completionMethod: string;
  xpReward: number;
  xpRewardStatus: "approved" | "unresolved";
  title: string;
  lessonTitle: string;
  description: string;
  result: string | null;
  productionNote?: string;
  test?: SourceQuestion[];
  assignment?: Record<string, unknown>;
};

type Source = {
  source: { document: string; from: string; receivedOn: string; sha256: string };
  curriculum: { code: string; title: string; description: string };
  chapters: Array<{ number: number; title: string }>;
  modules: Array<{ number: number; title: string; chapter: number; levels: number[] }>;
  toolUnlocks: Array<{ toolCode: string; level: number }>;
  levels: SourceLevel[];
};

function readSource(): Source {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, SOURCE_PATH), "utf8")) as Source;
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function levelCode(level: SourceLevel): string {
  return `v2.l${pad(level.number, 3)}.${level.slug}`;
}

function moduleCode(moduleNumber: number): string {
  return `module.${pad(moduleNumber, 2)}`;
}

function resourceCode(level: SourceLevel, suffix: string): string {
  return `ata-v2.l${pad(level.number, 3)}.${suffix}`;
}

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

/** Everything here was handed over by the product owner as the program to build. */
function ownerProvenance(source: Source, sourceRef: string): ProvenanceRecord {
  return {
    classification: "EXPLICIT_OPERATOR_APPROVAL",
    sourcePath: SOURCE_PATH,
    sourceRef,
    revision: `sha256:${source.source.sha256.slice(0, 16)}`,
    confidence: "high",
    conflicts: [],
    approvalRequired: false,
    note: `${source.source.document} (${source.source.from}, ${source.source.receivedOn}).`,
  };
}

/** Identity and contract the document does not state: derived here, reviewed in the source file. */
function structureProvenance(source: Source, sourceRef: string): ProvenanceRecord {
  return {
    classification: "EXPLICIT_OPERATOR_APPROVAL",
    sourcePath: SOURCE_PATH,
    sourceRef,
    revision: `sha256:${source.source.sha256.slice(0, 16)}`,
    confidence: "high",
    conflicts: [],
    approvalRequired: false,
    note: "Level order, titles and kinds are the owner's plan; the stable code, the completion pair and the reward are assigned in the canonical source.",
  };
}

/* ------------------------------------------------------------------ *
 * Lesson bodies — the document's own words, arranged
 * ------------------------------------------------------------------ */

type Section = ContentBodyV2["sections"][number];

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function aboutSection(level: SourceLevel): Section {
  return {
    code: "o-chem",
    title: "О чём урок",
    blocks: [{ type: "rich_text", text: level.description }],
  };
}

/** Level 9 — the assignment exactly as the owner's «L9 · ЗАДАНИЕ» lays it out. */
function demoTradesSections(level: SourceLevel): Section[] {
  const assignment = level.assignment ?? {};
  const trade = (assignment.tradeRecord ?? {}) as { beforeEntry?: unknown; afterExpiry?: unknown };
  const refusal = (assignment.refusalRecord ?? {}) as { fields?: unknown; note?: unknown };
  return [
    aboutSection(level),
    {
      code: "zadanie",
      title: "Задание",
      blocks: [
        { type: "rich_text", text: String(assignment.task) },
        { type: "heading", level: 3, text: "Порядок по каждому подходу к графику" },
        { type: "list", ordered: true, items: strings(assignment.orderPerApproach) },
        { type: "callout", variant: "key_idea", title: "", body: String(assignment.note) },
      ],
    },
    {
      code: "zapisi",
      title: "Что записывать",
      blocks: [
        { type: "heading", level: 3, text: "Запись сделки" },
        {
          type: "rich_text",
          text: [
            `До входа: ${strings(trade.beforeEntry).join(" · ")}.`,
            `После экспирации: ${strings(trade.afterExpiry).join(" · ")}.`,
          ].join("\n\n"),
        },
        { type: "heading", level: 3, text: "Запись отказа" },
        {
          type: "rich_text",
          text: `${capitalised(strings(refusal.fields).join(" · "))}. ${String(refusal.note)}`,
        },
      ],
    },
    /* NO «ПРОВЕРКА» SECTION IN THE LESSON. The document's «ПРОВЕРКА» and
       «СВЕРКА С ОБРАЗЦОМ» paragraphs are written for the people building the
       level, not for the learner taking it: «содержательную сверку ученик
       делает сам по заполненному образцу», «в образце обязательно и удачные, и
       неудачные сделки, и хотя бы одна формулировка средней руки». The second
       is a requirement on a sample that does not exist yet.

       What a learner needs from them is said once, by the report itself: its
       criteria line states what the check looks at and what it does not
       (`demoTradesReport`). The comparison with a sample returns here together
       with the sample. */
  ];
}

/** Level 13 — «L13 · ЗАДАНИЕ»: two documents, three checks by hand, when the plan may change. */
function riskPlanSections(level: SourceLevel): Section[] {
  const assignment = level.assignment ?? {};
  return [
    aboutSection(level),
    {
      code: "zadanie",
      title: "Задание",
      blocks: [
        { type: "rich_text", text: String(assignment.task) },
        { type: "heading", level: 3, text: "Risk Plan · восемь пунктов" },
        { type: "list", ordered: true, items: strings(assignment.riskPlan) },
        { type: "heading", level: 3, text: "Чек-лист перед входом · семь пунктов" },
        { type: "list", ordered: true, items: strings(assignment.checklist).map(capitalised) },
        { type: "callout", variant: "key_idea", title: "", body: String(assignment.checklistNote) },
      ],
    },
    {
      code: "tri-proverki",
      title: "Три проверки руками",
      blocks: [{ type: "list", ordered: true, items: strings(assignment.handChecks) }],
    },
    {
      code: "peresmotr-plana",
      title: "Пересмотр плана",
      blocks: [{ type: "rich_text", text: String(assignment.planRevision) }],
    },
  ];
}

/** Level 14 — «L14 · ЗАДАНИЕ»: three real trades, four questions, what counts as done. */
function realTradesSections(level: SourceLevel): Section[] {
  const assignment = level.assignment ?? {};
  return [
    aboutSection(level),
    {
      code: "zadanie",
      title: "Задание",
      blocks: [{ type: "rich_text", text: String(assignment.task) }],
    },
    {
      code: "ocenka",
      title: "Оценка · четыре вопроса к каждой сделке",
      blocks: [
        { type: "list", ordered: true, items: strings(assignment.fourQuestions) },
        { type: "rich_text", text: String(assignment.comparedWith) },
        {
          type: "callout",
          variant: "info",
          title: "",
          body: sentence(`Не оценивается: ${String(assignment.notEvaluated)}`),
        },
      ],
    },
    {
      code: "esli-narushil",
      title: "Если нарушил",
      blocks: [{ type: "rich_text", text: String(assignment.ifViolated) }],
    },
    {
      code: "sverka-s-soboy-proshlym",
      title: "Сверка с собой прошлым",
      blocks: [{ type: "rich_text", text: String(assignment.comparisonWithPast) }],
    },
  ];
}

function bodyFor(level: SourceLevel): ContentBodyV2 {
  const sections =
    level.number === 9
      ? demoTradesSections(level)
      : level.number === 13
        ? riskPlanSections(level)
        : level.number === 14
          ? realTradesSections(level)
          : [aboutSection(level)];
  return { format: "ata.lesson.blocks", version: 2, sections };
}

/* ------------------------------------------------------------------ *
 * Content, assessment, report, gate
 * ------------------------------------------------------------------ */

function contentFor(source: Source, level: SourceLevel): PackageLevel["content"] {
  // A gate carries no lesson content (the package validator refuses one), and a
  // level that is not open has nothing to read.
  if (!level.open || level.type === "external_event") return null;
  return {
    contentCode: resourceCode(level, "content"),
    versionNumber: 1,
    status: "published",
    // The video is registered separately (`LessonMediaAsset`), with its real
    // length, when the file reaches the platform. No duration is claimed here.
    videoDurationSeconds: null,
    localizations: [
      {
        locale: LOCALE,
        title: level.lessonTitle,
        subtitle: "",
        learningObjectiveExtension: level.result ?? "",
        summary: "",
        transcript: null,
        body: bodyFor(level),
      },
    ],
    assets: [],
    provenance: ownerProvenance(source, `Урок ${level.number} · «О чём», «Что получает ученик»`),
  };
}

const OPTION_CODES = ["a", "b", "c", "d"] as const;

function assessmentFor(source: Source, level: SourceLevel): PackageLevel["assessment"] {
  if (!level.test) return null;
  return {
    assessmentCode: resourceCode(level, "assessment"),
    versionNumber: 1,
    status: "published",
    // Four questions, all four needed: the owner's tests explain a wrong answer
    // and send the learner back to the video, and attempts are unlimited.
    passPercent: 100,
    maxAttempts: null,
    showExplanation: true,
    questions: level.test.map((question, index) => {
      if (question.options.length !== OPTION_CODES.length) {
        throw new Error(`level ${level.number} question ${index + 1} must have four options`);
      }
      if (!(OPTION_CODES as readonly string[]).includes(question.correct)) {
        throw new Error(`level ${level.number} question ${index + 1} names an unknown correct option`);
      }
      return {
        questionCode: resourceCode(level, `q${index + 1}`),
        questionNumber: index + 1,
        type: "single_choice" as const,
        skillTag: null,
        optionCodes: [...OPTION_CODES],
        correctOptionCodes: [question.correct],
        correctNumericValue: null,
        localizations: [
          {
            locale: LOCALE,
            prompt: question.question,
            optionLabels: question.options,
            explanation: question.explanation,
          },
        ],
        lessonTakeawayRef: question.takeaway ?? null,
        rewatchFromSeconds: question.rewatchFromSeconds,
        provenance: ownerProvenance(source, `L${level.number} · ТЕСТ · вопрос ${index + 1}`),
      };
    }),
    provenance: ownerProvenance(source, `L${level.number} · ТЕСТ`),
  };
}

type ReportField = NonNullable<PackageLevel["report"]>["fields"][number];

/**
 * The level-9 form. The field LIST is the document's («ЗАПИСЬ СДЕЛКИ», «ЗАПИСЬ
 * ОТКАЗА»); the keys, types and bounds are assigned here.
 *
 * "Non-empty" is the whole text rule, because that is the whole check the owner
 * asked for («основание не пустое»). A lower bound on length would be a
 * judgement about quality the document explicitly leaves to the learner.
 */
function demoTradesFields(): ReportField[] {
  const fields: ReportField[] = [];
  let sortOrder = 0;
  const add = (
    stableKey: string,
    type: ReportField["type"],
    label: string,
    options: {
      required?: boolean;
      maxLength?: number;
      choices?: ReadonlyArray<readonly [string, string]>;
      requiredWhen?: ReportField["requiredWhen"];
      helpText?: string;
      placeholder?: string;
    } = {},
  ) => {
    const text = type === "short_text" || type === "long_text";
    fields.push({
      stableKey,
      type,
      required: options.requiredWhen ? false : (options.required ?? true),
      sortOrder,
      minLength: text ? 1 : null,
      maxLength: text ? (options.maxLength ?? (type === "short_text" ? 60 : 1_000)) : null,
      choiceCodes: (options.choices ?? []).map(([code]) => code),
      ...(options.requiredWhen ? { requiredWhen: options.requiredWhen } : {}),
      localizations: [
        {
          locale: LOCALE,
          label,
          helpText: options.helpText ?? "",
          placeholder: options.placeholder ?? "",
          choiceLabels: (options.choices ?? []).map(([, choiceLabel]) => choiceLabel),
        },
      ],
    });
    sortOrder += 1;
  };

  const SOURCE_KIND = [
    ["exchange", "Биржевой"],
    ["otc", "Внебиржевой (OTC)"],
  ] as const;

  for (let trade = 1; trade <= 5; trade += 1) {
    const key = (name: string) => `trade${trade}-${name}`;
    // До входа
    add(key("datetime"), "short_text", "Дата и время", { maxLength: 40 });
    add(key("asset"), "short_text", "Актив");
    add(key("source"), "single_choice", "Биржевой или внебиржевой", { choices: SOURCE_KIND });
    add(key("direction"), "single_choice", "Направление", {
      choices: [
        ["up", "Вверх"],
        ["down", "Вниз"],
      ],
    });
    add(key("amount"), "short_text", "Сумма", { maxLength: 30 });
    add(key("payout"), "short_text", "Payout", { maxLength: 10 });
    add(key("expiry"), "short_text", "Момент экспирации", { maxLength: 40 });
    add(key("basis"), "long_text", "Основание словами");
    // После экспирации
    add(key("result"), "single_choice", "Результат", {
      choices: [
        ["profit", "В плюс"],
        ["loss", "В минус"],
        ["refund", "Возврат"],
      ],
    });
    add(key("change"), "long_text", "Что бы изменил");
  }

  for (let refusal = 1; refusal <= 3; refusal += 1) {
    const key = (name: string) => `refusal${refusal}-${name}`;
    // The first refusal record is part of the check («минимум один отказ»). The
    // second and third are the learner's to add: a switch, then the same five
    // fields, required only when the switch is on.
    const requiredWhen =
      refusal === 1
        ? undefined
        : ({ fieldCode: key("added"), operator: "equals", value: true } as const);
    if (refusal > 1) {
      add(key("added"), "boolean", "Добавить ещё одну запись отказа", { required: false });
    }
    add(key("datetime"), "short_text", "Дата и время", { maxLength: 40, requiredWhen });
    add(key("asset"), "short_text", "Актив", { requiredWhen });
    add(key("source"), "single_choice", "Биржевой или внебиржевой", { choices: SOURCE_KIND, requiredWhen });
    add(key("checked"), "long_text", "Что проверялось", { requiredWhen });
    add(key("why"), "long_text", "Почему не подошло", { requiredWhen });
  }
  return fields;
}

function reportFor(source: Source, level: SourceLevel): PackageLevel["report"] {
  if (level.type !== "report") return null;
  const assignment = level.assignment ?? {};
  const provenance = ownerProvenance(source, `L${level.number} · ЗАДАНИЕ`);
  const criteria: ReadonlyArray<readonly [string, string, string]> = [
    ["f1", "Пять записей сделок", "В отчёте пять записей сделок на demo-счёте."],
    ["f2", "Обязательные поля", "В каждой записи заполнены все обязательные поля."],
    ["f3", "Минимум один отказ", "В отчёте есть хотя бы одна запись отказа."],
    ["f4", "Основание не пустое", "В каждой записи сделки основание сформулировано словами."],
  ];
  return {
    reportCode: resourceCode(level, "report"),
    versionNumber: 1,
    status: "published",
    localizations: [
      {
        locale: LOCALE,
        title: "Отчёт: первые пять demo-сделок",
        instructions: [
          "Пять записей сделок и хотя бы одна запись отказа.",
          String(assignment.note),
          "Результат и «что бы изменил» — после экспирации.",
        ].join(" "),
        successCriteriaSummary: [
          "Ручной проверки нет. Система проверяет формально: пять записей сделок, обязательные поля, минимум один отказ, основание не пустое.",
          sentence(`Не проверяется: ${String(assignment.notChecked)}`),
        ].join(" "),
        submitLabel: "Сдать отчёт",
      },
    ],
    fields: demoTradesFields(),
    attachmentsAllowed: false,
    maxAttachments: 0,
    draftAllowed: true,
    mentorReviewRequired: false,
    rubric: {
      rubricCode: resourceCode(level, "rubric"),
      versionNumber: 1,
      status: "published",
      // What the formal check looks at, written down. Nobody scores against it.
      criteria: criteria.map(([stableKey, title, description], index) => ({
        stableKey,
        categoryCode: "formal",
        sortOrder: index,
        commentRequired: false,
        localizations: [{ locale: LOCALE, title, description }],
      })),
      scaleOptions: [
        {
          stableKey: "meets",
          ordinal: 0,
          localizations: [{ locale: LOCALE, label: "Выполнено", description: "" }],
        },
      ],
      // Required by the report schema, and never used: a formally accepted
      // report is never sent back.
      rejectionReasons: [
        {
          stableKey: "incomplete",
          sortOrder: 0,
          active: true,
          localizations: [
            {
              locale: LOCALE,
              title: "Отчёт заполнен не полностью",
              guidance: "Не заполнено обязательное поле записи сделки или записи отказа.",
            },
          ],
        },
      ],
      provenance,
    },
    provenance,
  };
}

function gateFor(source: Source, level: SourceLevel): PackageLevel["gate"] {
  if (level.type !== "external_event") return null;
  return {
    completionSource: "external_event",
    integrationCode: "pocket.registration",
    selfCompletable: false,
    blockedExplanation: [
      {
        locale: LOCALE,
        // The sentence the 100-level program's registration level carries, with
        // its first word corrected: this level is completed, not opened, by it.
        text: "Уровень завершается после регистрации и подтверждения аккаунта Pocket. Подтверждение приходит от внешней системы — его нельзя отметить вручную.",
      },
    ],
    provenance: structureProvenance(source, `Уровень ${level.number} — регистрация`),
  };
}

/* ------------------------------------------------------------------ *
 * What is still outstanding — said, not hidden
 * ------------------------------------------------------------------ */

type Pending = CurriculumPackage["pendingApprovals"][number];

function pendingFor(level: SourceLevel): Pending[] {
  const code = levelCode(level);
  const pending: Pending[] = [];
  const add = (element: Pending["element"], detail: string, blocksReadiness: boolean) =>
    pending.push({ levelCode: code, element, classification: "MISSING", detail, blocksReadiness });

  if (!level.open) {
    add(
      "lesson_content",
      `Уровень ${level.number}: сценария пока нет — есть название и одна строка. Уровень закрыт до выхода урока.`,
      true,
    );
    return pending;
  }
  if (level.number === 2) {
    add("lesson_content", "Уровень 2: урок не начат, ждёт готовый продукт. Опубликовано только описание.", true);
  } else if (level.type === "external_event") {
    add("lesson_content", "Уровень 3: обзор терминала не начат — не хватает экрана регистрации.", false);
  } else {
    add(
      "video_reference",
      `Уровень ${level.number}: видео смонтировано, файл ещё не зарегистрирован на платформе.`,
      true,
    );
  }
  if (level.number === 9) {
    add("report_prompt", "Уровень 9: заполненный образец для самостоятельной сверки не передан.", false);
  }
  if (level.number === 13) {
    add(
      "report_fields",
      "Уровень 13: отдельный файл задания с бланками и критериями самопроверки пока не подготовлен.",
      false,
    );
  }
  if (level.number === 14) {
    add("report_fields", "Уровень 14: отдельный файл задания с критериями пока не подготовлен.", false);
  }
  return pending;
}

/* ------------------------------------------------------------------ *
 * The package
 * ------------------------------------------------------------------ */

function levelFor(source: Source, level: SourceLevel, previous: SourceLevel | null): PackageLevel {
  return {
    levelCode: levelCode(level),
    levelNumber: level.number,
    type: level.type,
    title: level.title,
    shortDescription: level.description,
    // «Что получает ученик», where the document states one. Otherwise the line
    // the document does give about the level — a level must say what it is for.
    learningObjective: level.result ?? (level.description || level.title),
    completionMethod: level.completionMethod,
    xpReward: level.xpReward,
    requiredXp: 0,
    xpRewardStatus: level.xpRewardStatus,
    prerequisiteLevelCodes: previous ? [levelCode(previous)] : [],
    checkpointLevelCode: null,
    estimatedDurationSeconds: null,
    kind: level.kind,
    ...(level.open ? {} : { status: "disabled" as const }),
    content: contentFor(source, level),
    assessment: assessmentFor(source, level),
    report: reportFor(source, level),
    gate: gateFor(source, level),
    provenance: structureProvenance(source, `План уровней · ${level.number}`),
  };
}

function buildPackage(curriculumVersionNumber: number): CurriculumPackage {
  const source = readSource();
  const byNumber = new Map(source.levels.map((level) => [level.number, level]));
  const chapterTitle = new Map(source.chapters.map((chapter) => [chapter.number, chapter.title]));

  const draft: CurriculumPackage = {
    schemaVersion: "ata.curriculum.package/1",
    minImporterVersion: 1,
    packageCode: PACKAGE_CODE,
    packageRevision: PACKAGE_REVISION,
    status: "draft",
    curriculumCode: source.curriculum.code,
    curriculumVersionNumber,
    curriculumTitle: source.curriculum.title,
    curriculumDescription: source.curriculum.description,
    locale: LOCALE,
    createdFrom: `scripts/curriculum/buildFunnel30.ts — ${SOURCE_PATH}: ${source.source.document} (${source.source.from}, ${source.source.receivedOn})`,
    approval: { approvedBy: null, approvedAt: null, note: null },
    pendingApprovals: source.levels.flatMap(pendingFor),
    contentFingerprint: "0".repeat(64),
    toolUnlocks: source.toolUnlocks.map((unlock) => {
      const level = byNumber.get(unlock.level);
      if (!level) throw new Error(`tool ${unlock.toolCode} is opened by a level the source does not have`);
      return { toolCode: unlock.toolCode, levelCode: levelCode(level) };
    }),
    modules: source.modules.map((moduleDefinition) => {
      const title = chapterTitle.get(moduleDefinition.chapter);
      if (!title) throw new Error(`module ${moduleDefinition.number} names an unknown chapter`);
      return {
        moduleCode: moduleCode(moduleDefinition.number),
        moduleNumber: moduleDefinition.number,
        title: moduleDefinition.title,
        description: "",
        // The document names a module and says nothing more about it.
        learningObjective: moduleDefinition.title,
        checkpointLevelCode: null,
        chapter: { number: moduleDefinition.chapter, title },
        levels: moduleDefinition.levels.map((number) => {
          const level = byNumber.get(number);
          if (!level) throw new Error(`module ${moduleDefinition.number} names level ${number}, which the source does not have`);
          return levelFor(source, level, byNumber.get(number - 1) ?? null);
        }),
      };
    }),
  };
  return { ...draft, contentFingerprint: calculateFingerprint(draft) };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseVersion(argv: string[]): number {
  const index = argv.indexOf("--curriculum-version-number");
  if (index < 0) return DEFAULT_CURRICULUM_VERSION_NUMBER;
  const raw = argv[index + 1];
  // Digits only, for the reason the canonical-100 builder gives: a coerced value
  // here becomes a curriculum identity in a published database.
  if (raw === undefined || !/^[1-9]\d{0,3}$/.test(raw)) {
    throw new Error(`--curriculum-version-number must be a positive integer written in digits, got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

export function funnel30PackagePath(curriculumVersionNumber: number): string {
  return `curriculum/packages/ata-v2-funnel-30.v${curriculumVersionNumber}.draft.json`;
}

export function serializeFunnel30Package(curriculumVersionNumber: number): string {
  return `${JSON.stringify(buildPackage(curriculumVersionNumber), null, 2)}\n`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const version = parseVersion(argv);
  const serialized = serializeFunnel30Package(version);
  const output = path.join(REPO_ROOT, funnel30PackagePath(version));

  const validation = validateCurriculumPackage(JSON.parse(serialized));
  if (!validation.ok) {
    console.error("the built package does not validate:");
    for (const item of validation.issues) console.error(`  ${item.code}  ${item.path}: ${item.message}`);
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--check")) {
    let existing: string | null = null;
    try {
      existing = readFileSync(output, "utf8");
    } catch {
      existing = null;
    }
    if (existing !== serialized) {
      console.error(`${funnel30PackagePath(version)} has drifted from ${SOURCE_PATH}; rebuild it`);
      process.exitCode = 1;
      return;
    }
    console.log(`ok  ${funnel30PackagePath(version)} matches its source  fingerprint=${validation.fingerprint}`);
    return;
  }

  writeFileSync(output, serialized);
  const levels = validation.package.modules.flatMap((moduleDefinition) => moduleDefinition.levels);
  console.log(
    JSON.stringify(
      {
        written: funnel30PackagePath(version),
        fingerprint: validation.fingerprint,
        modules: validation.package.modules.length,
        levels: levels.length,
        openLevels: levels.filter((level) => level.status !== "disabled").length,
        assessments: levels.filter((level) => level.assessment).length,
        questions: levels.reduce((total, level) => total + (level.assessment?.questions.length ?? 0), 0),
        reports: levels.filter((level) => level.report).length,
        reportFields: levels.reduce((total, level) => total + (level.report?.fields.length ?? 0), 0),
        toolUnlocks: validation.package.toolUnlocks?.length ?? 0,
        pendingApprovals: validation.package.pendingApprovals.length,
        warnings: validation.warnings.length,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && process.argv[1].endsWith("buildFunnel30.ts")) {
  main();
}
