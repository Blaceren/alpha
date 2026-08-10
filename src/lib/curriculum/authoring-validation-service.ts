/**
 * PHASE-G1 — the server-authoritative validation SERVICE.
 *
 * G0 built `authoring-validation.ts`, which orchestrates every accepted
 * validator over values already in memory. What it had no way to do was obtain
 * those values: it takes a body, a title, an asset table, a question list and a
 * contract, and nothing in the platform assembled them. This module is that
 * loader, and it is deliberately nothing else.
 *
 * IT ADDS NO RULE. Every judgement below comes from `validateAuthoringContent`,
 * `validateAuthoringAssessment`, `detectAnswerLeakage` and
 * `readVideoProductionCoherence`. If a rule appears to be decided here rather
 * than delegated, that is a bug — the CRM is forbidden from re-implementing the
 * validator (§22) and so is this file.
 *
 * ONE EXCEPTION, AND IT IS A LOAD, NOT A RULE: whether a level must teach.
 * `requiresTeaching` switches the accepted prose floor on or off, and the
 * accepted profile already draws that line by level KIND. Reproduced here from
 * the DURABLE level type, because the validator takes a boolean and something
 * has to answer it from the database.
 *
 * READ-ONLY. No function in this module writes. `approveVersion` takes
 * `validationPassed` as a required argument precisely so that running the
 * validator and acting on it stay two separate, auditable decisions.
 */
import { prisma } from "@/lib/prisma";
import type { AuthoringIssue } from "@/lib/curriculum/authoring-errors";
import {
  detectAnswerLeakage,
  mergeValidation,
  validateAuthoringAssessment,
  validateAuthoringContent,
  type AuthoringValidationResult,
} from "@/lib/curriculum/authoring-validation";
import { AUTHORING_LOCALE } from "@/lib/curriculum/authoring-read";
import {
  resolveCandidate,
  type AuthoringCandidateSelection,
} from "@/lib/curriculum/authoring-candidate";
import { resolveAuthoritySource } from "@/lib/curriculum/source-authority";
import { requiresLearnerTeachingContent } from "@/lib/curriculum/authoring-level-profile";
import { readVideoProductionCoherence } from "@/lib/curriculum/video-production-coherence";
import { parseContractPayload } from "@/lib/curriculum/video-production-authoring";
import { CANONICAL_ASSESSMENT_LOCALE } from "@/lib/curriculum/authoring-assessment-projection";

/**
 * Levels whose copy is SYSTEM copy rather than teaching prose.
 *
 * The accepted ATA profile applies its editorial floor to `video_test`,
 * `practical` and `report` and to nothing else; the registration gate and the
 * financial checkpoints carry explanatory system text, and holding them to a
 * 400-character teaching floor would block submission of a level that is
 * correct. Expressed here over the durable `LevelDefinitionType` because that is
 * what the database stores.
 */
/**
 * PHASE-G1 CORRECTION — removed, and replaced by the shared product profile.
 *
 * This set answered "does this level teach?" from the durable TYPE alone, which
 * made every type that is not a gate a teaching level — including `report`.
 * Readiness answered the same question from the canonical ATA kind and excluded
 * `report`, so L3 was simultaneously "owes nothing" and "missing its ru body",
 * and the whole-curriculum handoff bundle — which consults both — could never be
 * produced on the real backlog. `requiresLearnerTeachingContent` is now the only
 * implementation.
 */

export type AuthoringValidationSection = "content" | "assessment" | "video" | "cross";

export type AuthoringValidationIssueDetail = AuthoringIssue & {
  section: AuthoringValidationSection;
  severity: "blocker" | "warning";
};

export type AuthoringValidationReport = {
  levelDefinitionId: number;
  levelNumber: number;
  stableCode: string;
  contentVersionId: number | null;
  assessmentVersionId: number | null;
  videoProductionVersionId: number | null;
  /** Blocking issues only. `true` is what `approveVersion` may be told. */
  ok: boolean;
  issues: AuthoringValidationIssueDetail[];
  warnings: AuthoringValidationIssueDetail[];
  /** Per-section counts so a UI can summarise without re-scanning the list. */
  summary: Record<AuthoringValidationSection, { issues: number; warnings: number }>;
};

function tag(
  result: AuthoringValidationResult,
  section: AuthoringValidationSection,
): { issues: AuthoringValidationIssueDetail[]; warnings: AuthoringValidationIssueDetail[] } {
  return {
    issues: result.issues.map((issue) => ({ ...issue, section, severity: "blocker" as const })),
    warnings: result.warnings.map((issue) => ({ ...issue, section, severity: "warning" as const })),
  };
}

function emptySummary(): AuthoringValidationReport["summary"] {
  return {
    content: { issues: 0, warnings: 0 },
    assessment: { issues: 0, warnings: 0 },
    video: { issues: 0, warnings: 0 },
    cross: { issues: 0, warnings: 0 },
  };
}

/**
 * Validate everything authored beneath one level.
 *
 * A level with NO content version is not "invalid" — it is unauthored, which the
 * readiness projection reports as a gap. Validation answers "would what exists
 * pass?", so it reports the absence as a blocker only for a level that must
 * teach, and stays silent for a gate level that legitimately has none.
 */
export async function validateLevelAuthoring(input: {
  curriculumVersionId: number;
  levelDefinitionId: number;
  /**
   * PHASE-G2 SUCCESSOR — WHICH versions to judge, when the caller knows.
   *
   * OPTIONAL PER AXIS, and omission is not a lesser answer: an omitted axis falls
   * back to `pickRuntimeVersion`, byte-identically to the accepted behaviour, so
   * every existing caller is unchanged. What it adds is the ability to say "judge
   * THIS draft", which is the question submit and approve were always really
   * asking and could not express.
   *
   * A SUPPLIED ID IS VERIFIED, NEVER TRUSTED. The candidate lists below are
   * already scoped to this level and curriculum version, so an id from another
   * level is simply absent from them and the resolver refuses. That is the whole
   * of the cross-level guard: it is a property of the query, not a check someone
   * has to remember to write.
   */
  candidate?: AuthoringCandidateSelection;
}): Promise<AuthoringValidationReport | null> {
  const level = await prisma.levelDefinition.findFirst({
    where: { id: input.levelDefinitionId, curriculumVersionId: input.curriculumVersionId },
    select: { id: true, levelNumber: true, stableCode: true, type: true },
  });
  if (!level) return null;

  const requiresTeaching = requiresLearnerTeachingContent({
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    type: level.type,
  });

  const [binding, contentVersions, assessmentVersions, videoVersions] = await Promise.all([
    prisma.levelResourceBinding.findUnique({
      where: { levelDefinitionId: level.id },
      select: { contentVersionId: true, assessmentVersionId: true },
    }),
    prisma.contentVersion.findMany({
      where: { levelDefinitionId: level.id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        localizations: {
          where: { locale: AUTHORING_LOCALE },
          select: { title: true, body: true },
        },
        assets: { select: { assetCode: true, kind: true } },
      },
    }),
    prisma.assessmentVersion.findMany({
      where: { levelDefinitionId: level.id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        questions: {
          orderBy: { questionNumber: "asc" },
          select: {
            questionNumber: true,
            stableKey: true,
            correctAnswer: true,
            options: true,
            localizations: {
              where: { locale: CANONICAL_ASSESSMENT_LOCALE },
              select: { prompt: true, optionLabels: true, explanation: true },
            },
          },
        },
      },
    }),
    prisma.videoProductionVersion.findMany({
      where: { levelDefinitionId: level.id },
      orderBy: { versionNumber: "desc" },
      // CORRECTION-2 — the payload, so this service can answer the one question
      // it was previously assumed to answer and did not.
      // PHASE-G2 SUCCESSOR — findMany, not findFirst: a candidate video version
      // has to be selectable, and a one-row query cannot offer a choice.
      select: { id: true, versionNumber: true, contractPayload: true },
    }),
  ]);

  // PHASE-G2 SUCCESSOR — the local `pick` that used to live here is GONE.
  //
  // It was a second implementation of `pickRuntimeVersion`, and the two agreeing
  // was a coincidence maintained by hand. The independent audit found Content
  // resolving to its bound v1 while Assessment resolved to its newest version on
  // the SAME level, and traced it to one selector reading a half-populated
  // binding row — a divergence that a single shared function makes impossible to
  // reintroduce silently.
  const contentRow = resolveCandidate(
    contentVersions, input.candidate?.contentVersionId, binding?.contentVersionId, "content", level.id,
  );
  const assessmentRow = resolveCandidate(
    assessmentVersions, input.candidate?.assessmentVersionId, binding?.assessmentVersionId, "assessment", level.id,
  );
  const videoVersion = resolveCandidate(
    videoVersions, input.candidate?.videoProductionVersionId, null, "video_production", level.id,
  );

  const issues: AuthoringValidationIssueDetail[] = [];
  const warnings: AuthoringValidationIssueDetail[] = [];
  const summary = emptySummary();

  const absorb = (
    result: AuthoringValidationResult,
    section: AuthoringValidationSection,
  ) => {
    const tagged = tag(result, section);
    issues.push(...tagged.issues);
    warnings.push(...tagged.warnings);
    summary[section].issues += tagged.issues.length;
    summary[section].warnings += tagged.warnings.length;
  };

  const push = (
    list: AuthoringValidationIssueDetail[],
    section: AuthoringValidationSection,
    severity: "blocker" | "warning",
    issue: AuthoringIssue,
  ) => {
    list.push({ ...issue, section, severity });
    if (severity === "blocker") summary[section].issues += 1;
    else summary[section].warnings += 1;
  };

  /* ------------------------------------------------------------- content */
  const localization = contentRow?.localizations[0] ?? null;
  if (!contentRow || !localization) {
    if (requiresTeaching) {
      push(issues, "content", "blocker", {
        code: "CONTENT_LOCALIZATION_ABSENT",
        path: "content",
        message: `level ${level.levelNumber} has no "${AUTHORING_LOCALE}" learner content to validate`,
      });
    }
  } else {
    absorb(
      validateAuthoringContent({
        body: localization.body,
        title: localization.title,
        assets: new Map(contentRow.assets.map((asset) => [asset.assetCode, asset.kind])),
        requiresTeaching,
      }),
      "content",
    );
  }

  /* ---------------------------------------------------------- assessment */
  // The ATA 4x4 profile applies to a level that carries a production contract —
  // the 58 video+assessment lessons — and to nothing else. Read from the durable
  // row rather than from a level-number literal.
  const ataVideoLevelNumber = videoVersion ? level.levelNumber : null;

  if (assessmentRow) {
    absorb(
      validateAuthoringAssessment({
        questions: assessmentRow.questions.map((question) => ({
          questionNumber: question.questionNumber,
          stableKey: question.stableKey,
          prompt: question.localizations[0]?.prompt ?? "",
          optionLabels: optionLabelList(question.localizations[0]?.optionLabels, question.options),
          correctAnswer: question.correctAnswer,
          explanation: question.localizations[0]?.explanation ?? null,
        })),
        ataVideoLevelNumber,
      }),
      "assessment",
    );

    for (const [index, question] of assessmentRow.questions.entries()) {
      if (!question.localizations[0]) {
        push(issues, "assessment", "blocker", {
          code: "ASSESSMENT_LOCALIZATION_ABSENT",
          path: `questions[${index}]`,
          message: `question ${question.stableKey} has no "${CANONICAL_ASSESSMENT_LOCALE}" localization`,
        });
      }
    }
  } else if (ataVideoLevelNumber !== null) {
    push(issues, "assessment", "blocker", {
      code: "ASSESSMENT_ABSENT",
      path: "assessment",
      message: `level ${level.levelNumber} is a video+assessment lesson with no assessment bank`,
    });
  }

  /* --------------------------------------------------------------- cross */
  if (localization && assessmentRow) {
    const answerTexts = assessmentRow.questions.map((question) =>
      correctAnswerText(question.correctAnswer, question.localizations[0]?.optionLabels),
    );
    const leaks = detectAnswerLeakage({
      body: localization.body,
      correctAnswerTexts: answerTexts,
    });
    for (const leak of leaks) push(issues, "cross", "blocker", leak);
  }

  /* --------------------------------------------------------------- video */
  if (videoVersion) {
    // CORRECTION-2 — a BLOCKER, and the correction of a false claim.
    //
    // `authoring-read` swallowed a contract parse failure with the comment "a
    // payload that no longer parses is reported by validation, not here". It was
    // not: nothing in this service ever parsed the payload, so an unparseable
    // contract produced ok=true, zero issues, zero conflicts and a successful
    // handoff for a bank with real unadjudicated disagreements. It is a blocker
    // rather than a warning because every downstream reading of that level —
    // conflicts, authority, coherence — is derived from this payload, and none
    // of them can be trusted while it cannot be read.
    try {
      parseContractPayload(videoVersion.contractPayload);
    } catch {
      push(issues, "video", "blocker", {
        code: "VIDEO_CONTRACT_UNPARSEABLE",
        path: "contractPayload",
        message:
          "Контракт видеопроизводства не читается — сравнение с банком вопросов невозможно / the stored production contract cannot be parsed, so no Blueprint comparison can be made",
      });
    }
    const coherence = await readVideoProductionCoherence(videoVersion.id, prisma);
    if (coherence.assessmentEvidenceStale) {
      push(warnings, "video", "warning", {
        code: `VIDEO_COHERENCE_${coherence.reason}`,
        path: "production",
        message:
          coherence.reason === "UNLINKED"
            ? "видеоконтракт не связан с банком вопросов — свежесть QA подтвердить нечем"
            : "Видео QA устарело после изменения теста — production evidence was reviewed against a different question bank",
      });
    }
    if (coherence.contractEvidenceStale) {
      push(warnings, "video", "warning", {
        code: "VIDEO_EVIDENCE_STALE",
        path: "production",
        message:
          "Видео QA устарело после изменения контракта — production evidence was reviewed against a different contract fingerprint",
      });
    }
  }

  /* ------------------------------------------ candidate / source coherence */
  //
  // PHASE-G2 SUCCESSOR (§36) — THE DIVERGENCE THAT USED TO BE INVISIBLE.
  //
  // This service judges the level's video version. Source authority judges the
  // bank against ITS canonical source, resolved by `resolveAuthoritySource` from
  // the bank's own durable `VideoProductionAssessmentLink`. Those two are the
  // same row in the ordinary case and NOT the same row the moment a level grows a
  // second production version — the link pins the bank to the contract it was
  // adjudicated against, while this service takes the newest.
  //
  // Nothing previously noticed. Validation would report coherence against v2's
  // contract while every conflict and authority number on the same screen came
  // from v1's, and both looked authoritative. This does not pick a winner — the
  // two questions are genuinely different and each selector is right about its
  // own — it makes the divergence VISIBLE, as a warning, so a reviewer is never
  // shown two numbers derived from different sources with nothing saying so.
  if (assessmentRow && videoVersion) {
    let authoritySourceId: number | null = null;
    try {
      authoritySourceId = (await resolveAuthoritySource(prisma, assessmentRow.id)).videoProductionVersionId;
    } catch {
      // An unresolvable source is already reported by the authority projection
      // itself, with a reason. Re-reporting it here would double-count one fact.
      authoritySourceId = null;
    }
    if (authoritySourceId !== null && authoritySourceId !== videoVersion.id) {
      push(warnings, "video", "warning", {
        code: "VIDEO_AUTHORITY_SOURCE_DIVERGED",
        path: "production",
        message:
          `валидация проверяет VideoProductionVersion ${videoVersion.id}, а источник авторитета банка — ${authoritySourceId} / ` +
          `validation is judging VideoProductionVersion ${videoVersion.id} while this bank's canonical source-authority contract is VideoProductionVersion ${authoritySourceId}; the conflict and authority counts are derived from the latter`,
      });
    }
  }

  const merged = mergeValidation({ ok: issues.length === 0, issues: [], warnings: [] });

  return {
    levelDefinitionId: level.id,
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    contentVersionId: contentRow?.id ?? null,
    assessmentVersionId: assessmentRow?.id ?? null,
    videoProductionVersionId: videoVersion?.id ?? null,
    ok: issues.length === 0 && merged.ok,
    issues,
    warnings,
    summary,
  };
}

/**
 * Option labels, in the option set's own order.
 *
 * The accepted validator counts them, so the ORDER does not matter to it — but
 * reading them off `options` rather than off the label record's key order means
 * a label with no matching option is absent from the count, which is the honest
 * reading: a label nobody can select is not an option.
 */
function optionLabelList(labels: unknown, options: unknown): string[] {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return [];
  const record = labels as Record<string, unknown>;
  if (Array.isArray(options)) {
    const codes = options
      .map((option) =>
        option && typeof option === "object" && !Array.isArray(option)
          ? (option as { code?: unknown }).code
          : null,
      )
      .filter((code): code is string => typeof code === "string");
    if (codes.length > 0) {
      return codes
        .map((code) => record[code])
        .filter((value): value is string => typeof value === "string");
    }
  }
  return Object.values(record).filter((value): value is string => typeof value === "string");
}

/** The learner-visible text of the correct option, for leak detection only. */
function correctAnswerText(correctAnswer: unknown, labels: unknown): string {
  if (!correctAnswer || typeof correctAnswer !== "object" || Array.isArray(correctAnswer)) return "";
  const code = (correctAnswer as { code?: unknown }).code;
  if (typeof code !== "string") return "";
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return "";
  const value = (labels as Record<string, unknown>)[code];
  return typeof value === "string" ? value : "";
}
