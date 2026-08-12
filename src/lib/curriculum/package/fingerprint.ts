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
  PackageGateRequirement,
  PackageLevel,
  PackageReport,
  PackageReportRubric,
} from "@/lib/curriculum/package/schema";
import { isBlocksV2, type ContentBody } from "@/lib/curriculum/content-body";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function byKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * PHASE-C — the body projection is FORMAT-AWARE.
 *
 * Two rules keep the fingerprint honest across the v1/v2 transition:
 *
 *  1. A v1 body projects EXACTLY as it always did, field for field, in the
 *     original order. Re-fingerprinting `ata-v2.first-slice` must produce the
 *     byte-identical hash it was approved with, or the approved package stops
 *     importing — so the legacy branch is frozen, not "refactored".
 *
 *  2. A v2 body projects through its own explicit walk, INCLUDING the `format`
 *     and `version` tags. Migrating a body from v1 to v2 is a semantic change to
 *     the content contract and must move the hash; two bodies that render the
 *     same but declare different formats are not the same content.
 *
 * Blocks are projected key-by-key in a fixed order like everything else here,
 * never by `JSON.stringify` over author key order, so an editor that reorders
 * keys cannot move the fingerprint.
 */
function projectBody(body: ContentBody): Json {
  if (!isBlocksV2(body)) {
    return {
      sections: body.sections.map((s) => ({ code: s.code, title: s.title, body: s.body })),
      examples: body.examples.map((e) => ({ title: e.title, body: e.body })),
      commonMistakes: body.commonMistakes.map((m) => ({ mistake: m.mistake, correction: m.correction })),
      glossary: body.glossary.map((g) => ({ term: g.term, definition: g.definition })),
      nextAction: { label: body.nextAction.label, body: body.nextAction.body },
      riskDisclaimer: body.riskDisclaimer,
    };
  }
  return {
    format: body.format,
    version: body.version,
    sections: body.sections.map((section) => ({
      code: section.code,
      title: section.title,
      blocks: section.blocks.map((block): Json => {
        switch (block.type) {
          case "heading":
            return { type: block.type, level: block.level, text: block.text };
          case "rich_text":
            return { type: block.type, text: block.text };
          case "callout":
            return { type: block.type, variant: block.variant, title: block.title, body: block.body };
          case "image":
            return { type: block.type, assetCode: block.assetCode, alt: block.alt, caption: block.caption };
          case "video":
            return {
              type: block.type,
              assetCode: block.assetCode,
              title: block.title,
              captionsAssetCode: block.captionsAssetCode,
              caption: block.caption,
            };
          case "list":
            return { type: block.type, ordered: block.ordered, items: [...block.items] };
          case "table":
            return {
              type: block.type,
              caption: block.caption,
              headers: [...block.headers],
              rows: block.rows.map((row) => [...row]),
            };
          case "example":
            return { type: block.type, title: block.title, body: block.body };
          case "common_mistake":
            return { type: block.type, mistake: block.mistake, correction: block.correction };
          case "glossary":
            return {
              type: block.type,
              entries: block.entries.map((entry) => ({ term: entry.term, definition: entry.definition })),
            };
          case "exercise":
            return {
              type: block.type,
              code: block.code,
              title: block.title,
              instructions: block.instructions,
              expectedAction: block.expectedAction,
              estimatedMinutes: block.estimatedMinutes,
            };
          case "tool_link":
            return { type: block.type, toolCode: block.toolCode, label: block.label, context: block.context };
          case "cta":
            return {
              type: block.type,
              action: block.action,
              label: block.label,
              body: block.body,
              toolCode: block.toolCode,
            };
          case "divider":
            return { type: block.type };
          case "download":
            return {
              type: block.type,
              assetCode: block.assetCode,
              label: block.label,
              description: block.description,
            };
        }
      }),
    })),
  };
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
      body: projectBody(l.body),
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

/**
 * PROGRESSION OWNER PROJECTION — covered by the fingerprint, and ABSENT when the
 * package does not declare it.
 *
 * Two requirements pull in opposite directions and this is how both are met.
 * The rubric and the checkpoint threshold are semantic: they decide whether a
 * level can be completed and, for a checkpoint, how much money the platform will
 * ask a learner for, so excluding them from the canonical fingerprint would make
 * the fingerprint blind to the thing this revision exists to add. But a package
 * that carries neither — every artifact approved before revision 2 — must
 * fingerprint to the byte-identical value it was approved with, or the accepted
 * `ata-v2@v3` artifact stops importing.
 *
 * So the key is EMITTED ONLY WHEN PRESENT rather than emitted as `null`. The
 * serialiser walks `Object.keys`, so an absent owner adds no bytes at all and
 * historical projections are unchanged; a present one changes the hash, which is
 * exactly what a new artifact identity means.
 */
function projectReportRubric(rubric: PackageReportRubric | null | undefined): Json {
  if (!rubric) return null;
  return {
    rubricCode: rubric.rubricCode,
    versionNumber: rubric.versionNumber,
    status: rubric.status,
    criteria: byKey(rubric.criteria, (c) => c.stableKey).map((c) => ({
      stableKey: c.stableKey,
      categoryCode: c.categoryCode,
      sortOrder: c.sortOrder,
      commentRequired: c.commentRequired,
      localizations: byKey(c.localizations, (l) => l.locale).map((l) => ({
        locale: l.locale,
        title: l.title,
        description: l.description,
      })),
    })),
    scaleOptions: byKey(rubric.scaleOptions, (s) => s.stableKey).map((s) => ({
      stableKey: s.stableKey,
      ordinal: s.ordinal,
      localizations: byKey(s.localizations, (l) => l.locale).map((l) => ({
        locale: l.locale,
        label: l.label,
        description: l.description,
      })),
    })),
    rejectionReasons: byKey(rubric.rejectionReasons, (r) => r.stableKey).map((r) => ({
      stableKey: r.stableKey,
      sortOrder: r.sortOrder,
      active: r.active,
      localizations: byKey(r.localizations, (l) => l.locale).map((l) => ({
        locale: l.locale,
        title: l.title,
        guidance: l.guidance,
      })),
    })),
    provenance: rubric.provenance.classification,
  };
}

function projectGateRequirement(requirement: PackageGateRequirement | null | undefined): Json {
  if (!requirement) return null;
  return {
    thresholdCurrency: requirement.thresholdCurrency,
    thresholdMinorUnits: requirement.thresholdMinorUnits,
    provenance: requirement.provenance.classification,
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
      // Conditional requiredness is part of a field's semantic identity: changing
      // the controller, operator or comparison value must move the fingerprint.
      requiredWhen: f.requiredWhen
        ? { fieldCode: f.requiredWhen.fieldCode, operator: f.requiredWhen.operator, value: f.requiredWhen.value }
        : null,
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
    ...(report.rubric ? { rubric: projectReportRubric(report.rubric) } : {}),
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
    ...(gate.requirement ? { requirement: projectGateRequirement(gate.requirement) } : {}),
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

/**
 * The canonical projection's own JSON shape, and its own serialiser.
 *
 * Both are exported for ONE reason: an audit that wants to compare two packages
 * on everything EXCEPT a deliberately-changed identity field must hash the same
 * bytes this module hashes, or the comparison proves nothing about the
 * fingerprint it claims to explain. Re-implementing the walk next door would
 * drift the moment either copy changed. Nothing here alters what
 * `calculateFingerprint` covers or how it covers it — the canonical fingerprint
 * remains the whole projection, `curriculumVersionNumber` included.
 */
export type CanonicalJson = Json;
export function serializeCanonicalProjection(value: CanonicalJson): string {
  return serialize(value);
}

export function calculateFingerprint(pkg: CurriculumPackage): string {
  return createHash("sha256").update(serialize(canonicalProjection(pkg)), "utf8").digest("hex");
}

export function fingerprintMatches(pkg: CurriculumPackage): boolean {
  return calculateFingerprint(pkg) === pkg.contentFingerprint;
}
