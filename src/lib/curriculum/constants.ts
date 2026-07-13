// Approved stable code format (V2_PRODUCT_DECISIONS.md §8):
// v2.lNNN.<lowercase-kebab-slug>, NNN is always three digits and must match levelNumber.
export const STABLE_CODE_PATTERN = /^v2\.l(\d{3})\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CURRICULUM_AUDIT_ACTIONS = {
  published: "CURRICULUM_VERSION_PUBLISHED",
  replaced: "CURRICULUM_VERSION_REPLACED",
  archived: "CURRICULUM_VERSION_ARCHIVED",
  publicationRejected: "CURRICULUM_PUBLICATION_REJECTED",
} as const;
