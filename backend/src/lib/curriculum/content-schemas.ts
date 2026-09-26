/**
 * Authoring-command schemas for the content domain.
 *
 * PHASE-C: the two private anti-XSS regexes that used to live here are gone.
 * They are now the shared sanitizer contract in `content-safe-text.ts`, which
 * the PACKAGE path uses too — before that, the package path had no sanitization
 * at all and the two paths wrote the same column under different rules. The
 * `legacy_v1` policy passed below reproduces this file's original behaviour
 * exactly, plus the hardening documented in that module.
 *
 * The body contract likewise moved to `content-body.ts`, which accepts legacy v1
 * AND the v2 block model behind an explicit format tag.
 */
import { z } from "zod";
import { contentBodySchema } from "@/lib/curriculum/content-body";
import { expectedRevisionSchema } from "@/lib/curriculum/authoring-mutation-guard";
import {
  byteLength,
  describeUnsafeText,
  isSafeText,
  optionalSafeText as sharedOptionalSafeText,
  safeText as sharedSafeText,
} from "@/lib/curriculum/content-safe-text";

const MAX_INT = 2_147_483_647;
const MAX_TRANSCRIPT_BYTES = 200 * 1024;
const STABLE_CONTENT_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NORMALIZED_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

const safeText = (max: number, label: string) => sharedSafeText(max, label, "legacy_v1");
const optionalSafeText = (max: number, label: string) =>
  sharedOptionalSafeText(max, label, "legacy_v1");

export const normalizedLocaleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(35)
  .regex(NORMALIZED_LOCALE, "locale must be a normalized BCP-47 language tag");

export { contentBodySchema };

const actorId = z.number().int().positive().max(MAX_INT);
const entityId = z.number().int().positive().max(MAX_INT);
const positiveDuration = z.number().int().positive().max(MAX_INT);
const changeNotes = z.string().trim().max(4_000).nullable();


/**
 * PHASE-G0 CORRECTION — the mandatory aggregate revision.
 *
 * Present on every SUBSTANTIVE mutation command beneath a ContentVersion. It is
 * required, never defaulted: a command that omits it is refused by this schema
 * before any transaction opens, which is what stops a caller from falling back
 * to last-write-wins. Version CREATE is deliberately exempt — there is no
 * aggregate to be stale against until the row exists.
 */
const expectedRevision = expectedRevisionSchema;

const contentVersionPatch = z
  .strictObject({
    videoDurationSeconds: positiveDuration.nullable().optional(),
    changeNotes: changeNotes.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "patch must contain at least one field",
  });

export const createContentVersionSchema = z.strictObject({
  actorId,
  levelDefinitionId: entityId,
  videoDurationSeconds: positiveDuration.nullable().optional(),
  changeNotes: changeNotes.optional(),
});

export const updateContentVersionSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
  expectedRevision,
  patch: contentVersionPatch,
});

export const deleteContentVersionSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
  expectedRevision,
});

const localizationFields = {
  locale: normalizedLocaleSchema,
  title: safeText(300, "title"),
  subtitle: optionalSafeText(1_000, "subtitle"),
  learningObjectiveExtension: optionalSafeText(4_000, "learningObjectiveExtension"),
  summary: optionalSafeText(8_000, "summary"),
  transcript: z
    .string()
    .trim()
    .refine((value) => byteLength(value) <= MAX_TRANSCRIPT_BYTES, "transcript is too large")
    .refine(
      (value) => value.length === 0 || isSafeText(value, "legacy_v1"),
      describeUnsafeText("transcript"),
    )
    .nullable(),
  body: contentBodySchema,
} as const;

export const contentLocalizationPayloadSchema = z.strictObject(localizationFields);

export const createContentLocalizationSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
  expectedRevision,
  ...localizationFields,
});

export const updateContentLocalizationSchema = z.strictObject({
  actorId,
  contentLocalizationId: entityId,
  expectedRevision,
  patch: z
    .strictObject({
      locale: localizationFields.locale.optional(),
      title: localizationFields.title.optional(),
      subtitle: localizationFields.subtitle.optional(),
      learningObjectiveExtension: localizationFields.learningObjectiveExtension.optional(),
      summary: localizationFields.summary.optional(),
      transcript: localizationFields.transcript.optional(),
      body: localizationFields.body.optional(),
    })
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "patch must contain at least one field",
    }),
});

export const deleteContentLocalizationSchema = z.strictObject({
  actorId,
  contentLocalizationId: entityId,
  expectedRevision,
});

const assetFields = {
  kind: z.enum(["video", "subtitles", "image", "chart", "attachment"]),
  assetCode: z.string().trim().max(64).regex(STABLE_CONTENT_CODE),
  locale: normalizedLocaleSchema.nullable(),
  url: z
    .string()
    .trim()
    .max(2_048)
    .url()
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
      } catch {
        return false;
      }
    }, "asset URL must be absolute HTTPS without userinfo"),
  mimeType: z.string().trim().min(1).max(255).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
  sizeBytes: positiveDuration.nullable(),
  durationSeconds: positiveDuration.nullable(),
  checksum: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
  sortOrder: z.number().int().nonnegative().max(MAX_INT),
} as const;

export const contentAssetPayloadSchema = z.strictObject(assetFields);

export const createContentAssetSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
  expectedRevision,
  ...assetFields,
});

export const updateContentAssetSchema = z.strictObject({
  actorId,
  contentAssetId: entityId,
  expectedRevision,
  patch: z
    .strictObject({
      kind: assetFields.kind.optional(),
      assetCode: assetFields.assetCode.optional(),
      locale: assetFields.locale.optional(),
      url: assetFields.url.optional(),
      mimeType: assetFields.mimeType.optional(),
      sizeBytes: assetFields.sizeBytes.optional(),
      durationSeconds: assetFields.durationSeconds.optional(),
      checksum: assetFields.checksum.optional(),
      sortOrder: assetFields.sortOrder.optional(),
    })
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "patch must contain at least one field",
    }),
});

export const deleteContentAssetSchema = z.strictObject({
  actorId,
  contentAssetId: entityId,
  expectedRevision,
});

export const publishContentVersionSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
  expectedPublishedContentVersionId: entityId.nullable().optional(),
});

export const archiveContentVersionSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
});

export const setContentBindingSchema = z.strictObject({
  actorId,
  levelDefinitionId: entityId,
  contentVersionId: entityId,
});

export const clearContentBindingSchema = z.strictObject({
  actorId,
  levelDefinitionId: entityId,
});
