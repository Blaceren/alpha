import { z } from "zod";

const MAX_INT = 2_147_483_647;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_BYTES = 200 * 1024;
const SAFE_MARKDOWN_LINK = /\]\((?!https:\/\/)[^)]+\)/i;
const UNSAFE_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;
const STABLE_CONTENT_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NORMALIZED_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function safeText(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .max(max, `${label} is too long`)
    .refine(
      (value) => !UNSAFE_TEXT.test(value) && !SAFE_MARKDOWN_LINK.test(value),
      `${label} contains unsafe HTML, URI, or markdown link content`,
    );
}

function optionalSafeText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .refine(
      (value) => value.length === 0 || (!UNSAFE_TEXT.test(value) && !SAFE_MARKDOWN_LINK.test(value)),
      `${label} contains unsafe HTML, URI, or markdown link content`,
    );
}

export const normalizedLocaleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(35)
  .regex(NORMALIZED_LOCALE, "locale must be a normalized BCP-47 language tag");

const bodyText = (label: string) => safeText(8_000, label);
const bodyTitle = (label: string) => safeText(300, label);

export const contentBodySchema = z
  .strictObject({
    sections: z
      .array(
        z.strictObject({
          code: z.string().trim().max(64).regex(STABLE_CONTENT_CODE),
          title: bodyTitle("section title"),
          body: bodyText("section body"),
        }),
      )
      .max(30)
      .superRefine((sections, context) => {
        const seen = new Set<string>();
        sections.forEach((section, index) => {
          if (seen.has(section.code)) {
            context.addIssue({
              code: "custom",
              path: [index, "code"],
              message: "section code must be unique within the localization",
            });
          }
          seen.add(section.code);
        });
      }),
    examples: z
      .array(z.strictObject({ title: bodyTitle("example title"), body: bodyText("example body") }))
      .max(50),
    commonMistakes: z
      .array(
        z.strictObject({
          mistake: bodyText("common mistake"),
          correction: bodyText("common mistake correction"),
        }),
      )
      .max(50),
    glossary: z
      .array(
        z.strictObject({
          term: bodyTitle("glossary term"),
          definition: bodyText("glossary definition"),
        }),
      )
      .max(50),
    nextAction: z.strictObject({
      label: bodyTitle("next action label"),
      body: bodyText("next action body"),
    }),
    riskDisclaimer: bodyText("risk disclaimer"),
  })
  .refine(
    (value) => byteLength(JSON.stringify(value)) <= MAX_BODY_BYTES,
    `content body must not exceed ${MAX_BODY_BYTES} UTF-8 bytes`,
  );

const actorId = z.number().int().positive().max(MAX_INT);
const entityId = z.number().int().positive().max(MAX_INT);
const positiveDuration = z.number().int().positive().max(MAX_INT);
const changeNotes = z.string().trim().max(4_000).nullable();

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
  patch: contentVersionPatch,
});

export const deleteContentVersionSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
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
      (value) => value.length === 0 || (!UNSAFE_TEXT.test(value) && !SAFE_MARKDOWN_LINK.test(value)),
      "transcript contains unsafe HTML, URI, or markdown link content",
    )
    .nullable(),
  body: contentBodySchema,
} as const;

export const contentLocalizationPayloadSchema = z.strictObject(localizationFields);

export const createContentLocalizationSchema = z.strictObject({
  actorId,
  contentVersionId: entityId,
  ...localizationFields,
});

export const updateContentLocalizationSchema = z.strictObject({
  actorId,
  contentLocalizationId: entityId,
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
  ...assetFields,
});

export const updateContentAssetSchema = z.strictObject({
  actorId,
  contentAssetId: entityId,
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
