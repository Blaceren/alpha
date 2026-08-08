/**
 * PHASE-C — the canonical ATA-100 package builder.
 *
 * ============================== WHAT IT DOES ==============================
 * Assembles `curriculum/packages/ata-v2-canonical-100.draft.json` from three
 * Backend-owned inputs and nothing else:
 *
 *   1. `src/lib/curriculum/product-ata-100.ts`
 *        structure — 100 levels, 20 modules, titles, kinds, checkpoints.
 *   2. `curriculum/canonical/ata-100-editorial-source.json`
 *        the transferred editorial BRIEF (hooks, what to cover, main ideas).
 *   3. `curriculum/packages/ata-v2-first-slice.rev3.approved.json`
 *        the approved first slice, so L1–L4 keep their APPROVED content
 *        verbatim instead of being regenerated at draft quality.
 *
 * It reads NO other repository, opens no database, makes no network call and
 * uses no clock or randomness. Same inputs → byte-identical output → identical
 * fingerprint. `--check` proves the checked-in artifact still matches its
 * inputs, which is how editorial drift is caught in CI rather than at import.
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
  pad3,
  type AtaLevelSource,
} from "@/lib/curriculum/product-ata-100";
import { findObsoleteBrand } from "@/lib/curriculum/product-vocabulary";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
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
const OUTPUT = path.join(REPO_ROOT, "curriculum/packages/ata-v2-canonical-100.draft.json");

const PACKAGE_CODE = ATA_100_PACKAGE_CODE;
const PACKAGE_REVISION = 1;
const CURRICULUM_VERSION_NUMBER = 3;
const LOCALE = "ru";

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

function buildPackage(): Json {
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

  const modules = ATA_MODULES.map((moduleSource) => {
    const levels = ATA_LEVELS.filter((level) => level.moduleNumber === moduleSource.moduleNumber).map(
      (level) => buildLevel(level, editorialByLevel, approvedByCode, contractsByLevel, pendingApprovals),
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
    packageRevision: PACKAGE_REVISION,
    status: "draft",
    curriculumCode: "ata-v2",
    curriculumVersionNumber: CURRICULUM_VERSION_NUMBER,
    curriculumTitle: "Alfa Trade Academy — программа 1–100",
    curriculumDescription:
      "Канонические 100 уровней и 20 модулей Alfa Trade Academy: структура, прогрессия, контрольные точки и разблокировки.",
    locale: LOCALE,
    createdFrom:
      "scripts/curriculum/buildCanonical100.ts — структура из src/lib/curriculum/product-ata-100.ts, черновой материал из curriculum/canonical/ata-100-editorial-source.json, уровни 1–4 перенесены без изменений из ata-v2-first-slice.rev3.approved.json",
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
  if (source.levelNumber <= APPROVED_SLICE_LEVELS) {
    const approved = approvedByCode.get(levelCode);
    if (!approved) {
      throw new Error(`approved slice is missing ${levelCode}; canonical structure and approved package disagree`);
    }
    return approved;
  }

  const editorial = editorialByLevel.get(source.levelNumber);
  if (!editorial) throw new Error(`editorial source is missing level ${source.levelNumber}`);

  const completion = completionContractFor(source);
  const integrationCode = gateIntegrationCode(source);
  const videoContract = contractsByLevel.get(source.levelNumber) ?? null;
  const isGate = source.kind === "registration" || source.kind === "checkpoint";

  const level: Json = {
    levelCode,
    levelNumber: source.levelNumber,
    type: completion.type,
    title: source.title,
    shortDescription: source.artifact ?? "",
    learningObjective: videoContract?.learningObjective ?? buildLearningObjective(source, editorial),
    completionMethod: completion.completionMethod,
    xpReward: 0,
    requiredXp: 0,
    /*
     * CORRECTIONS §14 — zero means two different things, so it says which.
     *
     * A gate awards no XP BY DESIGN and the generic validator enforces it, so
     * that zero is an APPROVED product decision. Every other level's zero is a
     * compatibility placeholder for a schedule no accepted source has ever
     * defined — the audit checked Academy's fixture, `CURRICULUM_AND_UNLOCKS.md`
     * and `les-prog.txt` and found none. This phase does not invent one; it
     * refuses to let the placeholder pass as a decision.
     */
    xpRewardStatus: isGate ? "approved" : "unresolved",
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
  const args = new Set(process.argv.slice(2));
  const pkg = buildPackage();
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
    const existing = readFileSync(OUTPUT, "utf8");
    if (existing !== serialized) {
      console.error(`DRIFT: ${OUTPUT} does not match its inputs`);
      console.error(`  checked-in sha256 ${sha256(existing)}`);
      console.error(`  rebuilt    sha256 ${sha256(serialized)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`ok ${OUTPUT} matches its inputs`);
  } else {
    writeFileSync(OUTPUT, serialized);
    console.log(`written ${OUTPUT}`);
  }

  console.log(
    JSON.stringify(
      {
        fingerprint: validation.fingerprint,
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
