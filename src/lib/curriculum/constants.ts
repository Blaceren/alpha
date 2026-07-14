// Approved stable code format (V2_PRODUCT_DECISIONS.md §8):
// v2.lNNN.<lowercase-kebab-slug>, NNN is always three digits and must match levelNumber.
export const STABLE_CODE_PATTERN = /^v2\.l(\d{3})\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_CURRICULUM_CODE = "ata-v2" as const;

export const CURRICULUM_AUDIT_ACTIONS = {
  published: "CURRICULUM_VERSION_PUBLISHED",
  replaced: "CURRICULUM_VERSION_REPLACED",
  archived: "CURRICULUM_VERSION_ARCHIVED",
  publicationRejected: "CURRICULUM_PUBLICATION_REJECTED",
  draftCreated: "CURRICULUM_DRAFT_CREATED",
  draftUpdated: "CURRICULUM_DRAFT_UPDATED",
  draftDeleted: "CURRICULUM_DRAFT_DELETED",
  moduleCreated: "MODULE_DEFINITION_CREATED",
  moduleUpdated: "MODULE_DEFINITION_UPDATED",
  moduleDeleted: "MODULE_DEFINITION_DELETED",
  levelCreated: "LEVEL_DEFINITION_CREATED",
  levelUpdated: "LEVEL_DEFINITION_UPDATED",
  levelDeleted: "LEVEL_DEFINITION_DELETED",
  userEnrolled: "CURRICULUM_USER_ENROLLED",
  levelStarted: "CURRICULUM_LEVEL_STARTED",
  xpAwarded: "CURRICULUM_XP_AWARDED",
} as const;
