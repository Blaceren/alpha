import { z } from "zod";
import { CurriculumDomainError } from "@/lib/curriculum/errors";
import { prisma } from "@/lib/prisma";

// Read-only query services for the admin curriculum API. No audit writes.

const listParamsSchema = z.object({
  status: z.enum(["draft", "published", "archived"]).optional(),
  code: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCurriculumVersionsInput = z.input<typeof listParamsSchema>;

const safeCreatedBySelect = {
  select: { id: true, name: true, email: true },
} as const;

export async function listCurriculumVersions(input: unknown) {
  const parsed = listParamsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new CurriculumDomainError(
      "CURRICULUM_INPUT_INVALID",
      "invalid list parameters",
      parsed.error.issues.map((issue) => ({
        code: "INPUT_INVALID",
        entity: "curriculumVersion" as const,
        reference: issue.path.join(".") || "query",
        message: issue.message,
      })),
    );
  }

  const { status, code, page, limit } = parsed.data;
  const where = {
    ...(status ? { status } : {}),
    ...(code ? { code } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.curriculumVersion.count({ where }),
    prisma.curriculumVersion.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        createdBy: safeCreatedBySelect,
        _count: { select: { modules: true, levels: true } },
      },
    }),
  ]);

  const items = rows.map(({ _count, ...version }) => ({
    ...version,
    moduleCount: _count.modules,
    levelCount: _count.levels,
  }));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getCurriculumVersionDetail(curriculumVersionId: number) {
  const version = await prisma.curriculumVersion.findUnique({
    where: { id: curriculumVersionId },
    include: {
      createdBy: safeCreatedBySelect,
      modules: { orderBy: { moduleNumber: "asc" } },
      levels: { orderBy: { levelNumber: "asc" } },
    },
  });

  if (!version) {
    throw new CurriculumDomainError(
      "CURRICULUM_NOT_FOUND",
      `CurriculumVersion ${curriculumVersionId} does not exist`,
    );
  }

  return version;
}

// Path-ownership guards for module/level routes. A resource that exists but
// belongs to a different CurriculumVersion is reported as NOT_FOUND so the
// existence of another version's resource is never disclosed.
export async function assertModuleInVersion(
  moduleId: number,
  curriculumVersionId: number,
) {
  const moduleDef = await prisma.moduleDefinition.findUnique({
    where: { id: moduleId },
    select: { curriculumVersionId: true },
  });
  if (!moduleDef || moduleDef.curriculumVersionId !== curriculumVersionId) {
    throw new CurriculumDomainError(
      "MODULE_NOT_FOUND",
      `ModuleDefinition ${moduleId} not found in CurriculumVersion ${curriculumVersionId}`,
    );
  }
}

export async function assertLevelInVersion(
  levelId: number,
  curriculumVersionId: number,
) {
  const levelDef = await prisma.levelDefinition.findUnique({
    where: { id: levelId },
    select: { curriculumVersionId: true },
  });
  if (!levelDef || levelDef.curriculumVersionId !== curriculumVersionId) {
    throw new CurriculumDomainError(
      "LEVEL_NOT_FOUND",
      `LevelDefinition ${levelId} not found in CurriculumVersion ${curriculumVersionId}`,
    );
  }
}
