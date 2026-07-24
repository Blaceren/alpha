/**
 * Deterministic package fingerprint.
 *
 * The fingerprint covers the SEMANTIC projection of a package: structure,
 * ordering, stable codes, prerequisites, bindings, localized content, questions,
 * correct answers, grading, report requirements and gate configuration. It
 * deliberately excludes only fields that carry no learner-visible or grading
 * meaning: `approval` (who signed off and when) and `contentFingerprint` itself.
 * `status` IS included — promoting a draft to approved is a semantic change.
 *
 * Determinism comes from an explicit canonical projection, never from
 * `JSON.stringify` over author-controlled key order: every object below is
 * rebuilt field-by-field in a fixed order, and every collection is sorted by its
 * stable code. Filesystem mtime and insertion order play no part.
 */
import { createHash } from "node:crypto";
import type {
  CurriculumPackage,
  PackageAssessment,
  PackageContent,
  PackageGate,
  PackageLevel,
  PackageReport,
} from "@/lib/curriculum/package/schema";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function byKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function projectContent(content: PackageContent | null): Json {
  if (!content) return null;
  return {
    contentCode: content.contentCode,
    versionNumber: content.versionNumber,
    status: content.status,
    videoDurationSeconds: content.videoDurationSeconds,
    localizations: byKey(content.localizations, (l) => l.locale).map((l) => ({
      locale: l.locale,
      title: l.title,
      subtitle: l.subtitle,
      learningObjectiveExtension: l.learningObjectiveExtension,
      summary: l.summary,
      transcript: l.transcript,
      body: {
        sections: l.body.sections.map((s) => ({ code: s.code, title: s.title, body: s.body })),
        examples: l.body.examples.map((e) => ({ title: e.title, body: e.body })),
        commonMistakes: l.body.commonMistakes.map((m) => ({ mistake: m.mistake, correction: m.correction })),
        glossary: l.body.glossary.map((g) => ({ term: g.term, definition: g.definition })),
        nextAction: { label: l.body.nextAction.label, body: l.body.nextAction.body },
        riskDisclaimer: l.body.riskDisclaimer,
      },
    })),
    assets: byKey(content.assets, (a) => a.assetCode).map((a) => ({
      kind: a.kind,
      assetCode: a.assetCode,
      locale: a.locale,
      url: a.url,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      durationSeconds: a.durationSeconds,
      sortOrder: a.sortOrder,
    })),
    provenance: content.provenance.classification,
  };
}

function projectAssessment(assessment: PackageAssessment | null): Json {
  if (!assessment) return null;
  return {
    assessmentCode: assessment.assessmentCode,
    versionNumber: assessment.versionNumber,
    status: assessment.status,
    passPercent: assessment.passPercent,
    maxAttempts: assessment.maxAttempts,
    showExplanation: assessment.showExplanation,
    questions: byKey(assessment.questions, (q) => q.questionCode).map((q) => ({
      questionCode: q.questionCode,
      questionNumber: q.questionNumber,
      type: q.type,
      skillTag: q.skillTag,
      optionCodes: [...q.optionCodes],
      // Correct answers are part of the semantic identity: changing an answer
      // must change the fingerprint.
      correctOptionCodes: [...q.correctOptionCodes].sort(),
      correctNumericValue: q.correctNumericValue,
      localizations: byKey(q.localizations, (l) => l.locale).map((l) => ({
        locale: l.locale,
        prompt: l.prompt,
        optionLabels: [...l.optionLabels],
        explanation: l.explanation,
      })),
      lessonTakeawayRef: q.lessonTakeawayRef,
      provenance: q.provenance.classification,
    })),
    provenance: assessment.provenance.classification,
  };
}

function projectReport(report: PackageReport | null): Json {
  if (!report) return null;
  return {
    reportCode: report.reportCode,
    versionNumber: report.versionNumber,
    status: report.status,
    localizations: byKey(report.localizations, (l) => l.locale).map((l) => ({
      locale: l.locale,
      title: l.title,
      instructions: l.instructions,
      successCriteriaSummary: l.successCriteriaSummary,
      submitLabel: l.submitLabel,
    })),
    fields: byKey(report.fields, (f) => f.stableKey).map((f) => ({
      stableKey: f.stableKey,
      type: f.type,
      required: f.required,
      sortOrder: f.sortOrder,
      minLength: f.minLength,
      maxLength: f.maxLength,
      choiceCodes: [...f.choiceCodes],
      localizations: byKey(f.localizations, (l) => l.locale).map((l) => ({
        locale: l.locale,
        label: l.label,
        helpText: l.helpText,
        placeholder: l.placeholder,
        choiceLabels: [...l.choiceLabels],
      })),
    })),
    attachmentsAllowed: report.attachmentsAllowed,
    maxAttachments: report.maxAttachments,
    draftAllowed: report.draftAllowed,
    mentorReviewRequired: report.mentorReviewRequired,
    provenance: report.provenance.classification,
  };
}

function projectGate(gate: PackageGate | null): Json {
  if (!gate) return null;
  return {
    completionSource: gate.completionSource,
    integrationCode: gate.integrationCode,
    selfCompletable: gate.selfCompletable,
    blockedExplanation: byKey(gate.blockedExplanation, (b) => b.locale).map((b) => ({
      locale: b.locale,
      text: b.text,
    })),
    provenance: gate.provenance.classification,
  };
}

function projectLevel(level: PackageLevel): Json {
  return {
    levelCode: level.levelCode,
    levelNumber: level.levelNumber,
    type: level.type,
    title: level.title,
    shortDescription: level.shortDescription,
    learningObjective: level.learningObjective,
    completionMethod: level.completionMethod,
    xpReward: level.xpReward,
    requiredXp: level.requiredXp,
    prerequisiteLevelCodes: [...level.prerequisiteLevelCodes].sort(),
    checkpointLevelCode: level.checkpointLevelCode,
    estimatedDurationSeconds: level.estimatedDurationSeconds,
    // Presence of a binding is itself semantic: binding drift must move the hash.
    contentBound: level.content !== null,
    assessmentBound: level.assessment !== null,
    reportBound: level.report !== null,
    gateBound: level.gate !== null,
    content: projectContent(level.content),
    assessment: projectAssessment(level.assessment),
    report: projectReport(level.report),
    gate: projectGate(level.gate),
    provenance: level.provenance.classification,
  };
}

/** The canonical semantic projection the fingerprint is taken over. */
export function canonicalProjection(pkg: CurriculumPackage): Json {
  return {
    schemaVersion: pkg.schemaVersion,
    packageCode: pkg.packageCode,
    packageRevision: pkg.packageRevision,
    status: pkg.status,
    curriculumCode: pkg.curriculumCode,
    curriculumVersionNumber: pkg.curriculumVersionNumber,
    curriculumTitle: pkg.curriculumTitle,
    curriculumDescription: pkg.curriculumDescription,
    locale: pkg.locale,
    pendingApprovals: byKey(pkg.pendingApprovals, (p) => `${p.levelCode}/${p.element}`).map((p) => ({
      levelCode: p.levelCode,
      element: p.element,
      classification: p.classification,
      detail: p.detail,
      blocksReadiness: p.blocksReadiness,
    })),
    modules: byKey(pkg.modules, (m) => m.moduleCode).map((m) => ({
      moduleCode: m.moduleCode,
      moduleNumber: m.moduleNumber,
      title: m.title,
      description: m.description,
      learningObjective: m.learningObjective,
      checkpointLevelCode: m.checkpointLevelCode,
      levels: byKey(m.levels, (l) => l.levelCode).map(projectLevel),
    })),
  };
}

/** Stable serialisation: arrays keep projected order, object keys are emitted as built. */
function serialize(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value)
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`)
    .join(",")}}`;
}

export function calculateFingerprint(pkg: CurriculumPackage): string {
  return createHash("sha256").update(serialize(canonicalProjection(pkg)), "utf8").digest("hex");
}

export function fingerprintMatches(pkg: CurriculumPackage): boolean {
  return calculateFingerprint(pkg) === pkg.contentFingerprint;
}
