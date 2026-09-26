/**
 * PHASE-C — the canonical ATA-100 package builder.
 *
 * ============================== WHAT IT DOES ==============================
 * Assembles `curriculum/packages/ata-v2-canonical-100.draft.json` from four
 * Backend-owned inputs and nothing else:
 *
 *   1. `src/lib/curriculum/product-ata-100.ts`
 *        structure — 100 levels, 20 modules, titles, kinds, checkpoints.
 *   2. `curriculum/canonical/ata-100-editorial-source.json`
 *        the transferred editorial BRIEF (hooks, what to cover, main ideas).
 *   3. `curriculum/packages/ata-v2-first-slice.rev3.approved.json`
 *        the approved first slice, so L1–L4 keep their APPROVED content
 *        verbatim instead of being regenerated at draft quality.
 *   4. `src/lib/curriculum/product-xp-policy.ts`  (PHASE-F)
 *        the approved XP schedule. It prices a level by its canonical
 *        COMPLETION PAIR, so the reward follows the kind of work rather than
 *        the level number — and the editorial source stays out of it entirely.
 *        XP is runtime product policy; the Blueprint did not author it and this
 *        builder does not pretend it did.
 *
 * It reads NO other repository, opens no database, makes no network call and
 * uses no clock or randomness. Same inputs → byte-identical output → identical
 * fingerprint. `--check` proves the checked-in artifact still matches its
 * inputs, which is how editorial drift is caught in CI rather than at import.
 *
 * ========================= WHICH VERSION IT BUILDS =========================
 *   tsx scripts/curriculum/buildCanonical100.ts [--curriculum-version-number N]
 *                                               [--package-revision R]
 *                                               [--check]
 *
 * The target curriculum version is an explicit build input with a retained
 * default of 3, and each version writes to its own file — so v3 stays exactly
 * where and what it was while a successor is built beside it. See
 * `DEFAULT_CURRICULUM_VERSION_NUMBER` for why the value is never allocated from
 * a database.
 *
 * ========================== WHAT IT REFUSES TO DO ==========================
 * It does not write lessons. The brief is a brief: a hook, a list of things to
 * cover, sometimes a main idea. Turning that into a lesson is editorial work,
 * and pretending otherwise is exactly the dishonesty §18 forbids. So every
 * level it generates content for is emitted as `status: "draft"` with
 * `approvalRequired: true` provenance and an explicit `pendingApprovals` entry,
 * and the package as a whole is `status: "draft"`. Nothing here can ever produce
 * an approved package; promoting one is a human act performed against
 * `docs/CONTENT_AUTHORING_TEMPLATE.md`.
 *
 * It also inserts no filler. Where the brief has no material for a slot, the
 * corresponding block is simply absent and the resulting body is short — which
 * is then reported, accurately, as an editorial gap.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ATA_LEVELS,
  ATA_MODULES,
  canonicalLevelCode,
  canonicalModuleCode,
  completionContractFor,
  gateIntegrationCode,
  checkpointRequirementFor,
  pad3,
  type AtaLevelSource,
} from "@/lib/curriculum/product-ata-100";
import {
  ataXpRewardForLevel,
  ataXpRewardStatusForLevel,
} from "@/lib/curriculum/product-xp-policy";
import { findObsoleteBrand } from "@/lib/curriculum/product-vocabulary";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import {
  calculateEducationalPayloadDigest,
  calculateSemanticEquivalenceDigest,
} from "@/lib/curriculum/package/successor-equivalence";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import { reportRubricSchema } from "@/lib/curriculum/package/schema";
import {
  ATA_100_PACKAGE_CODE,
  validateAtaProduct100Package,
} from "@/lib/curriculum/package/ata-profile";
import type { ContentBodyV2 } from "@/lib/curriculum/content-blocks";
import {
  VIDEO_LESSON_SECTION_TITLES,
  parseVideoProductionContracts,
  type VideoLessonSectionCode,
  type VideoProductionContract,
  type VideoProductionContractsFile,
} from "@/lib/curriculum/video-production-contract";
import { validateAtaVideoContracts } from "@/lib/curriculum/package/ata-video-profile";

const REPO_ROOT = process.cwd();
const EDITORIAL_SOURCE = path.join(REPO_ROOT, "curriculum/canonical/ata-100-editorial-source.json");
const VIDEO_CONTRACTS = path.join(REPO_ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json");
const APPROVED_SLICE = path.join(REPO_ROOT, "curriculum/packages/ata-v2-first-slice.rev3.approved.json");

const PACKAGE_CODE = ATA_100_PACKAGE_CODE;
const LOCALE = "ru";

/**
 * ========================= WHAT A PACKAGE REVISION IS =========================
 *
 * `packageRevision` denotes the revision of the package's declared CONTENT AND
 * CONFIGURATION payload, and bumping it is an act of operator approval — the
 * meaning `ata-v2.first-slice` established when it went 1 → 2 → 3, and the
 * meaning `docs/L4_CHECKPOINT_HANDOFF.md` names when it says a real requirement
 * store needs "a package revision that carries it — which means operator content
 * approval, as rev2 and rev3 did". It is NOT the curriculum version: that is
 * `curriculumVersionNumber`, and the two are independent.
 *
 *   revision 1  structure, content, assessments, the report assignment, gate
 *               integration codes. What `ata-v2@v3` was published from and what
 *               the intermediate `ata-v2@v4` artifact carried.
 *
 *   revision 2  revision 1, plus the PROGRESSION OWNER CONFIGURATION the runtime
 *               needs to complete a level: the level-3 report rubric and the 20
 *               financial-checkpoint thresholds. Nothing educational differs —
 *               that is provable, and proved, by the semantic-equivalence digest.
 *
 * The revision is an explicit build input for the same reason the version is:
 * revision 1 must stay buildable, byte for byte, so the accepted `ata-v2@v3`
 * artifact remains reproducible from source and its fingerprint keeps meaning
 * what the activation manifest says it means. A `if (versionNumber === 3)`
 * special case would have made history a side effect of the new code instead of
 * a contract the builder still honours.
 */
const DEFAULT_PACKAGE_REVISION = 1;

/** The first revision whose payload includes progression-owner configuration. */
const PROGRESSION_OWNER_REVISION = 2;

/** The highest revision this builder knows how to compose. */
const MAX_PACKAGE_REVISION = PROGRESSION_OWNER_REVISION;

/** The canonical rubric source, promoted from the accepted predecessor rubric. */
const REPORT_RUBRIC_SOURCE = path.join(
  REPO_ROOT,
  "curriculum/canonical/ata-v2-l003-report-rubric.v1.json",
);

/**
 * PHASE-G2 SUCCESSOR — the target curriculum version is a BUILD INPUT.
 *
 * `ata-v2@v3` was published with its 58 assessment banks unbound, which
 * `assertParentDraft` makes permanent: there is no unpublish, so the defect can
 * only be repaired by a SUCCESSOR version. The importer takes
 * `curriculumVersionNumber` from the package and nothing else — deliberately,
 * because the artifact is the release identity and a runtime flag that could
 * retarget it would make an accepted fingerprint meaningless. That authority
 * stays exactly where it is; what was missing is the ability to BUILD an
 * artifact that declares a different version, and that is what this adds.
 *
 * The value is EXPLICIT AND SOURCE-DEFINED. It is never allocated from a
 * database, an environment variable, a clock or "one more than the highest row
 * in PREPROD" — every one of those would make the artifact a function of live
 * state, so two builds of the same source could disagree and no fingerprint
 * could be pinned in advance.
 *
 * `DEFAULT_CURRICULUM_VERSION_NUMBER` is the RETAINED repository contract: an
 * invocation with no explicit version keeps building the historical v3 artifact
 * at its historical path, so `--check`, the ATA-100 regression and the accepted
 * activation manifest all keep meaning what they meant.
 */
const DEFAULT_CURRICULUM_VERSION_NUMBER = 3;

/**
 * Where a build for `versionNumber` is written.
 *
 * v3 keeps the unsuffixed filename it has always had. That is not cosmetic: the
 * accepted activation manifest pins that path, the ATA-100 regression reads it
 * by name, and `docs/CURRICULUM_PACKAGES.md` documents it — renaming it to fit a
 * new scheme would rewrite history to make the new code tidier. Every other
 * version gets a version-keyed sibling, so successors accumulate beside their
 * predecessor and no build can ever overwrite an accepted artifact.
 */
function outputPathFor(versionNumber: number, packageRevision: number): string {
  const version =
    versionNumber === DEFAULT_CURRICULUM_VERSION_NUMBER
      ? "ata-v2-canonical-100"
      : `ata-v2-canonical-100.v${versionNumber}`;
  // Revision 1 keeps the historical names for the same reason v3 keeps its:
  // those paths are pinned by accepted artifacts. A revision that carries new
  // payload is a new artifact and gets its own file, so no build can ever
  // overwrite one that has already been accepted.
  const revision = packageRevision === DEFAULT_PACKAGE_REVISION ? "" : `.rev${packageRevision}`;
  return path.join(REPO_ROOT, "curriculum/packages", `${version}${revision}.draft.json`);
}

/**
 * Read `--curriculum-version-number <n>` and refuse everything that is not a
 * plain positive integer.
 *
 * The parse is deliberately stricter than `Number()`: `4.0`, `+4`, `0x4`, `4e0`
 * and ` 4 ` all denote 4 to JavaScript and none of them is a version number a
 * human typed on purpose. A silently coerced value here becomes a curriculum
 * identity in a published database, so the only accepted spelling is digits.
 * The upper bound is the package schema's own (`max(10_000)`), asserted here so
 * the build fails at its argument rather than after producing an artifact that
 * validation would reject.
 */
function parseDigits(argv: readonly string[], flag: string, fallback: number, max: number): number {
  const index = argv.indexOf(flag);
  if (index < 0) return fallback;
  const raw = argv[index + 1];
  if (raw === undefined || raw.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${flag} must be a positive integer written in digits, got ${JSON.stringify(raw)}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be >= 1, got ${JSON.stringify(raw)}`);
  }
  if (parsed > max) {
    throw new Error(`${flag} must be <= ${max}, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function parseCurriculumVersionNumber(argv: readonly string[]): number {
  return parseDigits(argv, "--curriculum-version-number", DEFAULT_CURRICULUM_VERSION_NUMBER, 10_000);
}

/**
 * Read `--package-revision <n>`, held to the same digits-only rule.
 *
 * The upper bound is what this builder can actually COMPOSE, not what the schema
 * permits: asking for revision 3 must fail at the argument rather than silently
 * emit a revision-2 payload under a revision-3 label, which would make the
 * revision a lie and the fingerprint unverifiable against its own contract.
 */
function parsePackageRevision(argv: readonly string[]): number {
  return parseDigits(argv, "--package-revision", DEFAULT_PACKAGE_REVISION, MAX_PACKAGE_REVISION);
}

/** The approved first slice covers levels 1–4 and is carried over unchanged. */
const APPROVED_SLICE_LEVELS = 4;

type EditorialLevel = {
  levelNumber: number;
  briefTitle: string;
  slots: Partial<Record<"hook" | "tell" | "mainIdea" | "after" | "action" | "covers" | "unlocks", string>>;
};

type Json = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * Text helpers — mechanical, never editorial
 * ------------------------------------------------------------------ */

/** Sentence-case a brief fragment and give it a terminator. Nothing is added. */
function asSentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return trimmed;
  const capitalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?…»]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** Strip the guillemets a brief hook is quoted in; the callout supplies emphasis. */
function unquote(value: string): string {
  const trimmed = value.trim();
  const match = /^«([\s\S]*)»\.?$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

const STRUCTURE_PROVENANCE = {
  classification: "EXISTING_ACADEMY_SOURCE",
  sourcePath: "src/lib/curriculum/product-ata-100.ts",
  sourceRef: "ATA_LEVELS (transferred from academy@4c4ced39 fixture.ts + CURRICULUM_AND_UNLOCKS.md)",
  revision: "4c4ced39",
  confidence: "high",
  conflicts: [],
  approvalRequired: false,
  note: null,
} as const;

/**
 * Content built from the brief is NOT approved content, and its provenance says
 * so out loud: medium confidence, approval required. That single flag is what
 * keeps every generated level out of the production-ready count.
 */
const BRIEF_CONTENT_PROVENANCE = {
  classification: "EXISTING_ACADEMY_SOURCE",
  sourcePath: "curriculum/canonical/ata-100-editorial-source.json",
  sourceRef: "les-prog.txt editorial brief (academy@4c4ced39)",
  revision: "brief-1",
  confidence: "medium",
  conflicts: [],
  approvalRequired: true,
  note: "Editorial BRIEF material, not an authored lesson. Requires editorial production against docs/CONTENT_AUTHORING_TEMPLATE.md before approval.",
} as const;

const DERIVED_GATE_PROVENANCE = {
  classification: "EXISTING_BACKEND_SOURCE",
  sourcePath: "curriculum/packages/ata-v2-first-slice.rev3.approved.json",
  sourceRef: "modules[0].levels[3].gate.blockedExplanation (approved checkpoint wording)",
  revision: "rev3",
  confidence: "medium",
  conflicts: [],
  approvalRequired: true,
  note: "Checkpoint gate wording reused from the one approved checkpoint. Identical semantics for every checkpoint; the wording itself was approved for level 4 only.",
} as const;

/** Approved for level 4; every other checkpoint reuses it pending approval. */
const CHECKPOINT_BLOCKED_EXPLANATION =
  "Контрольная точка подтверждается по балансу счёта. Отметить её вручную в академии нельзя.";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/**
 * Load the normalized video-production contracts and refuse to build on a bad
 * one.
 *
 * The 58 contracts are now a BUILD INPUT of equal standing to the structural
 * source, so a malformed or drifted artifact must stop the build rather than
 * quietly produce a package with fewer questions than the product has. The ATA
 * video profile is applied here, at the only place that turns contracts into a
 * package.
 */
function loadVideoContracts(): VideoProductionContractsFile {
  const parsed = parseVideoProductionContracts(JSON.parse(readFileSync(VIDEO_CONTRACTS, "utf8")));
  if (!parsed.ok) {
    throw new Error(
      `${VIDEO_CONTRACTS} is not a valid contracts artifact:\n  ${parsed.issues.slice(0, 8).join("\n  ")}`,
    );
  }
  const issues = validateAtaVideoContracts(parsed.file);
  if (issues.length > 0) {
    throw new Error(
      `${VIDEO_CONTRACTS} fails the ATA video profile:\n  ` +
        issues.slice(0, 8).map((issue) => `[${issue.code}] ${issue.path} ${issue.message}`).join("\n  "),
    );
  }
  return parsed.file;
}

/* ------------------------------------------------------------------ *
 * Body construction
 * ------------------------------------------------------------------ */

/**
 * Build a v2 body from whatever the brief actually contains.
 *
 * Every section is conditional. A level whose brief carries only a hook gets a
 * one-section body; that is the truth about how much editorial material exists,
 * and the profile validator reports it as a gap rather than the builder papering
 * over it.
 */
function buildDraftBody(
  level: AtaLevelSource,
  editorial: EditorialLevel,
  contract: VideoProductionContract | null,
): ContentBodyV2 | null {
  const sections: ContentBodyV2["sections"] = [];
  const { hook, tell, mainIdea, after, action, covers } = editorial.slots;

  /*
   * CORRECTIONS §22 — STABLE SECTION IDENTITY.
   *
   * Section codes are durable learner state (`UserLessonProgress.
   * completedSections`). The previous revision derived them from whichever brief
   * slot happened to be populated, so a real script replacing a draft body would
   * have renamed the anchors under any learner who had already read it. Every
   * code below now comes from the CLOSED vocabulary in
   * `video-production-contract.ts`, which is the recording structure the final
   * script will follow — so a draft anchor survives authoring instead of being
   * replaced by it. No package has been imported yet, so this costs nothing now
   * and would have cost a migration later.
   */
  const push = (code: VideoLessonSectionCode, blocks: ContentBodyV2["sections"][number]["blocks"]) => {
    sections.push({ code, title: VIDEO_LESSON_SECTION_TITLES[code], blocks });
  };

  // Prefer the production contract's own hook: for a video lesson it IS the
  // opening line, and it is the version editorial production works from.
  const openingHook = contract?.hook ?? (hook ? unquote(hook) : null);
  if (openingHook) {
    push("hook", [{ type: "callout", variant: "key_idea", title: "", body: asSentence(openingHook) }]);
  }

  const coverage = contract?.requiredTopicsText ?? tell ?? covers;
  if (coverage) {
    push("opredelenie", [
      { type: "rich_text", text: asSentence(`Урок разбирает: ${coverage.replace(/\.$/, "")}`) },
    ]);
  }

  /*
   * THE TAKES ARE DELIBERATELY NOT PROJECTED HERE.
   *
   * They belong in the production contract, and an earlier revision of this
   * function listed them in the body as an ordered list. The regression suite
   * caught what that actually produced: in this Blueprint the correct option of
   * question N restates take N almost verbatim, so a mechanically generated body
   * containing the four takes in order is a 1:1 answer crib for its own test,
   * published through the learner content route.
   *
   * That is not an argument against a FINAL lesson teaching this material — the
   * Blueprint requires the video to say all four takes aloud, and an authored
   * lesson will teach them properly. It is an argument against a CONVERTER
   * emitting the answer key as a substitute for teaching prose. The `teyki`
   * section code stays in the stable vocabulary for the author who writes that
   * section; the converter simply has nothing honest to put in it.
   */

  const closing = contract?.mainIdea ?? mainIdea ?? null;
  if (closing) {
    push("itog", [{ type: "callout", variant: "key_idea", title: "", body: asSentence(closing) }]);
  }

  // Practical/report levels keep their exercise, now under a stable code.
  const task = level.artifact ?? after ?? action ?? null;
  if (!contract && task) {
    push("stsenarii", [
      {
        type: "exercise",
        code: `l${pad3(level.levelNumber)}-zadanie`,
        title: "Задание уровня",
        instructions: asSentence(level.artifact ?? task),
        expectedAction: asSentence(after ?? action ?? level.artifact ?? task),
        estimatedMinutes: null,
      },
    ]);
  }

  return sections.length > 0 ? { format: "ata.lesson.blocks", version: 2, sections } : null;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

type PendingApproval = {
  levelCode: string;
  element: string;
  classification: "MISSING" | "PROPOSED" | "CONFLICTING";
  detail: string;
  blocksReadiness: boolean;
};

/* ------------------------------------------------------------------ *
 * Video+test assessment banks — CORRECTIONS §9 / §11
 * ------------------------------------------------------------------ */

/**
 * Turn one video production contract into a PROPOSED assessment record.
 *
 * WHAT IS AND IS NOT CARRIED. Prompts, options and correct answers are copied
 * verbatim from the normalized Blueprint artifact. `explanation` is `null`,
 * because the Blueprint does not write per-question explanations and inventing
 * one would be authoring content in a converter. `lessonTakeawayRef` is the
 * contract's own take id, which is what finally gives `T{level}.N` a referent.
 *
 * WHY `status: "draft"` AND `approvalRequired: true`. The bank exists — that is
 * what `PROPOSED` records — but existing is not being approved. Publishing it
 * here would let a converter grant platform truth to 228 questions no human has
 * signed, which is the exact failure the correction brief forbids.
 */
function buildProposedAssessment(source: AtaLevelSource, contract: VideoProductionContract): Json {
  const provenance = {
    classification: "EXISTING_ACADEMY_SOURCE",
    sourcePath: "curriculum/canonical/ata-video-production-contracts.v1.json",
    sourceRef: `ATA_VIDEO_LESSONS_PRODUCTION_BLUEPRINT_V1.docx · ${contract.sourceStatusLabel}`,
    revision: `contract-v${contract.contractVersion}`,
    confidence: contract.sourceProvenance === "SOURCE_BACKED" ? "high" : "medium",
    conflicts: [],
    approvalRequired: true,
    note:
      contract.sourceProvenance === "SOURCE_BACKED"
        ? "Вопросы воспроизведены из авторского источника Academy (lesson-fixtures.ts L18) без изменений. Источник подтверждён; утверждение платформенного банка — отдельное решение."
        : "PROPOSED CANON из production-блюпринта: банк существует и готов к рассмотрению, но ещё не утверждён как платформенная истина.",
  };

  return {
    assessmentCode: `ata-v2.l${pad3(source.levelNumber)}.assessment`,
    versionNumber: 1,
    status: "draft",
    // Carried from the ONE approved precedent (level 2), not invented here, and
    // flagged as its own pending approval so the reuse is visible.
    passPercent: 100,
    maxAttempts: null,
    showExplanation: true,
    questions: contract.questions.map((question) => ({
      questionCode: `ata-v2.l${pad3(source.levelNumber)}.q${question.ordinal}`,
      questionNumber: question.ordinal,
      type: "single_choice",
      skillTag: null,
      optionCodes: question.options.map((option) => option.optionCode),
      correctOptionCodes: [question.correctOptionCode],
      correctNumericValue: null,
      localizations: [
        {
          locale: LOCALE,
          prompt: question.prompt,
          optionLabels: question.options.map((option) => option.text),
          // The Blueprint writes no explanations. A converter that invented one
          // would be authoring lesson copy.
          explanation: null,
        },
      ],
      lessonTakeawayRef: question.takeId,
      provenance,
    })),
    provenance,
  };
}

function buildPackage(curriculumVersionNumber: number, packageRevision: number): Json {
  const editorialDocument = JSON.parse(readFileSync(EDITORIAL_SOURCE, "utf8")) as {
    levels: EditorialLevel[];
  };
  const editorialByLevel = new Map(editorialDocument.levels.map((entry) => [entry.levelNumber, entry]));

  const approvedSlice = JSON.parse(readFileSync(APPROVED_SLICE, "utf8")) as {
    modules: Array<{ levels: Json[] }>;
  };
  const approvedByCode = new Map(
    approvedSlice.modules.flatMap((moduleDefinition) => moduleDefinition.levels).map((level) => [level.levelCode as string, level]),
  );

  const contractsFile = loadVideoContracts();
  const contractsByLevel = new Map(
    contractsFile.contracts.map((contract) => [contract.levelNumber, contract]),
  );

  const pendingApprovals: PendingApproval[] = [];

  /*
   * CORRECTIONS §6 / §24 — the L2 reconciliation, surfaced in the package.
   *
   * Level 2 carries an assessment Backend APPROVED, and the Blueprint proposes a
   * different bank for the same four takes. Neither is rewritten and neither
   * silently wins: the package keeps the approved bank as platform truth, and
   * the disagreement is recorded here so whoever approves the Blueprint sees it.
   *
   * `blocksReadiness: false` is deliberate. The approved content is usable
   * today; what is outstanding is an editorial DECISION about a proposal, not
   * missing work, and marking approved content unready would be as dishonest in
   * the other direction.
   */
  for (const conflictLevel of new Set(contractsFile.sourceConflicts.map((c) => c.levelNumber))) {
    const source = ATA_LEVELS.find((level) => level.levelNumber === conflictLevel);
    if (!source) continue;
    const fields = contractsFile.sourceConflicts.filter((c) => c.levelNumber === conflictLevel).length;
    pendingApprovals.push({
      levelCode: canonicalLevelCode(source),
      element: "assessment",
      classification: "CONFLICTING",
      detail:
        `Уровень ${conflictLevel}: утверждённый банк вопросов и предложение из production-блюпринта расходятся ` +
        `в ${fields} семантических полях. Оба покрывают одни и те же тейки. Действующей истиной остаётся ` +
        `утверждённый банк; выбор между ними — отдельное редакционное решение. Расхождения перечислены в ` +
        `curriculum/canonical/ata-video-production-contracts.v1.json → sourceConflicts.`,
      blocksReadiness: false,
    });
  }

  // Revision 2 and later carry the progression-owner configuration; revision 1
  // is composed exactly as it always was, so it stays byte-reproducible.
  const rubricSource = packageRevision >= PROGRESSION_OWNER_REVISION ? loadReportRubricSource() : null;

  const modules = ATA_MODULES.map((moduleSource) => {
    const levels = ATA_LEVELS.filter((level) => level.moduleNumber === moduleSource.moduleNumber).map(
      (level) => {
        const built = buildLevel(level, editorialByLevel, approvedByCode, contractsByLevel, pendingApprovals);
        if (rubricSource) applyProgressionOwners(built, level, rubricSource);
        return built;
      },
    );
    const checkpoint = ATA_LEVELS.find(
      (level) => level.kind === "checkpoint" && level.levelNumber === moduleSource.endLevel,
    );
    return {
      moduleCode: canonicalModuleCode(moduleSource.moduleNumber),
      moduleNumber: moduleSource.moduleNumber,
      title: moduleSource.title,
      description: moduleSource.description,
      // The module objective is its canonical description restated as an
      // objective — a mechanical transform of existing source text, not new copy.
      learningObjective: asSentence(moduleSource.description),
      checkpointLevelCode: checkpoint ? canonicalLevelCode(checkpoint) : null,
      levels,
    };
  });

  const pkg: Json = {
    schemaVersion: "ata.curriculum.package/1",
    minImporterVersion: 1,
    packageCode: PACKAGE_CODE,
    packageRevision,
    status: "draft",
    curriculumCode: "ata-v2",
    curriculumVersionNumber,
    curriculumTitle: "Alfa Trade Academy — программа 1–100",
    curriculumDescription:
      "Канонические 100 уровней и 20 модулей Alfa Trade Academy: структура, прогрессия, контрольные точки и разблокировки.",
    locale: LOCALE,
    createdFrom:
      "scripts/curriculum/buildCanonical100.ts — структура из src/lib/curriculum/product-ata-100.ts, черновой материал из curriculum/canonical/ata-100-editorial-source.json, уровни 1–4 перенесены без изменений из ata-v2-first-slice.rev3.approved.json, награды XP из утверждённой продуктовой политики src/lib/curriculum/product-xp-policy.ts",
    approval: { approvedBy: null, approvedAt: null, note: null },
    pendingApprovals: pendingApprovals.sort((a, b) =>
      a.levelCode < b.levelCode ? -1 : a.levelCode > b.levelCode ? 1 : a.element < b.element ? -1 : 1,
    ),
    contentFingerprint: "0".repeat(64),
    modules,
  };

  pkg.contentFingerprint = calculateFingerprint(pkg as never);
  return pkg;
}

function buildLevel(
  source: AtaLevelSource,
  editorialByLevel: Map<number, EditorialLevel>,
  approvedByCode: Map<string, Json>,
  contractsByLevel: Map<number, VideoProductionContract>,
  pendingApprovals: PendingApproval[],
): Json {
  const levelCode = canonicalLevelCode(source);

  // Levels 1–4 are already approved. Carrying them over verbatim keeps approved
  // editorial work approved instead of regenerating it at draft quality, and
  // makes the completeness numbers honest rather than flattering.
  //
  // PHASE-F — the ONE thing that is not carried over verbatim is the reward.
  //
  // The approved first slice predates the XP decision: it declares `xpReward: 0`
  // on every level, including its `lesson:assessment_pass` and
  // `report:report_approval` levels, and carries no `xpRewardStatus` at all.
  // Those zeros were placeholders, and shipping them inside the ATA-100 product
  // package would mean levels 2 and 3 silently paid nothing while their 57 and 0
  // structural twins paid 100 and 500.
  //
  // So the product XP policy is applied here as an OVERLAY. The historical
  // package file on disk is not touched — it remains byte-identical, and the
  // first-slice fingerprint regressions keep passing — while the NEW canonical
  // 100 draft co-produces the approved schedule for the same four levels. XP is
  // runtime product policy, not editorial content, so overlaying it changes
  // nothing about whose editorial work this is.
  if (source.levelNumber <= APPROVED_SLICE_LEVELS) {
    const approved = approvedByCode.get(levelCode);
    if (!approved) {
      throw new Error(`approved slice is missing ${levelCode}; canonical structure and approved package disagree`);
    }
    return {
      ...(approved as Record<string, unknown>),
      xpReward: ataXpRewardForLevel(source),
      xpRewardStatus: ataXpRewardStatusForLevel(source),
    } as Json;
  }

  const editorial = editorialByLevel.get(source.levelNumber);
  if (!editorial) throw new Error(`editorial source is missing level ${source.levelNumber}`);

  const completion = completionContractFor(source);
  const integrationCode = gateIntegrationCode(source);
  const videoContract = contractsByLevel.get(source.levelNumber) ?? null;

  const level: Json = {
    levelCode,
    levelNumber: source.levelNumber,
    type: completion.type,
    title: source.title,
    shortDescription: source.artifact ?? "",
    learningObjective: videoContract?.learningObjective ?? buildLearningObjective(source, editorial),
    completionMethod: completion.completionMethod,
    /*
     * PHASE-F §14 — the schedule is DECIDED, and the package now carries it.
     *
     * Phase C emitted `0` here with `xpRewardStatus: "unresolved"` for every
     * non-gate level, because no accepted source defined an ATA XP schedule and
     * a converter must not invent one. The approved product decision now exists
     * (`src/lib/curriculum/product-xp-policy.ts`), so the reward comes from the
     * policy — keyed on the canonical completion pair, never on the level
     * number, the module, the rank or the unlock level — and the status is what
     * the policy says it is. A gate's zero was already an approved decision and
     * still is; it now reaches the package through the same one source as every
     * other reward instead of through a local `isGate` branch.
     */
    xpReward: ataXpRewardForLevel(source),
    requiredXp: 0,
    xpRewardStatus: ataXpRewardStatusForLevel(source),
    prerequisiteLevelCodes: [canonicalLevelCode(ATA_LEVELS[source.levelNumber - 2] as AtaLevelSource)],
    checkpointLevelCode: null,
    estimatedDurationSeconds: null,
    content: null,
    assessment: null,
    report: null,
    gate: null,
    provenance: STRUCTURE_PROVENANCE,
  };

  if (integrationCode !== null) {
    level.gate = {
      completionSource: "financial_checkpoint",
      integrationCode,
      selfCompletable: false,
      blockedExplanation: [{ locale: LOCALE, text: CHECKPOINT_BLOCKED_EXPLANATION }],
      provenance: DERIVED_GATE_PROVENANCE,
    };
    pendingApprovals.push({
      levelCode,
      element: "gate_copy",
      classification: "MISSING",
      detail: `Формулировка блокировки контрольной точки уровня ${source.levelNumber} перенесена с утверждённого уровня 4 и требует отдельного утверждения.`,
      blocksReadiness: true,
    });
    return level;
  }

  const body = buildDraftBody(source, editorial, videoContract);
  if (body) {
    level.content = {
      contentCode: `ata-v2.l${pad3(source.levelNumber)}.content`,
      versionNumber: 1,
      status: "draft",
      videoDurationSeconds: null,
      localizations: [
        {
          locale: LOCALE,
          title: source.title,
          subtitle: "",
          learningObjectiveExtension: "",
          summary: "",
          transcript: null,
          body,
        },
      ],
      assets: [],
      provenance: BRIEF_CONTENT_PROVENANCE,
    };
    pendingApprovals.push({
      levelCode,
      element: "lesson_content",
      classification: "MISSING",
      detail: `Уровень ${source.levelNumber}: есть только редакционный бриф. Требуются авторский урок, дисклеймер о рисках и материалы по шаблону производства контента.`,
      blocksReadiness: true,
    });
  }

  if (source.kind === "video_test") {
    if (!videoContract) {
      // Only reachable if the contracts artifact and the structural source
      // disagree, which the ATA video profile refuses outright.
      pendingApprovals.push({
        levelCode,
        element: "assessment",
        classification: "MISSING",
        detail: `Уровень ${source.levelNumber} завершается через assessment_pass, но контракта видео+тест нет.`,
        blocksReadiness: true,
      });
    } else {
      level.assessment = buildProposedAssessment(source, videoContract);
      // PROPOSED, not MISSING. The bank exists, in full, with correct answers and
      // take coverage; what is outstanding is REVIEW, not authoring. Recording it
      // as MISSING is what the independent audit blocked the previous candidate
      // for, because it asserts 228 questions do not exist.
      pendingApprovals.push({
        levelCode,
        element: "assessment",
        classification: "PROPOSED",
        detail:
          (videoContract.sourceProvenance === "SOURCE_BACKED"
            ? `Уровень ${source.levelNumber}: банк воспроизведён из авторского источника Academy без изменений (${videoContract.questions.length} вопроса, тейки ${videoContract.takes.map((t) => t.takeId).join(", ")}). Источник подтверждён; платформенное утверждение — отдельное решение.`
            : `Уровень ${source.levelNumber}: предложенный банк из production-блюпринта (${videoContract.questions.length} вопроса, тейки ${videoContract.takes.map((t) => t.takeId).join(", ")}). Готов к рассмотрению, не утверждён.`) +
          " passPercent перенесён с единственного утверждённого прецедента (уровень 2) и утверждается вместе с банком.",
        blocksReadiness: true,
      });
    }
  }

  if (source.kind === "report") {
    pendingApprovals.push({
      levelCode,
      element: "report_prompt",
      classification: "MISSING",
      detail: `Уровень ${source.levelNumber} требует утверждённого задания отчёта.`,
      blocksReadiness: true,
    });
  }

  return level;
}

/* ------------------------------------------------------------------ *
 * Progression owners (package revision 2)
 * ------------------------------------------------------------------ */

/**
 * Overlay the completion-owner configuration onto an assembled level.
 *
 * ============================ WHY AN OVERLAY ============================
 * The same reason XP is one. Levels 1–4 are carried over VERBATIM from the
 * approved first slice, which predates both owners — its level 3 declares a
 * report with no rubric and its level 4 a gate with no threshold, because in
 * revision 1 the package could not express either. Rewriting the approved slice
 * on disk to add them would revise approved editorial work to make new code
 * tidier; overlaying leaves that file byte-identical, its own fingerprint
 * regressions passing, and applies the same rule to a carried-over level 4 and a
 * generated level 100.
 *
 * Both owners come from ONE canonical source each and are copied, not composed:
 * the rubric from the accepted predecessor rubric transcribed into
 * `curriculum/canonical/ata-v2-l003-report-rubric.v1.json`, the thresholds from
 * `product-ata-100.ts::checkpointRequirementFor`. Neither is derived from a
 * level number, a module number or a title.
 */
function applyProgressionOwners(level: Json, source: AtaLevelSource, rubric: Json): void {
  const gate = level.gate as Json | null;
  if (gate && gate.completionSource === "financial_checkpoint") {
    const requirement = checkpointRequirementFor(source);
    if (!requirement) {
      throw new Error(`level ${source.levelNumber} carries a checkpoint gate with no approved threshold`);
    }
    level.gate = {
      ...gate,
      requirement: {
        thresholdCurrency: requirement.thresholdCurrency,
        thresholdMinorUnits: requirement.thresholdMinorUnits,
        provenance: CHECKPOINT_REQUIREMENT_PROVENANCE,
      },
    };
  }

  const report = level.report as Json | null;
  if (report) {
    if (report.reportCode !== (rubric as Json).reportCodeExpected) {
      // Defensive: the rubric source names the assignment it was approved for.
      // A rubric silently attached to a different report is precisely the
      // "closest match" behaviour the canonical contract forbids.
      throw new Error(
        `rubric source is approved for ${String((rubric as Json).reportCodeExpected)}, not ${String(report.reportCode)}`,
      );
    }
    level.report = { ...report, rubric: (rubric as Json).rubric };
  }
}

/**
 * Read and validate the canonical rubric source once per build.
 *
 * Parsed with the PACKAGE's own rubric schema rather than a second definition of
 * the same shape, so the source file and the artifact it lands in can never
 * drift apart.
 */
function loadReportRubricSource(): Json {
  const raw = JSON.parse(readFileSync(REPORT_RUBRIC_SOURCE, "utf8")) as Json;
  const parsed = reportRubricSchema.safeParse(raw.rubric);
  if (!parsed.success) {
    throw new Error(`canonical report rubric source is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  if (raw.levelStableCode !== REPORT_RUBRIC_LEVEL_CODE) {
    throw new Error(`canonical report rubric source targets ${String(raw.levelStableCode)}, expected ${REPORT_RUBRIC_LEVEL_CODE}`);
  }
  return {
    reportCodeExpected: REPORT_RUBRIC_REPORT_CODE,
    // Re-emitted through the parsed value so an unknown key in the source file
    // cannot reach the artifact.
    rubric: parsed.data as unknown as Json,
  };
}

/** The one level whose report the accepted rubric was approved for. */
const REPORT_RUBRIC_LEVEL_CODE = "v2.l003.pervye-pyat-demo-sdelok";
const REPORT_RUBRIC_REPORT_CODE = "ata-v2.l003.report";

/**
 * The thresholds are Academy's own, and the provenance says exactly that. They
 * are not an operator decision taken here: the same 20 values appear in the
 * Academy fixture, in `les-prog.txt` and in the canonical level titles of every
 * shipped artifact. What revision 2 adds is the ability to store them in the
 * units the runtime compares.
 */
const CHECKPOINT_REQUIREMENT_PROVENANCE = {
  classification: "EXISTING_ACADEMY_SOURCE",
  sourcePath: "src/lib/curriculum/product-ata-100.ts",
  sourceRef: "CHECKPOINT_ROWS thresholdUsd/thresholdMinorUnits (academy@4c4ced39 fixture.ts + les-prog.txt)",
  revision: "4c4ced39",
  confidence: "high",
  conflicts: [],
  approvalRequired: false,
  note: "Threshold transferred by value from the canonical level title and the Academy source; expressed in integer minor units because LevelCheckpointRequirement stores no dollars.",
} as const;

/**
 * The learning objective, derived from the brief in a fixed priority order.
 *
 * Every branch restates material that already exists in the canonical source; no
 * branch invents a pedagogical claim. Checkpoints reuse the objective approved
 * for level 4, because a checkpoint's objective is the same fact every time.
 */
function buildLearningObjective(source: AtaLevelSource, editorial: EditorialLevel): string {
  if (source.kind === "checkpoint") return "Подтвердить баланс контрольной точки модуля.";
  const { mainIdea, tell, covers, after, action, hook } = editorial.slots;
  const chosen = mainIdea ?? tell ?? covers ?? after ?? action ?? source.artifact ?? unquote(hook ?? source.title);
  return asSentence(chosen);
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function serialize(pkg: Json): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const curriculumVersionNumber = parseCurriculumVersionNumber(argv);
  const packageRevision = parsePackageRevision(argv);
  const output = outputPathFor(curriculumVersionNumber, packageRevision);
  const pkg = buildPackage(curriculumVersionNumber, packageRevision);
  const serialized = serialize(pkg);

  // A generated production artifact must never carry a retired brand. Checked on
  // the OUTPUT rather than trusting the input scrub, so a regression in the
  // transfer fails the build instead of shipping.
  const brand = findObsoleteBrand(serialized);
  if (brand) {
    throw new Error(`generated package contains obsolete product brand ${brand}`);
  }

  const validation = validateCurriculumPackage(pkg);
  if (!validation.ok) {
    console.error("generic validation failed:");
    for (const item of validation.issues.slice(0, 40)) {
      console.error(`  ${item.code} ${item.path}: ${item.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const profile = validateAtaProduct100Package(validation.package);
  if (profile.issues.length > 0) {
    console.error("ATA-100 profile issues:");
    for (const item of profile.issues.slice(0, 40)) {
      console.error(`  ${item.code} ${item.path}: ${item.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (args.has("--check")) {
    const existing = readFileSync(output, "utf8");
    if (existing !== serialized) {
      console.error(`DRIFT: ${output} does not match its inputs`);
      console.error(`  checked-in sha256 ${sha256(existing)}`);
      console.error(`  rebuilt    sha256 ${sha256(serialized)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`ok ${output} matches its inputs`);
  } else {
    writeFileSync(output, serialized);
    console.log(`written ${output}`);
  }

  console.log(
    JSON.stringify(
      {
        curriculumCode: pkg.curriculumCode,
        curriculumVersionNumber,
        packageRevision,
        path: path.relative(REPO_ROOT, output),
        fingerprint: validation.fingerprint,
        // Audit-only, and never a substitute for `fingerprint`: the semantic
        // payload with the intentional successor identity removed, so a reviewer
        // can prove two versions carry the SAME educational product.
        semanticEquivalenceDigest: calculateSemanticEquivalenceDigest(validation.package),
        // Audit-only, and narrower still: version identity, package revision and
        // the runtime owner configuration removed, so a revision that adds a
        // rubric or a threshold can still PROVE it taught nothing new.
        educationalPayloadDigest: calculateEducationalPayloadDigest(validation.package),
        sha256: sha256(serialized),
        bytes: Buffer.byteLength(serialized, "utf8"),
        status: pkg.status,
        pendingApprovals: (pkg.pendingApprovals as unknown[]).length,
        warnings: validation.warnings.length,
        profile: profile.report,
        editorialGaps: profile.gaps.length,
      },
      null,
      2,
    ),
  );
}

main();
