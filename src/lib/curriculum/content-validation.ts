import type { ContentAsset, ContentLocalization, ContentVersion } from "@prisma/client";
import type { z } from "zod";
import { ContentDomainError } from "@/lib/curriculum/content-errors";
import type { ContentValidationIssue } from "@/lib/curriculum/content-errors";
import {
  contentAssetPayloadSchema,
  contentLocalizationPayloadSchema,
} from "@/lib/curriculum/content-schemas";

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "correctanswer",
  "correctanswers",
  "correctoption",
  "correctoptions",
  "answerkey",
  "isCorrect".toLowerCase(),
  "__proto__",
  "prototype",
  "constructor",
]);

function zodIssues(prefix: string, error: z.ZodError): ContentValidationIssue[] {
  return error.issues.map((issue) => ({
    code: "CONTENT_FIELD_INVALID",
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }));
}

function authorityKeyIssues(value: unknown, path: string): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  const visit = (item: unknown, itemPath: string) => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${itemPath}.${index}`));
      return;
    }
    if (item === null || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (FORBIDDEN_AUTHORITY_KEYS.has(key.toLowerCase())) {
        issues.push({
          code: "CONTENT_AUTHORITY_FIELD_FORBIDDEN",
          path: `${itemPath}.${key}`,
          message: "content must not contain assessment answer authority",
        });
      }
      visit(child, `${itemPath}.${key}`);
    }
  };
  visit(value, path);
  return issues;
}

export function parseContentCommand<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ContentDomainError(
      "CONTENT_INPUT_INVALID",
      "content command input is invalid",
      zodIssues("input", parsed.error),
    );
  }
  return parsed.data;
}

export type ContentPublicationSnapshot = {
  version: ContentVersion;
  localizations: ContentLocalization[];
  assets: ContentAsset[];
};

export function validateContentPublication(
  snapshot: ContentPublicationSnapshot,
): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];

  if (snapshot.localizations.length === 0) {
    issues.push({
      code: "CONTENT_LOCALIZATION_REQUIRED",
      path: "localizations",
      message: "at least one valid localization is required",
    });
  }

  const locales = new Set<string>();
  for (const localization of snapshot.localizations) {
    const prefix = `localizations.${localization.id}`;
    const parsed = contentLocalizationPayloadSchema.safeParse({
      locale: localization.locale,
      title: localization.title,
      subtitle: localization.subtitle,
      learningObjectiveExtension: localization.learningObjectiveExtension,
      summary: localization.summary,
      transcript: localization.transcript,
      body: localization.body,
    });
    if (!parsed.success) issues.push(...zodIssues(prefix, parsed.error));
    issues.push(...authorityKeyIssues(localization.body, `${prefix}.body`));
    if (locales.has(localization.locale)) {
      issues.push({
        code: "CONTENT_LOCALE_DUPLICATE",
        path: `${prefix}.locale`,
        message: "localization locale must be unique",
      });
    }
    locales.add(localization.locale);
  }

  const assetCodes = new Set<string>();
  const sortOrders = new Set<number>();
  for (const asset of snapshot.assets) {
    const prefix = `assets.${asset.id}`;
    const parsed = contentAssetPayloadSchema.safeParse({
      kind: asset.kind,
      assetCode: asset.assetCode,
      locale: asset.locale,
      url: asset.url,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationSeconds: asset.durationSeconds,
      checksum: asset.checksum,
      sortOrder: asset.sortOrder,
    });
    if (!parsed.success) issues.push(...zodIssues(prefix, parsed.error));
    if (assetCodes.has(asset.assetCode)) {
      issues.push({
        code: "CONTENT_ASSET_CODE_DUPLICATE",
        path: `${prefix}.assetCode`,
        message: "assetCode must be unique within the content version",
      });
    }
    if (sortOrders.has(asset.sortOrder)) {
      issues.push({
        code: "CONTENT_ASSET_ORDER_DUPLICATE",
        path: `${prefix}.sortOrder`,
        message: "sortOrder must be unique within the content version",
      });
    }
    if (asset.locale !== null && !locales.has(asset.locale)) {
      issues.push({
        code: "CONTENT_ASSET_LOCALE_MISSING",
        path: `${prefix}.locale`,
        message: "localized asset must reference an existing content locale",
      });
    }
    assetCodes.add(asset.assetCode);
    sortOrders.add(asset.sortOrder);
  }

  const videos = snapshot.assets.filter((asset) => asset.kind === "video");
  if (videos.length > 0 && snapshot.version.videoDurationSeconds === null) {
    issues.push({
      code: "CONTENT_VIDEO_DURATION_REQUIRED",
      path: "videoDurationSeconds",
      message: "video content must declare videoDurationSeconds",
    });
  }
  for (const video of videos) {
    if (
      video.durationSeconds !== null &&
      snapshot.version.videoDurationSeconds !== null &&
      video.durationSeconds !== snapshot.version.videoDurationSeconds
    ) {
      issues.push({
        code: "CONTENT_VIDEO_DURATION_MISMATCH",
        path: `assets.${video.id}.durationSeconds`,
        message: "video asset duration must match videoDurationSeconds",
      });
    }
  }

  return issues;
}
