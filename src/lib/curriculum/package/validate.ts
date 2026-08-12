/**
 * Deterministic package validation.
 *
 * Runs entirely in memory, before any transaction begins. Every issue carries a
 * package field PATH (never a database id, never learner data), so a rejected
 * package can be fixed by editing the JSON.
 *
 * Layer order matters: schema -> stable codes -> graph -> content/assessment/
 * report semantics -> provenance/readiness -> fingerprint. Stable codes are
 * checked before anything touches the database, which is the invariant that
 * makes `/current` and `/content` agree (CV-1 §2.24).
 */
import {
  curriculumPackageSchema,
  PRODUCTION_PROVENANCE,
  type CurriculumPackage,
  type PackageLevel,
  type ProvenanceRecord,
} from "@/lib/curriculum/package/schema";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import {
  isOwnedCompletionPair,
  isZeroRewardCompletionPair,
} from "@/lib/curriculum/completion-pairs";
import {
  describeStableCodeIssue,
  isCanonicalCurriculumCode,
  isCanonicalModuleCode,
  parseLevelCode,
} from "@/lib/curriculum/stable-code";
import {
  validateRequiredWhen,
  type RequiredWhenFieldRef,
} from "@/lib/curriculum/report-required-when";
import {
  contentBodyAssetReferences,
  contentBodyHasRiskDisclaimer,
  contentBodySectionCodes,
  contentBodyTeachingCharacters,
  contentBodyToolReferences,
  isBlocksV2,
} from "@/lib/curriculum/content-body";
import { findObsoleteBrand, isProductToolCode } from "@/lib/curriculum/product-vocabulary";

export type PackageIssue = { code: string; path: string; message: string };

export type PackageValidationResult =
  | { ok: true; package: CurriculumPackage; fingerprint: string; warnings: PackageIssue[] }
  | { ok: false; issues: PackageIssue[] };

/**
 * PHASE-C §16 / CORRECTIONS §15 — markers that must never survive into an
 * APPROVED package.
 *
 * ===================== THE BUG THIS REPLACES =====================
 * The previous revision expressed every marker with `\b`. JavaScript's `\b` is
 * defined against `[A-Za-z0-9_]`, so a Cyrillic letter is NOT a word character
 * and no boundary can ever exist beside one:
 *
 *     /\bуточняется\b/.test("Значение уточняется")   // → false
 *
 * Every Russian marker was therefore unmatchable. Two of them (УТОЧНЯЕТСЯ,
 * ЗАГЛУШКА) had worked in the previous phase, where matching was a naive
 * upper-cased `includes`, so adding word boundaries to fix a «скоро» false
 * positive silently killed the true positives — and an approved package could
 * ship «Скоро будет доступно» to a learner. The suite did not catch it because
 * its only positive case used the Latin `TODO`.
 *
 * ===================== THE FIX =====================
 * `BOUNDARY_BEFORE`/`BOUNDARY_AFTER` are Unicode property escapes: a boundary is
 * the absence of an adjacent LETTER OR DIGIT IN ANY SCRIPT, which is what `\b`
 * always meant and only ever delivered for ASCII. The false-positive protection
 * Phase C intended is fully preserved — «рынок СКОРО вернётся», «ГОТОВНОСТЬ
 * плана», «ПОДГОТОВКА», «РАЗРАБОТКА стратегии» and `METODOLOGIYA` all still pass,
 * because the markers stay anchored to whole words and the multi-word Russian
 * markers stay anchored to their authoring idiom.
 *
 * Every marker is regression-tested in BOTH directions — see the placeholder
 * cases in `curriculumContentBlocksRegression.ts`.
 */
const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])";

/** A whole-word marker, boundary-safe in every script. */
function markerPattern(body: string, flags = "iu"): RegExp {
  return new RegExp(`${BOUNDARY_BEFORE}(?:${body})${BOUNDARY_AFTER}`, flags);
}

const PLACEHOLDER_MARKERS: ReadonlyArray<{ marker: string; pattern: RegExp }> = [
  { marker: "TODO", pattern: markerPattern("TODO") },
  { marker: "TBD", pattern: markerPattern("TBD") },
  { marker: "FIXME", pattern: markerPattern("FIXME") },
  { marker: "PLACEHOLDER", pattern: markerPattern("placeholders?") },
  { marker: "LOREM IPSUM", pattern: markerPattern("lorem\\s+ipsum") },
  { marker: "COMING SOON", pattern: markerPattern("coming\\s+soon") },
  { marker: "XXX", pattern: markerPattern("XXX+", "u") },
  { marker: "УТОЧНЯЕТСЯ", pattern: markerPattern("уточня(?:ется|ются)") },
  { marker: "ЗАГЛУШКА", pattern: markerPattern("заглушк[аиуеойы]") },
  { marker: "ГОТОВИТСЯ", pattern: markerPattern("готов(?:ится|ятся)") },
  // «скоро» alone is ordinary Russian and stays legal. Only the authoring
  // idioms — the ones that can only mean "content is not here yet" — are refused.
  { marker: "СКОРО", pattern: markerPattern("скоро\\s+(?:будет|будут|появится|появятся|здесь)|уже\\s+скоро") },
  { marker: "В РАЗРАБОТКЕ", pattern: markerPattern("в\\s+разработке") },
  // «черновик» ALONE is legitimate, operator-approved ATA product vocabulary: it
  // is the learner's own draft artifact (journal entry, report, strategy card),
  // and the approved first slice says so in its L2 lesson body, its glossary and
  // one of its answer options. Only the AUTHORING idioms — the ones that can
  // only mean "this lesson text is not finished" — are refused.
  {
    marker: "ЧЕРНОВИК",
    pattern: markerPattern(
      "черновик\\s+(?:урока|текста|сценария|материала)|(?:это|пока)\\s+черновик|чернов(?:ой\\s+текст|ая\\s+версия)",
    ),
  },
];

/**
 * PHASE-C — content compatibility, split into THREE questions that used to be
 * answered by one set.
 *
 * `CONTENT_BEARING_TYPES` conflated "may carry content", "may carry an
 * assessment" and "must carry content once approved". That conflation was
 * already wrong against the runtime: `content-read-progress.ts` serves content
 * for `lesson`, `report`, `mentor_review` and `final_exam`
 * (`READABLE_LEVEL_TYPES`), but the package validator refused to let a `report`
 * or `mentor_review` level carry any — so the two practical/report level kinds
 * that §17 requires to ship instructions could not express them at all.
 *
 * Splitting the questions fixes that without widening anything else:
 *
 *  - ALLOWED mirrors the runtime read path exactly. Nothing new becomes
 *    readable; the package format simply stops refusing what the runtime
 *    already serves.
 *  - ASSESSMENT is UNCHANGED. A report or mentor-review level still may not
 *    carry an assessment — completion for those belongs to report approval and
 *    mentor review, and a second grading path would be a second owner.
 *  - REQUIRED-FOR-APPROVED is UNCHANGED. Making content mandatory on approved
 *    `report` levels would retroactively invalidate the shipped approved
 *    package, whose L3 report level carries its prompt in the report definition
 *    and no separate content. The ATA-100 PROFILE is where the stronger
 *    per-kind content requirement lives (§17/§21).
 */
const CONTENT_ALLOWED_TYPES = new Set([
  "lesson",
  "scenario",
  "practice",
  "final_exam",
  "report",
  "mentor_review",
]);
const ASSESSMENT_ALLOWED_TYPES = new Set(["lesson", "scenario", "practice", "final_exam"]);
const CONTENT_REQUIRED_FOR_APPROVED_TYPES = new Set([
  "lesson",
  "scenario",
  "practice",
  "final_exam",
]);

/**
 * The minimum prose an APPROVED content-bearing level must actually teach.
 *
 * Deliberately low. This is not an editorial quality bar — it is the floor that
 * separates "a lesson" from "a heading, a divider and a CTA", which is the
 * schema-valid-but-learner-empty state §17 refuses. Editorial sufficiency is a
 * human review; structural emptiness is a machine check.
 */
const MIN_APPROVED_TEACHING_CHARACTERS = 400;

/** Level types that are gated outside the learner UI and never self-completable. */
const GATED_TYPES = new Set(["external_event", "financial_checkpoint"]);

/**
 * Completion methods that `completion.ts` OWNER_RULES maps to a learner-driven
 * completion owner. A gated level must never carry one of these, or the gate
 * could be satisfied from inside the product.
 */
const SELF_COMPLETABLE_METHODS = new Set([
  "lesson",
  "manual",
  "assessment_pass",
  "report_approval",
  "mentor_review",
]);

/**
 * Categories that describe only the money outcome. Kept identical to
 * `report-validation.ts::PROFIT_ONLY_CATEGORIES`, which is what
 * `publishReportRubric` enforces — a package that slipped one past this check
 * would import a rubric that can never be published.
 */
const PROFIT_ONLY_CRITERION_CATEGORIES: ReadonlySet<string> = new Set(["profit", "pnl", "roi", "return"]);

function issue(list: PackageIssue[], code: string, path: string, message: string): void {
  list.push({ code, path, message });
}

/**
 * The ONE placeholder matcher in this codebase.
 *
 * PHASE-G0 exported it — the body and the marker table are unchanged. The
 * authoring validator (`authoring-validation.ts`) needs exactly this check on a
 * draft that has never been near a package, and the alternative was a second
 * regex in the authoring path. That is precisely how the Unicode bug documented
 * at the top of this file happened: two matchers drift, one of them loses its
 * Russian markers, and «Скоро будет доступно» ships to a learner. There is one
 * matcher, and every caller uses it.
 */
export function containsPlaceholder(value: string): string | null {
  return PLACEHOLDER_MARKERS.find((entry) => entry.pattern.test(value))?.marker ?? null;
}

function looksLikeSecret(key: string): boolean {
  return /(password|secret|token|apikey|api_key|credential|privatekey)/i.test(key);
}

/** Walk every string in the package looking for placeholders and secret-ish keys. */
function scanStrings(
  value: unknown,
  path: string,
  onString: (text: string, path: string) => void,
  onKey: (key: string, path: string) => void,
): void {
  if (typeof value === "string") {
    onString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, `${path}[${index}]`, onString, onKey));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      onKey(key, `${path}.${key}`);
      scanStrings(child, `${path}.${key}`, onString, onKey);
    }
  }
}

function requiresApproval(record: ProvenanceRecord): boolean {
  return record.approvalRequired || !PRODUCTION_PROVENANCE.has(record.classification);
}

/**
 * A5 — the two prerequisite fields that have no owner, named explicitly.
 *
 * `LevelDefinition.requiredCheckpointLevel` and `LevelDefinition.visibilityRule`
 * both exist in the database and BOTH permanently lock a level:
 * `deriveEnrolledLevelStates` answers `checkpoint_engine_unavailable` for the
 * first and `visibility_rule_unsupported` for the second, and no owner clears
 * either blocker. A package that sets one therefore ships a level nobody can
 * ever reach, and the failure surfaces to a learner as a level that is simply
 * stuck — with no error anywhere to explain it.
 *
 * So they are refused at import time, by name, with stable codes. Not warned
 * about, not dropped silently, not "supported later": refused now, so the
 * package author is told at the point where it is still a JSON edit.
 *
 * WHY THIS RUNS BEFORE THE SCHEMA PARSE
 * `curriculumPackageSchema` is `strictObject`, so an unknown key is already a
 * hard error — but it is a GENERIC `SCHEMA_INVALID` ("Unrecognized key"), and
 * the schema returns early, so the author would never see which semantic they
 * asked for. Scanning the raw input first means a package that reaches for
 * either field gets the specific code, whether it spelled it the package way
 * (`checkpointLevelCode`) or the database way.
 *
 * MODULE-LEVEL `checkpointLevelCode` IS DELIBERATELY NOT TOUCHED. It maps to
 * `ModuleDefinition.checkpointLevel`, which is descriptive curriculum metadata
 * read by the module read model. It gates nothing and locks nothing.
 */
const UNSUPPORTED_PREREQUISITE_KEYS: Record<string, { code: string; reason: string }> = {
  requiredCheckpointLevel: {
    code: "LEVEL_CHECKPOINT_PREREQUISITE_UNSUPPORTED",
    reason:
      "checkpoint prerequisites have no completion owner and permanently lock the level",
  },
  visibilityRule: {
    code: "LEVEL_VISIBILITY_RULE_UNSUPPORTED",
    reason: "visibility rules have no evaluator and permanently lock the level",
  },
};

function scanUnsupportedPrerequisiteFields(
  value: unknown,
  path: string,
  issues: PackageIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanUnsupportedPrerequisiteFields(item, `${path}[${index}]`, issues));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const unsupported = UNSUPPORTED_PREREQUISITE_KEYS[key];
    // `null` is the shipped, supported value and must stay legal: refusing it
    // would refuse every package that spells the absence out.
    if (unsupported && child !== null && child !== undefined) {
      issue(issues, unsupported.code, `${path}.${key}`, unsupported.reason);
    }
    scanUnsupportedPrerequisiteFields(child, `${path}.${key}`, issues);
  }
}

export function validateCurriculumPackage(input: unknown): PackageValidationResult {
  const issues: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];

  /* -------- 0. unsupported prerequisite fields (A5), before parse ------- */
  scanUnsupportedPrerequisiteFields(input, "package", issues);

  /* ---------------------------- 1. schema ---------------------------- */
  const parsed = curriculumPackageSchema.safeParse(input);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      issue(issues, "SCHEMA_INVALID", problem.path.join(".") || "<root>", problem.message);
    }
    return { ok: false, issues };
  }
  const pkg = parsed.data;

  /* ------------------------- 2. stable codes ------------------------- */
  if (!isCanonicalCurriculumCode(pkg.curriculumCode)) {
    issue(issues, "CURRICULUM_CODE_INVALID", "curriculumCode", "curriculum code must be lowercase kebab");
  }

  const levelsByCode = new Map<string, { level: PackageLevel; path: string }>();
  const seenModuleCodes = new Set<string>();
  const seenModuleNumbers = new Set<number>();
  const seenLevelNumbers = new Set<number>();
  const seenContentCodes = new Set<string>();
  const seenAssessmentCodes = new Set<string>();
  const seenReportCodes = new Set<string>();
  const seenRubricCodes = new Set<string>();

  pkg.modules.forEach((moduleDefinition, moduleIndex) => {
    const modulePath = `modules[${moduleIndex}]`;
    if (!isCanonicalModuleCode(moduleDefinition.moduleCode)) {
      issue(issues, "MODULE_CODE_INVALID", `${modulePath}.moduleCode`, "module code must be lowercase kebab/dot");
    }
    if (seenModuleCodes.has(moduleDefinition.moduleCode)) {
      issue(issues, "MODULE_CODE_DUPLICATE", `${modulePath}.moduleCode`, "duplicate module code");
    }
    seenModuleCodes.add(moduleDefinition.moduleCode);
    if (seenModuleNumbers.has(moduleDefinition.moduleNumber)) {
      issue(issues, "MODULE_NUMBER_DUPLICATE", `${modulePath}.moduleNumber`, "duplicate module number");
    }
    seenModuleNumbers.add(moduleDefinition.moduleNumber);

    moduleDefinition.levels.forEach((level, levelIndex) => {
      const levelPath = `${modulePath}.levels[${levelIndex}]`;

      const parsedCode = parseLevelCode(level.levelCode, level.levelNumber);
      if (!parsedCode.ok) {
        issue(
          issues,
          parsedCode.issue === "LEVEL_NUMBER_MISMATCH" ? "LEVEL_CODE_NUMBER_MISMATCH" : "LEVEL_CODE_INVALID",
          `${levelPath}.levelCode`,
          describeStableCodeIssue(parsedCode.issue),
        );
      }
      if (levelsByCode.has(level.levelCode)) {
        issue(issues, "LEVEL_CODE_DUPLICATE", `${levelPath}.levelCode`, "duplicate level code");
      }
      levelsByCode.set(level.levelCode, { level, path: levelPath });

      if (seenLevelNumbers.has(level.levelNumber)) {
        issue(issues, "LEVEL_NUMBER_DUPLICATE", `${levelPath}.levelNumber`, "duplicate level number");
      }
      seenLevelNumbers.add(level.levelNumber);

      if (level.title === level.levelCode) {
        issue(issues, "LEVEL_TITLE_IS_CODE", `${levelPath}.title`, "title must not be the stable code");
      }

      /* ------------------- 3. per-level semantics ------------------- */

      // A5. `checkpointLevelCode` is the package spelling of
      // `LevelDefinition.requiredCheckpointLevel` — the importer writes one
      // from the other. Refused for the same reason the raw scan refuses the
      // database spelling: nothing on the platform clears the
      // `checkpoint_engine_unavailable` blocker it produces, so a level that
      // carries it is locked forever.
      if (level.checkpointLevelCode !== null) {
        issue(
          issues,
          "LEVEL_CHECKPOINT_PREREQUISITE_UNSUPPORTED",
          `${levelPath}.checkpointLevelCode`,
          "checkpoint prerequisites have no completion owner and permanently lock the level",
        );
      }

      // A2/R1. Every level must declare a pair some production owner can
      // actually complete. Checked against the SAME vocabulary the runtime
      // enforces (src/lib/curriculum/completion-pairs.ts), so a package can no
      // longer ship, say, a `practice:*` level that reaches
      // `COMPLETION_OWNER_UNAVAILABLE` for every learner who gets to it.
      //
      // A hard error for an `approved` package and a warning for a `draft`,
      // matching how the provenance gates already treat "structure known,
      // decision not yet made": a draft is allowed to be mid-authoring, a
      // package declared production-ready is not.
      if (!isOwnedCompletionPair(level.type, level.completionMethod)) {
        const unowned = {
          code: "LEVEL_COMPLETION_PAIR_UNOWNED",
          path: `${levelPath}.completionMethod`,
          message: `${level.type}:${level.completionMethod} has no completion owner`,
        };
        if (pkg.status === "approved") issues.push(unowned);
        else warnings.push(unowned);
      }

      // A level that completes through a ZERO-REWARD owner must declare no
      // reward. `completion.ts` refuses the combination outright
      // (`COMPLETION_REWARD_INVALID`), and nothing on the platform can clear
      // that refusal, so a package that ships one has produced a level the
      // learner reaches, satisfies, and can never leave — the same permanent
      // lock `requiredCheckpointLevel` and `visibilityRule` produce, and it is
      // refused here for the same reason.
      //
      // Driven by the shared vocabulary (`isZeroRewardCompletionPair`), not by
      // `GATED_TYPES`: the rule belongs to the OWNER, so it stays correct if a
      // zero-reward owner ever exists for a level type that is not gated, and
      // it cannot disagree with the engine.
      //
      // An ERROR for `draft` as well as `approved`, unlike
      // `LEVEL_COMPLETION_PAIR_UNOWNED` above. That is the existing policy for
      // this class, not a new one: every gate completion-contract violation in
      // this file (`GATE_SOURCE_MISMATCH`, `GATE_SELF_COMPLETABLE`,
      // `GATE_COMPLETION_METHOD_SELF_COMPLETABLE`) is unconditional. A draft is
      // allowed to be mid-authoring about WHICH owner a level has; it is not
      // allowed to declare a contract that owner can never honour.
      if (isZeroRewardCompletionPair(level.type, level.completionMethod) && level.xpReward !== 0) {
        issue(
          issues,
          "LEVEL_GATE_REWARD_UNSUPPORTED",
          `${levelPath}.xpReward`,
          `${level.type}:${level.completionMethod} completes through a zero-reward owner and must declare xpReward 0`,
        );
      }

      const isContentAllowed = CONTENT_ALLOWED_TYPES.has(level.type);
      const isAssessmentAllowed = ASSESSMENT_ALLOWED_TYPES.has(level.type);
      const isGated = GATED_TYPES.has(level.type);

      if (isGated) {
        if (!level.gate) {
          issue(issues, "GATE_MISSING", `${levelPath}.gate`, `${level.type} level requires a gate configuration`);
        } else {
          const expected = level.type === "external_event" ? "external_event" : "financial_checkpoint";
          if (level.gate.completionSource !== expected) {
            issue(issues, "GATE_SOURCE_MISMATCH", `${levelPath}.gate.completionSource`, `must be ${expected}`);
          }
          // selfCompletable is z.literal(false); this is the belt-and-braces check.
          if (level.gate.selfCompletable !== false) {
            issue(issues, "GATE_SELF_COMPLETABLE", `${levelPath}.gate.selfCompletable`, "gated level must not be self-completable");
          }
          if (!level.gate.blockedExplanation.some((b) => b.locale === pkg.locale)) {
            issue(issues, "GATE_EXPLANATION_MISSING", `${levelPath}.gate.blockedExplanation`, `missing package locale ${pkg.locale}`);
          }
          /*
           * PROGRESSION OWNER — a threshold belongs to a balance check and to
           * nothing else.
           *
           * `external_event` completion arrives from a provider postback; there
           * is no amount to compare, so a requirement on one would be a number
           * nothing reads. The schema cannot express this rule on its own — it
           * needs `completionSource` and `requirement` in the same scope, which
           * is here.
           */
          if (level.gate.requirement && level.gate.completionSource !== "financial_checkpoint") {
            issue(
              issues,
              "GATE_REQUIREMENT_NOT_ALLOWED",
              `${levelPath}.gate.requirement`,
              `${level.gate.completionSource} gate must not carry a balance threshold`,
            );
          }
        }
        if (SELF_COMPLETABLE_METHODS.has(level.completionMethod)) {
          issue(
            issues,
            "GATE_COMPLETION_METHOD_SELF_COMPLETABLE",
            `${levelPath}.completionMethod`,
            `${level.completionMethod} is a learner-driven completion owner and must not gate a ${level.type} level`,
          );
        }
        if (level.content) {
          issue(issues, "GATE_HAS_CONTENT", `${levelPath}.content`, "gated level must not carry lesson content");
        }
        if (level.assessment) {
          issue(issues, "GATE_HAS_ASSESSMENT", `${levelPath}.assessment`, "gated level must not carry an assessment");
        }
      } else if (level.gate) {
        issue(issues, "GATE_NOT_ALLOWED", `${levelPath}.gate`, `${level.type} level must not carry a gate`);
      }

      // A report level without a report definition is legal in a `draft`
      // package — that is how "structure known, prompt not yet approved" is
      // recorded honestly. `approved` packages are checked below.
      if (level.type !== "report" && level.report) {
        issue(issues, "REPORT_NOT_ALLOWED", `${levelPath}.report`, `${level.type} level must not carry a report`);
      }

      if (!isContentAllowed && level.content) {
        issue(issues, "CONTENT_TYPE_INCOMPATIBLE", `${levelPath}.content`, `${level.type} level must not carry lesson content`);
      }
      if (!isAssessmentAllowed && level.assessment) {
        issue(issues, "ASSESSMENT_TYPE_INCOMPATIBLE", `${levelPath}.assessment`, `${level.type} level must not carry an assessment`);
      }

      /* -------------------------- content --------------------------- */
      if (level.content) {
        const contentPath = `${levelPath}.content`;
        if (seenContentCodes.has(`${level.content.contentCode}@${level.content.versionNumber}`)) {
          issue(issues, "CONTENT_CODE_DUPLICATE", `${contentPath}.contentCode`, "duplicate content code/version");
        }
        seenContentCodes.add(`${level.content.contentCode}@${level.content.versionNumber}`);
        if (!level.content.localizations.some((l) => l.locale === pkg.locale)) {
          issue(issues, "CONTENT_LOCALIZATION_MISSING", `${contentPath}.localizations`, `missing package locale ${pkg.locale}`);
        }
        /* ---- PHASE-C: asset table, then every reference into it ---- */
        const assetKindByCode = new Map<string, string>();
        const assetSortOrders = new Set<number>();
        level.content.assets.forEach((asset, ai) => {
          const assetPath = `${contentPath}.assets[${ai}]`;
          if (assetKindByCode.has(asset.assetCode)) {
            issue(issues, "CONTENT_ASSET_CODE_DUPLICATE", `${assetPath}.assetCode`, "duplicate assetCode within the content version");
          }
          assetKindByCode.set(asset.assetCode, asset.kind);
          if (assetSortOrders.has(asset.sortOrder)) {
            issue(issues, "CONTENT_ASSET_ORDER_DUPLICATE", `${assetPath}.sortOrder`, "duplicate asset sortOrder within the content version");
          }
          assetSortOrders.add(asset.sortOrder);
        });
        // A video asset without a declared duration cannot drive the lesson
        // read-progress threshold, which `content-read-progress.ts` computes
        // from `videoDurationSeconds`. Mirrors CONTENT_VIDEO_DURATION_REQUIRED
        // on the authoring path, which the importer never runs.
        if (
          level.content.assets.some((asset) => asset.kind === "video") &&
          level.content.videoDurationSeconds === null
        ) {
          issue(issues, "CONTENT_VIDEO_DURATION_REQUIRED", `${contentPath}.videoDurationSeconds`, "content with a video asset must declare videoDurationSeconds");
        }

        const localeCodes = new Set<string>();
        level.content.localizations.forEach((l, i) => {
          const localizationPath = `${contentPath}.localizations[${i}]`;
          if (localeCodes.has(l.locale)) {
            issue(issues, "CONTENT_LOCALE_DUPLICATE", `${localizationPath}.locale`, "duplicate locale");
          }
          localeCodes.add(l.locale);

          // Section codes are durable learner state (`completedSections`), so a
          // duplicate is refused for BOTH formats. v2 also refuses it inside its
          // own schema; this keeps one code for one defect either way.
          const sectionCodes = new Set<string>();
          contentBodySectionCodes(l.body).forEach((code, si) => {
            if (sectionCodes.has(code)) {
              issue(issues, "CONTENT_SECTION_DUPLICATE", `${localizationPath}.body.sections[${si}].code`, "duplicate section code");
            }
            sectionCodes.add(code);
          });

          // §10 — a block may only reference an asset that this package ships,
          // and only one of a compatible KIND. Structural: nothing here opens a
          // socket, and a package validates identically with no network.
          for (const reference of contentBodyAssetReferences(l.body)) {
            const referencePath = `${localizationPath}.body.${reference.path}`;
            const kind = assetKindByCode.get(reference.assetCode);
            if (kind === undefined) {
              issue(issues, "CONTENT_ASSET_REFERENCE_MISSING", referencePath, "block references an assetCode that is not declared by this content version");
            } else if (!reference.kinds.includes(kind)) {
              issue(
                issues,
                "CONTENT_ASSET_REFERENCE_KIND_MISMATCH",
                referencePath,
                `block requires an asset of kind ${reference.kinds.join("/")} but the referenced asset is ${kind}`,
              );
            }
          }

          // §11 — tool codes come from the Backend-owned product vocabulary. An
          // unknown code is an error in a DRAFT too: a tool either exists or it
          // does not, and there is no authoring state in which inventing one is
          // legitimate.
          for (const reference of contentBodyToolReferences(l.body)) {
            if (!isProductToolCode(reference.toolCode)) {
              issue(
                issues,
                "CONTENT_TOOL_CODE_UNKNOWN",
                `${localizationPath}.body.${reference.path}`,
                "block references a tool code that is not in the canonical product vocabulary",
              );
            }
          }
        });
      }

      /* ------------------------- assessment ------------------------- */
      if (level.assessment) {
        const assessmentPath = `${levelPath}.assessment`;
        if (seenAssessmentCodes.has(level.assessment.assessmentCode)) {
          issue(issues, "ASSESSMENT_CODE_DUPLICATE", `${assessmentPath}.assessmentCode`, "duplicate assessment code");
        }
        seenAssessmentCodes.add(level.assessment.assessmentCode);
        if (level.assessment.maxAttempts !== null && level.assessment.maxAttempts < 1) {
          issue(issues, "ASSESSMENT_RETRY_IMPOSSIBLE", `${assessmentPath}.maxAttempts`, "maxAttempts must be >= 1 or null");
        }

        const questionCodes = new Set<string>();
        const questionNumbers = new Set<number>();
        level.assessment.questions.forEach((question, qi) => {
          const questionPath = `${assessmentPath}.questions[${qi}]`;
          if (questionCodes.has(question.questionCode)) {
            issue(issues, "QUESTION_CODE_DUPLICATE", `${questionPath}.questionCode`, "duplicate question code");
          }
          questionCodes.add(question.questionCode);
          if (questionNumbers.has(question.questionNumber)) {
            issue(issues, "QUESTION_NUMBER_DUPLICATE", `${questionPath}.questionNumber`, "duplicate question number");
          }
          questionNumbers.add(question.questionNumber);

          const optionCodes = new Set<string>();
          question.optionCodes.forEach((optionCode, oi) => {
            if (optionCodes.has(optionCode)) {
              issue(issues, "OPTION_CODE_DUPLICATE", `${questionPath}.optionCodes[${oi}]`, "duplicate option code within question");
            }
            optionCodes.add(optionCode);
          });

          const isNumeric = question.type === "numeric";
          if (isNumeric) {
            if (question.correctNumericValue === null) {
              issue(issues, "QUESTION_CORRECT_ANSWER_MISSING", `${questionPath}.correctNumericValue`, "numeric question requires a correct value");
            }
          } else {
            if (question.optionCodes.length < 2) {
              issue(issues, "QUESTION_OPTIONS_INSUFFICIENT", `${questionPath}.optionCodes`, "choice question requires at least two options");
            }
            if (question.correctOptionCodes.length === 0) {
              issue(issues, "QUESTION_CORRECT_ANSWER_MISSING", `${questionPath}.correctOptionCodes`, "question requires a correct answer");
            }
            for (const correct of question.correctOptionCodes) {
              if (!optionCodes.has(correct)) {
                issue(issues, "QUESTION_CORRECT_OPTION_ABSENT", `${questionPath}.correctOptionCodes`, "correct option is not among the options");
              }
            }
            if (question.type === "single_choice" && question.correctOptionCodes.length !== 1) {
              issue(issues, "QUESTION_CORRECT_ANSWER_CARDINALITY", `${questionPath}.correctOptionCodes`, "single_choice requires exactly one correct option");
            }
          }

          for (const [li, localization] of question.localizations.entries()) {
            if (!isNumeric && localization.optionLabels.length !== question.optionCodes.length) {
              issue(
                issues,
                "QUESTION_OPTION_LABEL_MISMATCH",
                `${questionPath}.localizations[${li}].optionLabels`,
                "option label count does not match option code count",
              );
            }
          }
          if (!question.localizations.some((l) => l.locale === pkg.locale)) {
            issue(issues, "QUESTION_LOCALIZATION_MISSING", `${questionPath}.localizations`, `missing package locale ${pkg.locale}`);
          }
        });
      }

      /* --------------------------- report --------------------------- */
      if (level.report) {
        const reportPath = `${levelPath}.report`;
        if (seenReportCodes.has(level.report.reportCode)) {
          issue(issues, "REPORT_CODE_DUPLICATE", `${reportPath}.reportCode`, "duplicate report code");
        }
        seenReportCodes.add(level.report.reportCode);
        const localized = level.report.localizations.find((l) => l.locale === pkg.locale);
        if (!localized) {
          issue(issues, "REPORT_LOCALIZATION_MISSING", `${reportPath}.localizations`, `missing package locale ${pkg.locale}`);
        } else if (localized.instructions.trim().length === 0) {
          issue(issues, "REPORT_PROMPT_MISSING", `${reportPath}.localizations`, "report requires a prompt");
        }
        const fieldKeys = new Set<string>();
        const fieldOrders = new Set<number>();
        // Built for requiredWhen controller resolution (same report definition only).
        const reportFieldsByCode = new Map<string, RequiredWhenFieldRef>();
        level.report.fields.forEach((field) => {
          reportFieldsByCode.set(field.stableKey, {
            stableKey: field.stableKey,
            type: field.type,
            sortOrder: field.sortOrder,
            required: field.required,
            choiceCodes: field.choiceCodes.length > 0 ? field.choiceCodes : null,
          });
        });
        level.report.fields.forEach((field, fi) => {
          const fieldPath = `${reportPath}.fields[${fi}]`;
          if (fieldKeys.has(field.stableKey)) {
            issue(issues, "REPORT_FIELD_DUPLICATE", `${fieldPath}.stableKey`, "duplicate report field key");
          }
          fieldKeys.add(field.stableKey);
          if (fieldOrders.has(field.sortOrder)) {
            issue(issues, "REPORT_FIELD_ORDER_DUPLICATE", `${fieldPath}.sortOrder`, "duplicate report field sortOrder");
          }
          fieldOrders.add(field.sortOrder);
          if (field.minLength !== null && field.maxLength !== null && field.minLength > field.maxLength) {
            issue(issues, "REPORT_FIELD_LENGTH_INVALID", `${fieldPath}.minLength`, "minLength exceeds maxLength");
          }
          const needsChoices = field.type === "single_choice" || field.type === "multi_choice";
          if (needsChoices && field.choiceCodes.length < 2) {
            issue(issues, "REPORT_FIELD_CHOICES_MISSING", `${fieldPath}.choiceCodes`, "choice field requires at least two choices");
          }
          // Conditional requiredness (RC-1): controller must be an earlier field of
          // the same report, the comparison must be type-compatible, and a field
          // must not be both statically required and conditionally required.
          const requiredWhen = field.requiredWhen ?? null;
          if (requiredWhen) {
            const problem = validateRequiredWhen(
              requiredWhen,
              {
                stableKey: field.stableKey,
                type: field.type,
                sortOrder: field.sortOrder,
                required: field.required,
                choiceCodes: field.choiceCodes.length > 0 ? field.choiceCodes : null,
              },
              reportFieldsByCode,
            );
            if (problem) {
              issue(issues, `REPORT_FIELD_${problem.code}`, `${fieldPath}.requiredWhen`, problem.message);
            }
          }
        });
        if (!level.report.attachmentsAllowed && level.report.maxAttachments !== 0) {
          issue(issues, "REPORT_ATTACHMENT_POLICY_INVALID", `${reportPath}.maxAttachments`, "maxAttachments must be 0 when attachments are not allowed");
        }

        /* ---------------------- rubric (owner) ---------------------- */
        /*
         * A declared rubric must be one the report domain would actually
         * publish. `publishReportRubric` runs `validateReportRubricPublication`,
         * and a rubric that fails it can be imported but never published, never
         * bound, and so never completes a level — a silent progression dead end
         * of exactly the kind this revision exists to remove. The rules below
         * are that validator's structural subset, checked BEFORE import instead
         * of after.
         */
        if (level.report.rubric) {
          const rubric = level.report.rubric;
          const rubricPath = `${reportPath}.rubric`;
          if (seenRubricCodes.has(rubric.rubricCode)) {
            issue(issues, "REPORT_RUBRIC_CODE_DUPLICATE", `${rubricPath}.rubricCode`, "duplicate rubric code");
          }
          seenRubricCodes.add(rubric.rubricCode);

          const criterionKeys = new Set<string>();
          const criterionOrders = new Set<number>();
          rubric.criteria.forEach((criterion, ci) => {
            const criterionPath = `${rubricPath}.criteria[${ci}]`;
            if (criterionKeys.has(criterion.stableKey)) {
              issue(issues, "REPORT_CRITERION_KEY_DUPLICATE", `${criterionPath}.stableKey`, "duplicate criterion stableKey");
            }
            criterionKeys.add(criterion.stableKey);
            if (criterionOrders.has(criterion.sortOrder)) {
              issue(issues, "REPORT_CRITERION_ORDER_DUPLICATE", `${criterionPath}.sortOrder`, "duplicate criterion sortOrder");
            }
            criterionOrders.add(criterion.sortOrder);
            // The one product rule the review domain will not bend: whether a
            // learner made money is never on its own an approval criterion.
            if (PROFIT_ONLY_CRITERION_CATEGORIES.has(criterion.categoryCode)) {
              issue(
                issues,
                "REPORT_PROFIT_CRITERION_FORBIDDEN",
                `${criterionPath}.categoryCode`,
                "profit or return alone cannot be an approval criterion",
              );
            }
            if (!criterion.localizations.some((l) => l.locale === pkg.locale)) {
              issue(issues, "REPORT_CRITERION_LOCALIZATION_MISSING", `${criterionPath}.localizations`, `missing package locale ${pkg.locale}`);
            }
          });

          const scaleKeys = new Set<string>();
          const scaleOrdinals = new Set<number>();
          rubric.scaleOptions.forEach((option, si) => {
            const optionPath = `${rubricPath}.scaleOptions[${si}]`;
            if (scaleKeys.has(option.stableKey)) {
              issue(issues, "REPORT_SCALE_KEY_DUPLICATE", `${optionPath}.stableKey`, "duplicate scale option stableKey");
            }
            scaleKeys.add(option.stableKey);
            if (scaleOrdinals.has(option.ordinal)) {
              issue(issues, "REPORT_SCALE_ORDER_DUPLICATE", `${optionPath}.ordinal`, "duplicate scale option ordinal");
            }
            scaleOrdinals.add(option.ordinal);
            if (!option.localizations.some((l) => l.locale === pkg.locale)) {
              issue(issues, "REPORT_SCALE_LOCALIZATION_MISSING", `${optionPath}.localizations`, `missing package locale ${pkg.locale}`);
            }
          });

          const reasonKeys = new Set<string>();
          const reasonOrders = new Set<number>();
          rubric.rejectionReasons.forEach((reason, ri) => {
            const reasonPath = `${rubricPath}.rejectionReasons[${ri}]`;
            if (reasonKeys.has(reason.stableKey)) {
              issue(issues, "REPORT_REASON_KEY_DUPLICATE", `${reasonPath}.stableKey`, "duplicate rejection reason stableKey");
            }
            reasonKeys.add(reason.stableKey);
            if (reasonOrders.has(reason.sortOrder)) {
              issue(issues, "REPORT_REASON_ORDER_DUPLICATE", `${reasonPath}.sortOrder`, "duplicate rejection reason sortOrder");
            }
            reasonOrders.add(reason.sortOrder);
            if (!reason.localizations.some((l) => l.locale === pkg.locale)) {
              issue(issues, "REPORT_REASON_LOCALIZATION_MISSING", `${reasonPath}.localizations`, `missing package locale ${pkg.locale}`);
            }
          });
          // A rejection reason is how a reviewer sends work back. A rubric whose
          // reasons are all inactive can be published and then strands every
          // rejection, so the ACTIVE count is what is required, not the count.
          if (!rubric.rejectionReasons.some((reason) => reason.active)) {
            issue(issues, "REPORT_REASON_REQUIRED", `${rubricPath}.rejectionReasons`, "at least one active rejection reason is required");
          }
          // A rubric that is not published cannot back a binding: the
          // completeness gate requires a published rubric, and `publishReportRubric`
          // is unreachable for an imported curriculum once it leaves draft.
          if (rubric.status !== level.report.status) {
            issue(
              issues,
              "REPORT_RUBRIC_STATUS_MISMATCH",
              `${rubricPath}.status`,
              `rubric status "${rubric.status}" must match the report assignment status "${level.report.status}"`,
            );
          }
        }
      }
    });
  });

  /* ------------------------- 4. graph checks ------------------------- */
  for (const [code, { level, path }] of levelsByCode) {
    for (const [pi, prerequisite] of level.prerequisiteLevelCodes.entries()) {
      const prerequisitePath = `${path}.prerequisiteLevelCodes[${pi}]`;
      if (!parseLevelCode(prerequisite).ok) {
        issue(issues, "PREREQUISITE_CODE_INVALID", prerequisitePath, "prerequisite must be a canonical level code");
        continue;
      }
      if (prerequisite === code) {
        issue(issues, "PREREQUISITE_SELF", prerequisitePath, "level must not depend on itself");
        continue;
      }
      const target = levelsByCode.get(prerequisite);
      if (!target) {
        issue(issues, "PREREQUISITE_MISSING", prerequisitePath, "prerequisite level is not in this package");
        continue;
      }
      if (target.level.levelNumber >= level.levelNumber) {
        issue(issues, "PREREQUISITE_NOT_EARLIER", prerequisitePath, "prerequisite must precede the level");
      }
    }
    if (level.checkpointLevelCode !== null) {
      const checkpointPath = `${path}.checkpointLevelCode`;
      if (!parseLevelCode(level.checkpointLevelCode).ok) {
        issue(issues, "CHECKPOINT_CODE_INVALID", checkpointPath, "checkpoint must be a canonical level code");
      } else if (!levelsByCode.has(level.checkpointLevelCode)) {
        issue(issues, "CHECKPOINT_MISSING", checkpointPath, "checkpoint level is not in this package");
      }
    }
  }

  // A module's checkpoint reference is a stable code too, and is easy to miss:
  // it is the one code the level loop above never sees.
  pkg.modules.forEach((moduleDefinition, moduleIndex) => {
    if (moduleDefinition.checkpointLevelCode === null) return;
    const checkpointPath = `modules[${moduleIndex}].checkpointLevelCode`;
    if (!parseLevelCode(moduleDefinition.checkpointLevelCode).ok) {
      issue(issues, "MODULE_CHECKPOINT_CODE_INVALID", checkpointPath, "module checkpoint must be a canonical level code");
    } else if (!levelsByCode.has(moduleDefinition.checkpointLevelCode)) {
      issue(issues, "MODULE_CHECKPOINT_MISSING", checkpointPath, "module checkpoint level is not in this package");
    }
  });

  // Cycle detection over the prerequisite graph (independent of numbering).
  const colour = new Map<string, 0 | 1 | 2>();
  const walk = (code: string): boolean => {
    const state = colour.get(code) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    colour.set(code, 1);
    const entry = levelsByCode.get(code);
    for (const prerequisite of entry?.level.prerequisiteLevelCodes ?? []) {
      if (levelsByCode.has(prerequisite) && walk(prerequisite)) return true;
    }
    colour.set(code, 2);
    return false;
  };
  for (const code of levelsByCode.keys()) {
    if (walk(code)) {
      issue(issues, "PREREQUISITE_CYCLE", `levels.${code}`, "prerequisite cycle detected");
      break;
    }
  }

  /* --------------------- 5. hygiene / secrets scan -------------------- */
  scanStrings(
    pkg,
    "package",
    () => {},
    (key, path) => {
      if (looksLikeSecret(key)) {
        issue(issues, "SECRET_LIKE_FIELD", path, "package must not contain secret-like fields");
      }
    },
  );

  /* -------------------- 6. approved-package gates -------------------- */
  const approvalDebt: PackageIssue[] = [];
  const collectProvenance = (record: ProvenanceRecord, path: string, label: string): void => {
    if (record.classification === "MISSING" || record.classification === "CONFLICTING") {
      approvalDebt.push({ code: `PROVENANCE_${record.classification}`, path, message: `${label} has ${record.classification} provenance` });
    } else if (requiresApproval(record)) {
      approvalDebt.push({ code: "PROVENANCE_APPROVAL_REQUIRED", path, message: `${label} requires operator approval` });
    }
  };

  pkg.modules.forEach((moduleDefinition, mi) => {
    moduleDefinition.levels.forEach((level, li) => {
      const levelPath = `modules[${mi}].levels[${li}]`;
      collectProvenance(level.provenance, `${levelPath}.provenance`, "level");
      if (level.content) collectProvenance(level.content.provenance, `${levelPath}.content.provenance`, "content");
      if (level.gate) collectProvenance(level.gate.provenance, `${levelPath}.gate.provenance`, "gate");
      // A progression owner carries its OWN provenance and is held to the same
      // standard as any other content decision: an approved package may not ship
      // a threshold or a grading standard whose origin is `MISSING`.
      if (level.gate?.requirement) {
        collectProvenance(
          level.gate.requirement.provenance,
          `${levelPath}.gate.requirement.provenance`,
          "checkpoint requirement",
        );
      }
      if (level.report) collectProvenance(level.report.provenance, `${levelPath}.report.provenance`, "report");
      if (level.report?.rubric) {
        collectProvenance(level.report.rubric.provenance, `${levelPath}.report.rubric.provenance`, "report rubric");
      }
      if (level.assessment) {
        collectProvenance(level.assessment.provenance, `${levelPath}.assessment.provenance`, "assessment");
        level.assessment.questions.forEach((question, qi) => {
          collectProvenance(question.provenance, `${levelPath}.assessment.questions[${qi}].provenance`, "question");
        });
      }
    });
  });

  // Pending approvals must reference real levels, and never survive approval.
  pkg.pendingApprovals.forEach((pending, index) => {
    const pendingPath = `pendingApprovals[${index}]`;
    if (!levelsByCode.has(pending.levelCode)) {
      issue(issues, "PENDING_APPROVAL_UNKNOWN_LEVEL", `${pendingPath}.levelCode`, "pending approval references a level not in this package");
    }
    approvalDebt.push({
      code: `PENDING_${pending.classification}`,
      path: `${pendingPath}.${pending.element}`,
      message: pending.detail,
    });
  });

  if (pkg.status === "approved") {
    // An approved package must be production-clean: provenance, placeholders,
    // and real content for every content-bearing level.
    issues.push(...approvalDebt);

    scanStrings(
      pkg,
      "package",
      (value, path) => {
        const marker = containsPlaceholder(value);
        if (marker) {
          issue(issues, "PLACEHOLDER_IN_APPROVED_PACKAGE", path, `approved package contains placeholder marker ${marker}`);
        }
        // §15 — an approved package must not ship a retired product brand.
        // Scoped to the PACKAGE, so historical documents, tests and the
        // editorial-source manifest (which records the substitution by name)
        // are untouched: they are not production package inputs.
        const brand = findObsoleteBrand(value);
        if (brand) {
          issue(issues, "OBSOLETE_BRAND_IN_APPROVED_PACKAGE", path, `approved package contains obsolete product brand ${brand}`);
        }
      },
      () => {},
    );

    for (const [, { level, path }] of levelsByCode) {
      if (level.type === "report" && !level.report) {
        issue(issues, "REPORT_REQUIRED_FOR_APPROVED", `${path}.report`, "report level in an approved package requires a report definition");
      }
      // §17 — content that EXISTS in an approved package must be real, whatever
      // the level type. Checked for every level that carries content, not only
      // the types where content is mandatory: shipping an empty lesson body on
      // an optional-content level is the same defect.
      if (level.content) {
        for (const [li, localization] of level.content.localizations.entries()) {
          const bodyPath = `${path}.content.localizations[${li}].body`;
          if (contentBodyTeachingCharacters(localization.body) < MIN_APPROVED_TEACHING_CHARACTERS) {
            issue(
              issues,
              "CONTENT_BODY_LEARNER_EMPTY",
              bodyPath,
              `approved content must teach something: fewer than ${MIN_APPROVED_TEACHING_CHARACTERS} characters of educational text`,
            );
          }
          if (!contentBodyHasRiskDisclaimer(localization.body)) {
            issue(
              issues,
              "CONTENT_RISK_DISCLAIMER_MISSING",
              bodyPath,
              isBlocksV2(localization.body)
                ? "approved content must carry a callout block with variant risk"
                : "approved content must carry a non-empty riskDisclaimer",
            );
          }
        }
      }
      if (!CONTENT_REQUIRED_FOR_APPROVED_TYPES.has(level.type)) continue;
      if (!level.content) {
        issue(issues, "CONTENT_REQUIRED_FOR_APPROVED", `${path}.content`, "content-bearing level in an approved package requires content");
        continue;
      }
      if (level.content.status !== "published") {
        issue(issues, "CONTENT_NOT_PUBLISHED", `${path}.content.status`, "approved package requires published content");
      }
    }
  } else {
    warnings.push(...approvalDebt);
  }

  /* ------------------------- 7. fingerprint -------------------------- */
  const fingerprint = calculateFingerprint(pkg);
  if (fingerprint !== pkg.contentFingerprint) {
    issue(issues, "FINGERPRINT_MISMATCH", "contentFingerprint", "declared fingerprint does not match calculated content");
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, package: pkg, fingerprint, warnings };
}
