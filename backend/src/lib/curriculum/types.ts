import type {
  CurriculumVersion,
  LevelDefinition,
  ModuleDefinition,
} from "@prisma/client";

export type CurriculumDraftSnapshot = {
  version: CurriculumVersion;
  modules: ModuleDefinition[];
  levels: LevelDefinition[];
};

export type CurriculumValidationIssue = {
  code: string;
  entity: "curriculumVersion" | "module" | "level";
  reference: string;
  message: string;
};

export type CurriculumValidationResult = {
  valid: boolean;
  issues: CurriculumValidationIssue[];
};

export type PublishCurriculumInput = {
  curriculumVersionId: number;
  actorId: number;
  expectedPublishedVersionId?: number | null;
};

export type PublishCurriculumResult = {
  published: CurriculumVersion;
  replaced: CurriculumVersion | null;
};

export type ArchiveCurriculumInput = {
  curriculumVersionId: number;
  actorId: number;
};
