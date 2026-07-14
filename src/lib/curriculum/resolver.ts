import type {
  CurriculumVersion,
  LevelDefinition,
  ModuleDefinition,
  Prisma,
  PrismaClient,
  UserCurriculumEnrollment,
  UserLevelProgress,
} from "@prisma/client";
import { isCurriculumV2ReadEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CURRICULUM_CODE } from "./constants";

export type CurriculumResolverDb = Pick<
  PrismaClient,
  "curriculumVersion" | "user" | "userCurriculumEnrollment"
>;

type CurriculumVersionGraph = Prisma.CurriculumVersionGetPayload<{
  include: { modules: true; levels: true };
}>;

export type EnrollmentResolutionGraph = Prisma.UserCurriculumEnrollmentGetPayload<{
  include: {
    curriculumVersion: { include: { modules: true; levels: true } };
    levelProgress: { include: { levelDefinition: true } };
  };
}>;

export type ResolvedProgress = UserLevelProgress & {
  levelDefinition: LevelDefinition;
};

export type SafeResolverDiagnostics = Record<
  string,
  string | number | boolean | null | number[]
>;

export type CurriculumCorruptReason =
  | "published_without_published_at"
  | "duplicate_published_version"
  | "invalid_curriculum_graph"
  | "code_mismatch"
  | "duplicate_active_enrollment"
  | "draft_pinned_version"
  | "invalid_enrollment_state"
  | "invalid_progress_state"
  | "superseded_without_replacement";

export type CurriculumCorruptResult = {
  kind: "corrupt";
  reason: CurriculumCorruptReason;
  diagnostics: SafeResolverDiagnostics;
};

export type CurriculumUnavailableResult = {
  kind: "unavailable";
  reason: "no_published_version" | "not_effective_yet";
};

export type PublishedCurriculumResult =
  | { kind: "disabled" }
  | {
      kind: "available";
      curriculumVersion: CurriculumVersion;
      modules: ModuleDefinition[];
      levels: LevelDefinition[];
    }
  | CurriculumUnavailableResult
  | CurriculumCorruptResult;

type ResolvedPinnedContext = {
  userId: number;
  enrollment: UserCurriculumEnrollment;
  curriculumVersion: CurriculumVersion;
  modules: ModuleDefinition[];
  levels: LevelDefinition[];
  progress: ResolvedProgress[];
};

export type UserCurriculumContextResult =
  | { kind: "disabled" }
  | { kind: "user_not_found" }
  | ({ kind: "enrolled" } & ResolvedPinnedContext)
  | ({ kind: "completed" } & ResolvedPinnedContext)
  | {
      kind: "candidate";
      userId: number;
      curriculumVersion: CurriculumVersion;
      modules: ModuleDefinition[];
      levels: LevelDefinition[];
    }
  | CurriculumUnavailableResult
  | CurriculumCorruptResult;

export type ResolvePublishedCurriculumInput = {
  curriculumCode?: string;
  asOf?: Date;
  db?: CurriculumResolverDb;
};

export type ResolveUserCurriculumContextInput = ResolvePublishedCurriculumInput & {
  userId: number;
};

const PERSISTED_PROGRESS_STATUSES = new Set([
  "in_progress",
  "pending_review",
  "completed",
]);

function corrupt(
  reason: CurriculumCorruptReason,
  diagnostics: SafeResolverDiagnostics,
): CurriculumCorruptResult {
  return { kind: "corrupt", reason, diagnostics };
}

function sortModules(modules: ModuleDefinition[]) {
  return [...modules].sort(
    (left, right) => left.moduleNumber - right.moduleNumber || left.id - right.id,
  );
}

function sortLevels(levels: LevelDefinition[]) {
  return [...levels].sort(
    (left, right) => left.levelNumber - right.levelNumber || left.id - right.id,
  );
}

function validateCurriculumGraph(
  snapshot: CurriculumVersionGraph,
  expectedCode: string,
): CurriculumCorruptResult | null {
  if (snapshot.code !== expectedCode) {
    return corrupt("code_mismatch", {
      expectedCode,
      actualCode: snapshot.code,
      versionId: snapshot.id,
    });
  }

  const moduleIds = new Set<number>();
  for (const moduleDefinition of snapshot.modules) {
    if (moduleDefinition.curriculumVersionId !== snapshot.id) {
      return corrupt("invalid_curriculum_graph", {
        versionId: snapshot.id,
        issue: "module_version_mismatch",
        moduleId: moduleDefinition.id,
      });
    }
    moduleIds.add(moduleDefinition.id);
  }

  for (const level of snapshot.levels) {
    if (
      level.curriculumVersionId !== snapshot.id ||
      !moduleIds.has(level.moduleId)
    ) {
      return corrupt("invalid_curriculum_graph", {
        versionId: snapshot.id,
        issue: "level_version_or_module_mismatch",
        levelId: level.id,
      });
    }
  }

  if (snapshot.status === "published") {
    const disabledModule = snapshot.modules.find(
      (moduleDefinition) => moduleDefinition.status === "disabled",
    );
    const disabledLevel = snapshot.levels.find((level) => level.status === "disabled");
    if (disabledModule || disabledLevel) {
      return corrupt("invalid_curriculum_graph", {
        versionId: snapshot.id,
        issue: "published_graph_contains_disabled_definition",
        definitionId: disabledModule?.id ?? disabledLevel?.id ?? null,
      });
    }
  }

  return null;
}

export function validatePinnedEnrollmentSnapshot(
  snapshot: EnrollmentResolutionGraph,
  expectedCode: string = DEFAULT_CURRICULUM_CODE,
): CurriculumCorruptResult | null {
  const { curriculumVersion, levelProgress } = snapshot;

  if (
    snapshot.curriculumCode !== expectedCode ||
    curriculumVersion.code !== expectedCode
  ) {
    return corrupt("code_mismatch", {
      expectedCode,
      enrollmentCode: snapshot.curriculumCode,
      versionCode: curriculumVersion.code,
      enrollmentId: snapshot.id,
      versionId: curriculumVersion.id,
    });
  }

  if (snapshot.curriculumVersionId !== curriculumVersion.id) {
    return corrupt("invalid_enrollment_state", {
      enrollmentId: snapshot.id,
      issue: "enrollment_version_mismatch",
      enrollmentVersionId: snapshot.curriculumVersionId,
      versionId: curriculumVersion.id,
    });
  }

  if (curriculumVersion.status === "draft") {
    return corrupt("draft_pinned_version", {
      enrollmentId: snapshot.id,
      versionId: curriculumVersion.id,
    });
  }

  if (curriculumVersion.status === "published" && !curriculumVersion.publishedAt) {
    return corrupt("published_without_published_at", {
      versionId: curriculumVersion.id,
      curriculumCode: expectedCode,
    });
  }

  const graphIssue = validateCurriculumGraph(curriculumVersion, expectedCode);
  if (graphIssue) return graphIssue;

  if (snapshot.status === "active" && snapshot.completedAt) {
    return corrupt("invalid_enrollment_state", {
      enrollmentId: snapshot.id,
      issue: "active_with_completed_at",
    });
  }

  if (snapshot.status === "completed" && !snapshot.completedAt) {
    return corrupt("invalid_enrollment_state", {
      enrollmentId: snapshot.id,
      issue: "completed_without_completed_at",
    });
  }

  const maxLevel = curriculumVersion.levels.reduce(
    (maximum, level) => Math.max(maximum, level.levelNumber),
    0,
  );
  if (
    snapshot.highestCompletedLevel < 0 ||
    snapshot.currentLevel < 1 ||
    snapshot.highestCompletedLevel > maxLevel ||
    snapshot.currentLevel > maxLevel + 1
  ) {
    return corrupt("invalid_enrollment_state", {
      enrollmentId: snapshot.id,
      issue: "invalid_level_summary",
      highestCompletedLevel: snapshot.highestCompletedLevel,
      currentLevel: snapshot.currentLevel,
      maxLevel,
    });
  }

  const levelIds = new Set(curriculumVersion.levels.map((level) => level.id));
  for (const progress of levelProgress) {
    const level = progress.levelDefinition as LevelDefinition | null;
    if (
      progress.enrollmentId !== snapshot.id ||
      progress.curriculumVersionId !== snapshot.curriculumVersionId ||
      !level ||
      progress.levelDefinitionId !== level.id ||
      level.curriculumVersionId !== snapshot.curriculumVersionId ||
      !levelIds.has(level.id)
    ) {
      return corrupt("invalid_progress_state", {
        enrollmentId: snapshot.id,
        progressId: progress.id,
        issue: "cross_version_or_unknown_level",
      });
    }

    if (!PERSISTED_PROGRESS_STATUSES.has(String(progress.status))) {
      return corrupt("invalid_progress_state", {
        enrollmentId: snapshot.id,
        progressId: progress.id,
        issue: "unknown_persisted_status",
      });
    }
  }

  return null;
}

function toPublishedAvailable(
  snapshot: CurriculumVersionGraph,
): Extract<PublishedCurriculumResult, { kind: "available" }> {
  const { modules, levels, ...curriculumVersion } = snapshot;
  return {
    kind: "available",
    curriculumVersion,
    modules: sortModules(modules),
    levels: sortLevels(levels),
  };
}

export async function resolvePublishedCurriculum({
  curriculumCode = DEFAULT_CURRICULUM_CODE,
  asOf = new Date(),
  db = prisma,
}: ResolvePublishedCurriculumInput = {}): Promise<PublishedCurriculumResult> {
  if (!isCurriculumV2ReadEnabled()) return { kind: "disabled" };

  const published = await db.curriculumVersion.findMany({
    where: { code: curriculumCode, status: "published" },
    include: { modules: true, levels: true },
    orderBy: [
      { versionNumber: "desc" },
      { publishedAt: "desc" },
      { id: "desc" },
    ],
    take: 2,
  });

  if (published.length === 0) {
    return { kind: "unavailable", reason: "no_published_version" };
  }

  if (published.length > 1) {
    return corrupt("duplicate_published_version", {
      curriculumCode,
      count: published.length,
      versionIds: published.map((version) => version.id),
    });
  }

  const snapshot = published[0];
  if (!snapshot.publishedAt) {
    return corrupt("published_without_published_at", {
      curriculumCode,
      versionId: snapshot.id,
    });
  }

  const graphIssue = validateCurriculumGraph(snapshot, curriculumCode);
  if (graphIssue) return graphIssue;

  if (
    snapshot.publishedAt.getTime() > asOf.getTime() ||
    (snapshot.effectiveFrom && snapshot.effectiveFrom.getTime() > asOf.getTime())
  ) {
    return { kind: "unavailable", reason: "not_effective_yet" };
  }

  return toPublishedAvailable(snapshot);
}

function toPinnedResult(
  kind: "enrolled" | "completed",
  userId: number,
  snapshot: EnrollmentResolutionGraph,
  curriculumCode: string,
): UserCurriculumContextResult {
  const validation = validatePinnedEnrollmentSnapshot(snapshot, curriculumCode);
  if (validation) return validation;

  const { curriculumVersion, levelProgress, ...enrollment } = snapshot;
  const { modules, levels, ...version } = curriculumVersion;
  const progress = [...levelProgress].sort(
    (left, right) =>
      left.levelDefinition.levelNumber - right.levelDefinition.levelNumber ||
      left.id - right.id,
  );

  return {
    kind,
    userId,
    enrollment,
    curriculumVersion: version,
    modules: sortModules(modules),
    levels: sortLevels(levels),
    progress,
  };
}

function isNewerEnrollment(
  candidate: EnrollmentResolutionGraph,
  reference: EnrollmentResolutionGraph,
) {
  const timeDelta = candidate.enrolledAt.getTime() - reference.enrolledAt.getTime();
  return timeDelta > 0 || (timeDelta === 0 && candidate.id > reference.id);
}

export async function resolveUserCurriculumContext({
  userId,
  curriculumCode = DEFAULT_CURRICULUM_CODE,
  asOf = new Date(),
  db = prisma,
}: ResolveUserCurriculumContextInput): Promise<UserCurriculumContextResult> {
  if (!isCurriculumV2ReadEnabled()) return { kind: "disabled" };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { kind: "user_not_found" };

  const enrollments = await db.userCurriculumEnrollment.findMany({
    where: { userId, curriculumCode },
    include: {
      curriculumVersion: { include: { modules: true, levels: true } },
      levelProgress: { include: { levelDefinition: true } },
    },
    orderBy: [{ enrolledAt: "desc" }, { id: "desc" }],
  });

  const active = enrollments.filter((enrollment) => enrollment.status === "active");
  if (active.length > 1) {
    return corrupt("duplicate_active_enrollment", {
      userId,
      curriculumCode,
      count: active.length,
      enrollmentIds: active.map((enrollment) => enrollment.id),
    });
  }
  if (active.length === 1) {
    return toPinnedResult("enrolled", user.id, active[0], curriculumCode);
  }

  const latest = enrollments[0];
  if (latest?.status === "completed") {
    return toPinnedResult("completed", user.id, latest, curriculumCode);
  }

  if (latest?.status === "superseded") {
    const completedReplacement = enrollments.find(
      (enrollment) =>
        enrollment.status === "completed" && isNewerEnrollment(enrollment, latest),
    );
    if (completedReplacement) {
      return toPinnedResult(
        "completed",
        user.id,
        completedReplacement,
        curriculumCode,
      );
    }
    return corrupt("superseded_without_replacement", {
      userId,
      curriculumCode,
      enrollmentId: latest.id,
    });
  }

  if (latest) {
    return corrupt("invalid_enrollment_state", {
      userId,
      curriculumCode,
      enrollmentId: latest.id,
      issue: "unknown_enrollment_status",
    });
  }

  const published = await resolvePublishedCurriculum({ curriculumCode, asOf, db });
  if (published.kind !== "available") return published;

  return {
    kind: "candidate",
    userId: user.id,
    curriculumVersion: published.curriculumVersion,
    modules: published.modules,
    levels: published.levels,
  };
}
