/**
 * PHASE-G1 — the deterministic AUTHORING HANDOFF BUNDLE (§38, §39, §40).
 *
 * ============================== WHAT IT IS ==============================
 * A bundle is the DURABLE APPROVED AUTHORING slice of the curriculum, projected
 * deterministically so that an engineering/source-control step can merge it into
 * the canonical ATA-100 package without anybody copying JSON out of a browser.
 * It carries learner Body v2, content asset references, assessments and — where
 * approved — the production contract, keyed by `stableCode` and `versionNumber`.
 *
 * ============================ WHAT IT IS NOT ============================
 * It is not a publication, not an activation and not a deployment. Producing one
 * writes no curriculum row, touches no `status`, creates no binding and imports
 * nothing. The only row it writes is an audit record saying it was produced. The
 * name says handoff everywhere, including in the CRM, because a control called
 * "Publish" that produces a file is a lie an operator only discovers later.
 *
 * ======================== THE AUTHORITY SPLIT (§40) ========================
 * SOURCE-CONTROLLED and deliberately ABSENT from every bundle: the 100-level
 * structure, stable codes and ordering, completion pairs, XP, ranks, tool
 * unlocks, progression and all generic validators. A bundle that carried an XP
 * value would create a second authority for a number the source owns, and the
 * first disagreement would be silent. The bundle names levels by `stableCode`
 * and says nothing about what a level IS.
 *
 * ============================= DETERMINISM =============================
 * Same durable input → byte-identical bundle → identical fingerprint. Achieved
 * the way the accepted package fingerprint achieves it: an explicit field-by-
 * field projection in a fixed order with every collection sorted by a stable
 * key, never `JSON.stringify` over author key order. Row ids, timestamps and the
 * generating actor are EXCLUDED from the projection — they are identity and
 * audit, they differ between two databases holding the same approved content,
 * and including them would make "deterministic" mean "deterministic on one
 * machine".
 *
 * ============================== REFUSALS ==============================
 *   • AMBIGUITY — a level with more than one APPROVED content or assessment
 *     version has no single answer to "which text ships", and picking the
 *     highest version number would be a guess. Refused.
 *   • UNRESOLVED CONTENT — a level that carries any handoff blocker is refused
 *     rather than shipped partially. Levels not requested are reported in
 *     `excluded`, never silently dropped.
 *   • L2 stays unresolved. A conflicting bank is a blocker, so a level with
 *     Blueprint disagreements cannot enter a bundle at all until a human
 *     resolves them — which is G2 work and has no domain here.
 *   • L18 keeps its provenance: `sourceProvenance` and `sourceApproval` travel
 *     with every assessment in the bundle, so `SOURCE_BACKED` +
 *     `AWAITING_APPROVAL` remains readable downstream.
 */
import { createHash } from "node:crypto";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { AUTHORING_LOCALE, readAuthoringOverview } from "@/lib/curriculum/authoring-read";
import { levelHandoffStatus, type HandoffBlockerCode } from "@/lib/curriculum/authoring-readiness";
import { validateLevelAuthoring } from "@/lib/curriculum/authoring-validation-service";
import { readSourceAuthority, resolveAuthoritySource } from "@/lib/curriculum/source-authority";
import { prisma } from "@/lib/prisma";

export const HANDOFF_BUNDLE_SCHEMA = "ata.authoring.handoff/1" as const;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type HandoffLevel = {
  levelNumber: number;
  stableCode: string;
  content: {
    versionNumber: number;
    revision: number;
    locale: string;
    title: string;
    subtitle: string;
    learningObjectiveExtension: string;
    summary: string;
    transcript: string | null;
    body: Json;
    assets: Array<{
      assetCode: string;
      kind: string;
      locale: string | null;
      url: string;
      mimeType: string;
      sizeBytes: number | null;
      durationSeconds: number | null;
      checksum: string | null;
      sortOrder: number;
    }>;
  } | null;
  assessment: {
    versionNumber: number;
    revision: number;
    passPercent: number;
    maxAttempts: number | null;
    showExplanation: boolean;
    sourceProvenance: string | null;
    sourceApproval: string | null;
    /**
     * PHASE-G2 — the authority lineage (§19).
     *
     * A downstream reader must be able to prove that this bank HAD source
     * conflicts, that each was explicitly adjudicated, which side won, on whose
     * evidence and when — without holding the Backend database. Provenance
     * alone cannot say it: `PROPOSED_CANON` describes where the material came
     * from and stays true whichever side later won.
     *
     * DECISIONS ONLY, NEVER VALUES. The competing strings are not copied here.
     * Both sides remain where they already live — the bank below and the
     * contract payload — and the hashes are what tie a decision to them.
     */
    sourceAuthority: {
      state: string;
      rawConflictCount: number;
      resolvedConflictCount: number;
      blockingConflictCount: number;
      resolutionFingerprint: string | null;
      /**
       * PHASE-G2 SUCCESSOR — identity of HOW this bank's authority was reached,
       * beside the identity of WHAT was decided. A successor that inherits its
       * predecessor's decisions shares `resolutionFingerprint` and differs here.
       */
      authorityLineageFingerprint: string | null;
      /** How many of the decisions below came from an ancestor. */
      inheritedDecisionCount: number;
      /**
       * REVIEW-SURFACE CORRECTION — WHERE the canonical source came from.
       *
       * `"own"` — this bank carries the durable link. `"lineage"` — an ancestor
       * does, and this bank is measured against the proposal its ancestor was
       * pinned to; `linkLineageDepth` says how many hops away. `"none"` — no link
       * at all, reporting only.
       *
       * Without it a bundle describing an inherited relationship read exactly
       * like one describing an owned link, and a downstream reader could not tell
       * which bank was deliberately pinned to the proposal it was judged against.
       */
      linkOrigin: "own" | "lineage" | "none";
      linkLineageDepth: number;
      decisions: Array<{
        path: string;
        decision: string;
        application: string;
        decidedById: number;
        decidedAt: string;
        evidenceRef: string;
        evidenceSha256: string;
        blueprintSourceDocumentSha256: string;
        /**
         * PHASE-G2 SUCCESSOR — a downstream reader must be able to tell a
         * decision made ON this bank from one inherited by descent. Serialising
         * an inherited decision without saying so would let a handoff bundle
         * read as though a human adjudicated this exact bank, which is the one
         * claim inheritance must never make.
         */
        inherited: boolean;
        originAssessmentVersionId: number;
        inheritanceDepth: number;
      }>;
    } | null;
    questions: Array<{
      questionNumber: number;
      stableKey: string;
      type: string;
      skillTag: string | null;
      options: Json;
      correctAnswer: Json;
      localizations: Array<{
        locale: string;
        prompt: string;
        optionLabels: Json;
        explanation: string | null;
      }>;
    }>;
  } | null;
  production: {
    versionNumber: number;
    revision: number;
    contractPayload: Json;
  } | null;
};

export type HandoffExclusion = {
  levelNumber: number;
  stableCode: string;
  blockers: HandoffBlockerCode[];
};

export type HandoffBundle = {
  schema: typeof HANDOFF_BUNDLE_SCHEMA;
  bundleFormatVersion: 1;
  curriculumVersionCode: string;
  curriculumVersionNumber: number;
  locale: string;
  /** Which levels the caller asked for. `"all"` means every level in the version. */
  scope: "all" | "levels";
  requestedLevelNumbers: number[];
  levels: HandoffLevel[];
  /** Every level NOT in the bundle, with the reason. Never a silent omission. */
  excluded: HandoffExclusion[];
  counts: {
    requested: number;
    included: number;
    excluded: number;
    contentVersions: number;
    assessmentVersions: number;
    productionVersions: number;
  };
  /** sha256 over the canonical projection of everything above. */
  fingerprint: string;
};

/* ------------------------------------------------------------------ *
 * Canonical projection
 * ------------------------------------------------------------------ */

/**
 * Order-stable JSON for values whose internal key order the platform does not
 * own — a stored `body`, an `options` array, a `contractPayload`.
 *
 * These arrive from the database as opaque JSON. Everything AROUND them is
 * rebuilt field-by-field below; for the opaque values themselves, sorting object
 * keys recursively is what makes two databases that stored the same document
 * with different insertion order produce the same hash.
 */
function canonicalJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: { [key: string]: Json } = {};
    for (const [key, child] of entries) out[key] = canonicalJson(child);
    return out;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function projectLevel(level: HandoffLevel): Json {
  return {
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    content: level.content
      ? {
          versionNumber: level.content.versionNumber,
          revision: level.content.revision,
          locale: level.content.locale,
          title: level.content.title,
          subtitle: level.content.subtitle,
          learningObjectiveExtension: level.content.learningObjectiveExtension,
          summary: level.content.summary,
          transcript: level.content.transcript,
          body: canonicalJson(level.content.body),
          assets: level.content.assets.map((asset) => ({
            assetCode: asset.assetCode,
            kind: asset.kind,
            locale: asset.locale,
            url: asset.url,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            durationSeconds: asset.durationSeconds,
            checksum: asset.checksum,
            sortOrder: asset.sortOrder,
          })),
        }
      : null,
    assessment: level.assessment
      ? {
          versionNumber: level.assessment.versionNumber,
          revision: level.assessment.revision,
          passPercent: level.assessment.passPercent,
          maxAttempts: level.assessment.maxAttempts,
          showExplanation: level.assessment.showExplanation,
          sourceProvenance: level.assessment.sourceProvenance,
          sourceApproval: level.assessment.sourceApproval,
          // Bound into the bundle fingerprint on purpose: two bundles that
          // differ only in which authority won are DIFFERENT handoffs.
          sourceAuthority: level.assessment.sourceAuthority
            ? {
                state: level.assessment.sourceAuthority.state,
                rawConflictCount: level.assessment.sourceAuthority.rawConflictCount,
                resolvedConflictCount: level.assessment.sourceAuthority.resolvedConflictCount,
                blockingConflictCount: level.assessment.sourceAuthority.blockingConflictCount,
                resolutionFingerprint: level.assessment.sourceAuthority.resolutionFingerprint,
                // PHASE-G2 SUCCESSOR — bound into the bundle fingerprint for the
                // same reason the line above says: two bundles whose authority
                // was REACHED differently are different handoffs, even when the
                // decision that was reached is identical.
                authorityLineageFingerprint:
                  level.assessment.sourceAuthority.authorityLineageFingerprint,
                inheritedDecisionCount: level.assessment.sourceAuthority.inheritedDecisionCount,
                // REVIEW-SURFACE CORRECTION — `linkOrigin` and `linkLineageDepth`
                // are DELIBERATELY ABSENT from this projection while being present
                // on the emitted bundle.
                //
                // This function is the bundle FINGERPRINT, and adding a field to
                // it moves the recorded fingerprint of every bundle ever produced.
                // The two are descriptive of where the decisions above came from,
                // and `authorityLineageFingerprint` already binds the origin
                // version and depth of every decision — so the identity they would
                // contribute is bound here twice over, and paying for it with a
                // corpus-wide fingerprint change would be an unforced semantic
                // break for an observability field.
                decisions: [...level.assessment.sourceAuthority.decisions]
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map((decision) => ({
                    path: decision.path,
                    decision: decision.decision,
                    application: decision.application,
                    decidedById: decision.decidedById,
                    decidedAt: decision.decidedAt,
                    evidenceRef: decision.evidenceRef,
                    evidenceSha256: decision.evidenceSha256,
                    blueprintSourceDocumentSha256: decision.blueprintSourceDocumentSha256,
                    inherited: decision.inherited,
                    originAssessmentVersionId: decision.originAssessmentVersionId,
                    inheritanceDepth: decision.inheritanceDepth,
                  })),
              }
            : null,
          questions: level.assessment.questions.map((question) => ({
            questionNumber: question.questionNumber,
            stableKey: question.stableKey,
            type: question.type,
            skillTag: question.skillTag,
            options: canonicalJson(question.options),
            correctAnswer: canonicalJson(question.correctAnswer),
            localizations: question.localizations.map((localization) => ({
              locale: localization.locale,
              prompt: localization.prompt,
              optionLabels: canonicalJson(localization.optionLabels),
              explanation: localization.explanation,
            })),
          })),
        }
      : null,
    production: level.production
      ? {
          versionNumber: level.production.versionNumber,
          revision: level.production.revision,
          contractPayload: canonicalJson(level.production.contractPayload),
        }
      : null,
  };
}

export function fingerprintHandoffBundle(bundle: Omit<HandoffBundle, "fingerprint">): string {
  const projection: Json = {
    schema: bundle.schema,
    bundleFormatVersion: bundle.bundleFormatVersion,
    curriculumVersionCode: bundle.curriculumVersionCode,
    curriculumVersionNumber: bundle.curriculumVersionNumber,
    locale: bundle.locale,
    scope: bundle.scope,
    requestedLevelNumbers: [...bundle.requestedLevelNumbers].sort((a, b) => a - b),
    levels: [...bundle.levels]
      .sort((a, b) => a.levelNumber - b.levelNumber)
      .map(projectLevel),
    excluded: [...bundle.excluded]
      .sort((a, b) => a.levelNumber - b.levelNumber)
      .map((exclusion) => ({
        levelNumber: exclusion.levelNumber,
        stableCode: exclusion.stableCode,
        blockers: [...exclusion.blockers].sort(),
      })),
  };
  return createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

export type BuildHandoffInput = {
  curriculumVersionId: number;
  /** Omit for the whole curriculum version. */
  levelNumbers?: readonly number[];
  /** Recorded in the audit row. Pass null for the CLI, which has no HTTP actor. */
  actorId: number | null;
};

/**
 * Build a bundle, or refuse and say exactly why.
 *
 * Server-authoritative validation runs over every INCLUDED level before the
 * bundle is produced, using `validateLevelAuthoring` — the same validator the
 * Studio's «Проверить» calls and the same one approval consults. A level that is
 * approved but no longer validates (its assets moved, a tool code was retired)
 * is refused rather than shipped: approval is evidence about a moment, and the
 * handoff is about now.
 */
export async function buildHandoffBundle(input: BuildHandoffInput): Promise<HandoffBundle> {
  const version = await prisma.curriculumVersion.findUnique({
    where: { id: input.curriculumVersionId },
    select: { id: true, code: true, versionNumber: true },
  });
  if (!version) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `CurriculumVersion ${input.curriculumVersionId} does not exist`,
    );
  }

  const overview = await readAuthoringOverview(input.curriculumVersionId);
  const requested =
    input.levelNumbers === undefined
      ? overview.map((level) => level.levelNumber)
      : [...new Set(input.levelNumbers)].sort((a, b) => a - b);

  const byNumber = new Map(overview.map((level) => [level.levelNumber, level] as const));
  for (const levelNumber of requested) {
    if (!byNumber.has(levelNumber)) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `curriculum version ${version.code} has no level ${levelNumber}`,
      );
    }
  }

  const scope: HandoffBundle["scope"] = input.levelNumbers === undefined ? "all" : "levels";
  const included: HandoffLevel[] = [];
  const excluded: HandoffExclusion[] = [];

  for (const levelNumber of requested) {
    const summary = byNumber.get(levelNumber)!;
    const status = levelHandoffStatus(summary);

    if (!status.ready) {
      // An EXPLICITLY requested level that is not ready is a refusal, not an
      // exclusion: the caller asked for it by number and silently returning a
      // bundle without it is how a partial handoff gets shipped believing it is
      // complete. A whole-version request excludes and reports instead, because
      // "give me everything that is ready" is a legitimate question.
      if (scope === "levels") {
        throw new AuthoringDomainError(
          "AUTHORING_HANDOFF_BLOCKED",
          `level ${levelNumber} is not ready for package handoff`,
          {
            issues: status.blockers.map((code) => ({
              code,
              path: `levels[${levelNumber}]`,
              message: `level ${levelNumber}: ${code}`,
            })),
          },
        );
      }
      excluded.push({
        levelNumber,
        stableCode: summary.stableCode,
        blockers: status.blockers,
      });
      continue;
    }

    const validation = await validateLevelAuthoring({
      curriculumVersionId: input.curriculumVersionId,
      levelDefinitionId: summary.levelDefinitionId,
    });
    if (validation && !validation.ok) {
      throw new AuthoringDomainError(
        "AUTHORING_HANDOFF_INVALID",
        `level ${levelNumber} is approved but no longer passes server validation`,
        { issues: validation.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) },
      );
    }

    included.push(await projectLevelFromDatabase(summary.levelDefinitionId, levelNumber, summary.stableCode));
  }

  included.sort((a, b) => a.levelNumber - b.levelNumber);
  excluded.sort((a, b) => a.levelNumber - b.levelNumber);

  /**
   * PHASE-G1 CORRECTION — a WHOLE-CURRICULUM request is all-or-nothing.
   *
   * It previously excluded whatever was not ready and returned a bundle anyway.
   * That is the "ready-only, silently skip the rest" mode: the artefact is named
   * after the curriculum, carries a fingerprint, and quietly omits 78 of 100
   * levels — and an engineer downstream has no way to tell a complete handoff
   * from a partial one without re-deriving readiness themselves.
   *
   * "Give me the whole curriculum" is now answered honestly: on an incomplete
   * backlog it is REFUSED, with every level and every blocker named, and the
   * Studio shows those reasons instead of offering a button that throws. An
   * editor who wants the part that IS finished asks for it by number, which is
   * an explicit, auditable scope rather than a silent one.
   */
  if (scope === "all" && excluded.length > 0) {
    throw new AuthoringDomainError(
      "AUTHORING_HANDOFF_BLOCKED",
      `${excluded.length} of ${requested.length} levels are not ready for package handoff`,
      {
        issues: excluded.flatMap((entry) =>
          entry.blockers.map((code) => ({
            code,
            path: `levels[${entry.levelNumber}]`,
            message: `level ${entry.levelNumber}: ${code}`,
          })),
        ),
      },
    );
  }

  const draft: Omit<HandoffBundle, "fingerprint"> = {
    schema: HANDOFF_BUNDLE_SCHEMA,
    bundleFormatVersion: 1,
    curriculumVersionCode: version.code,
    curriculumVersionNumber: version.versionNumber,
    locale: AUTHORING_LOCALE,
    scope,
    requestedLevelNumbers: requested,
    levels: included,
    excluded,
    counts: {
      requested: requested.length,
      included: included.length,
      excluded: excluded.length,
      contentVersions: included.filter((level) => level.content !== null).length,
      assessmentVersions: included.filter((level) => level.assessment !== null).length,
      productionVersions: included.filter((level) => level.production !== null).length,
    },
  };

  const bundle: HandoffBundle = { ...draft, fingerprint: fingerprintHandoffBundle(draft) };

  if (input.actorId !== null) {
    await prisma.auditLog.create({
      data: {
        userId: input.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringHandoffBundleGenerated,
        entityType: "CurriculumVersion",
        entityId: String(version.id),
        metadata: {
          fingerprint: bundle.fingerprint,
          scope: bundle.scope,
          included: bundle.counts.included,
          excluded: bundle.counts.excluded,
          // Stated in the trail so no later reader can mistake this row for a
          // publication.
          publication: "none",
        },
      },
    });
  }

  return bundle;
}

/**
 * Load exactly the APPROVED versions of one level.
 *
 * Ambiguity is refused here rather than resolved. Two approved content versions
 * on one level is a state the platform can reach (approve v3, then clone and
 * approve v4 without archiving v3) and there is no non-arbitrary answer to which
 * one ships.
 */
async function projectLevelFromDatabase(
  levelDefinitionId: number,
  levelNumber: number,
  stableCode: string,
): Promise<HandoffLevel> {
  const [contentVersions, assessmentVersions, productionVersions] = await Promise.all([
    prisma.contentVersion.findMany({
      where: { levelDefinitionId, editorialState: "approved" },
      orderBy: { versionNumber: "asc" },
      select: {
        versionNumber: true,
        revision: true,
        localizations: {
          where: { locale: AUTHORING_LOCALE },
          select: {
            locale: true,
            title: true,
            subtitle: true,
            learningObjectiveExtension: true,
            summary: true,
            transcript: true,
            body: true,
          },
        },
        assets: {
          orderBy: [{ assetCode: "asc" }],
          select: {
            assetCode: true,
            kind: true,
            locale: true,
            url: true,
            mimeType: true,
            sizeBytes: true,
            durationSeconds: true,
            checksum: true,
            sortOrder: true,
          },
        },
      },
    }),
    prisma.assessmentVersion.findMany({
      where: { levelDefinitionId, editorialState: "approved" },
      orderBy: { versionNumber: "asc" },
      select: {
        id: true,
        versionNumber: true,
        revision: true,
        passPercent: true,
        maxAttempts: true,
        showExplanation: true,
        questions: {
          orderBy: { questionNumber: "asc" },
          select: {
            questionNumber: true,
            stableKey: true,
            type: true,
            skillTag: true,
            options: true,
            correctAnswer: true,
            localizations: {
              orderBy: { locale: "asc" },
              select: { locale: true, prompt: true, optionLabels: true, explanation: true },
            },
          },
        },
      },
    }),
    prisma.videoProductionVersion.findMany({
      where: { levelDefinitionId, editorialState: "approved" },
      orderBy: { versionNumber: "asc" },
      select: {
        id: true,
        versionNumber: true,
        revision: true,
        sourceProvenance: true,
        contractPayload: true,
      },
    }),
  ]);

  const one = <T>(rows: readonly T[], what: string): T | null => {
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new AuthoringDomainError(
        "AUTHORING_HANDOFF_AMBIGUOUS",
        `level ${levelNumber} has ${rows.length} approved ${what} versions — archive all but one before handoff`,
      );
    }
    return rows[0];
  };

  const contentRow = one(contentVersions, "content");
  const assessmentRow = one(assessmentVersions, "assessment");
  const productionRow = one(productionVersions, "production");

  // PHASE-G2 — the authority lineage for this bank, read from the durable
  // adjudication record. Null when there is nothing to say: no bank, or a bank
  // that never had a proposal to disagree with.
  let sourceAuthority: NonNullable<HandoffLevel["assessment"]>["sourceAuthority"] = null;
  if (assessmentRow) {
    // THE CONTRACT COMES FROM THE DURABLE LINK, NOT FROM `productionRow`.
    // `productionRow` is the APPROVED video production version, and a bank can
    // be adjudicated and approved long before its video contract is. Reading the
    // proposal from an approved-only row would find nothing for every level
    // whose video is still a draft and report every decision as stale — which is
    // exactly backwards, because the decision was made against the LINKED
    // contract and that link is what pins the two sides together.
    //
    // CORRECTION-1 (audit MEDIUM-2) / CORRECTION-2 (re-audit HIGH-1) — through
    // the ONE shared source resolver every authority reader uses, not through
    // `findFirst` and not through a private copy of the rule. A bank may carry
    // several links, and the bundle must describe the same proposal the
    // adjudication command bound its decisions to.
    const source = await resolveAuthoritySource(prisma, assessmentRow.id);
    if (source.unavailableReason !== null) {
      // CORRECTION-2 — a bundle is a claim that the lineage was checked. With no
      // readable source there is nothing to check, so the handoff refuses rather
      // than emitting a level whose `sourceAuthority` is silently absent.
      // Readiness already blocks this level; this is the second door.
      throw new AuthoringDomainError(
        source.unavailableReason === "SOURCE_LINK_INCOMPATIBLE"
          ? "AUTHORING_ASSESSMENT_LINK_INVALID"
          : "AUTHORING_SOURCE_CONTRACT_UNREADABLE",
        `level ${levelNumber}: the canonical Blueprint source for this bank cannot be established (${source.unavailableReason}), so its authority lineage cannot be proven`,
      );
    }
    const contract = source.contract;
    const projection = await readSourceAuthority(prisma, {
      assessmentVersionId: assessmentRow.id,
      videoProductionVersionId: source.videoProductionVersionId,
      contract,
      sourceLinked: source.link !== null,
    });
    if (projection.decisions.length > 0 || projection.rawConflictCount > 0) {
      sourceAuthority = {
        state: projection.state,
        rawConflictCount: projection.rawConflictCount,
        resolvedConflictCount: projection.resolvedConflictCount,
        blockingConflictCount: projection.blockingConflictCount,
        resolutionFingerprint: projection.resolutionFingerprint,
        authorityLineageFingerprint: projection.authorityLineageFingerprint,
        inheritedDecisionCount: projection.inheritedDecisionCount,
        linkOrigin: source.linkOrigin,
        linkLineageDepth: source.linkLineageDepth,
        decisions: projection.decisions.map((decision) => ({
          path: decision.path,
          decision: decision.decision,
          application: decision.application,
          decidedById: decision.decidedById,
          decidedAt: decision.decidedAt,
          evidenceRef: decision.evidenceRef,
          evidenceSha256: decision.evidenceSha256,
          blueprintSourceDocumentSha256: decision.blueprintSourceDocumentSha256,
          inherited: decision.inherited,
          originAssessmentVersionId: decision.originAssessmentVersionId,
          inheritanceDepth: decision.inheritanceDepth,
        })),
      };
    }
  }

  const localization = contentRow?.localizations[0] ?? null;
  if (contentRow && !localization) {
    throw new AuthoringDomainError(
      "AUTHORING_HANDOFF_INVALID",
      `level ${levelNumber} has an approved content version with no "${AUTHORING_LOCALE}" localization`,
    );
  }

  return {
    levelNumber,
    stableCode,
    content:
      contentRow && localization
        ? {
            versionNumber: contentRow.versionNumber,
            revision: contentRow.revision,
            locale: localization.locale,
            title: localization.title,
            subtitle: localization.subtitle,
            learningObjectiveExtension: localization.learningObjectiveExtension,
            summary: localization.summary,
            transcript: localization.transcript,
            body: canonicalJson(localization.body),
            assets: contentRow.assets,
          }
        : null,
    assessment: assessmentRow
      ? {
          versionNumber: assessmentRow.versionNumber,
          revision: assessmentRow.revision,
          passPercent: assessmentRow.passPercent,
          maxAttempts: assessmentRow.maxAttempts,
          showExplanation: assessmentRow.showExplanation,
          // Provenance travels with the bank so L18's SOURCE_BACKED /
          // AWAITING_APPROVAL remains readable downstream instead of being
          // flattened into "approved".
          sourceProvenance: productionRow?.sourceProvenance ?? null,
          sourceApproval: readContractApproval(productionRow?.contractPayload),
          sourceAuthority,
          questions: assessmentRow.questions.map((question) => ({
            questionNumber: question.questionNumber,
            stableKey: question.stableKey,
            type: question.type,
            skillTag: question.skillTag,
            options: canonicalJson(question.options),
            correctAnswer: canonicalJson(question.correctAnswer),
            localizations: question.localizations.map((localizationRow) => ({
              locale: localizationRow.locale,
              prompt: localizationRow.prompt,
              optionLabels: canonicalJson(localizationRow.optionLabels),
              explanation: localizationRow.explanation,
            })),
          })),
        }
      : null,
    production: productionRow
      ? {
          versionNumber: productionRow.versionNumber,
          revision: productionRow.revision,
          contractPayload: canonicalJson(productionRow.contractPayload),
        }
      : null,
  };
}

function readContractApproval(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const approval = (payload as { approval?: unknown }).approval;
  return typeof approval === "string" ? approval : null;
}
