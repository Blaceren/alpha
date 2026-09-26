/**
 * TOOLS-V2 NEWS — runtime contracts for the CRM news API.
 *
 * These mirror the backend's `toCrmNewsDto` and `newsReference` exactly, and
 * every object is `.strict()`: a field the backend starts sending later fails
 * parsing here instead of quietly appearing in the editor.
 */
import { z } from "zod";

export const newsStatusSchema = z.enum(["draft", "published"]);
export type NewsStatus = z.infer<typeof newsStatusSchema>;

export const newsItemSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string(),
    summary: z.string(),
    body: z.string(),
    country: z.string(),
    countryLabel: z.string(),
    currency: z.string(),
    importance: z.number().int().min(1).max(3),
    releaseAt: z.string(),
    forecast: z.string().nullable(),
    previous: z.string().nullable(),
    actual: z.string().nullable(),
    sourceName: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    status: newsStatusSchema,
    slugLocked: z.boolean(),
    publishedAt: z.string().nullable(),
    publicUrl: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type NewsItem = z.infer<typeof newsItemSchema>;

export const newsReferenceSchema = z
  .object({
    countries: z.array(z.object({ code: z.string(), label: z.string(), currency: z.string() }).strict()),
    currencies: z.array(z.string()),
    importance: z.array(z.object({ value: z.number().int(), label: z.string() }).strict()),
  })
  .strict();

export type NewsReference = z.infer<typeof newsReferenceSchema>;

export const newsListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(newsItemSchema),
        total: z.number().int().nonnegative(),
        page: z.number().int().positive(),
        pageCount: z.number().int().positive(),
        reference: newsReferenceSchema,
      })
      .strict(),
  })
  .strict();

export type NewsList = z.infer<typeof newsListResponseSchema>["data"];

export const newsItemResponseSchema = z
  .object({
    data: z.object({ item: newsItemSchema, reference: newsReferenceSchema }).strict(),
  })
  .strict();

export const newsWriteResponseSchema = z
  .object({
    data: z.object({ item: newsItemSchema, changed: z.boolean().optional() }).strict(),
  })
  .strict();

/**
 * Two refusal envelopes reach this client. The CRM's own auth refusals
 * (`{ code, messageKey, requestId }`, 401/403) and the news API's
 * (`{ error, detail?, requestId }`). Both are read; neither is rendered raw.
 */
export const newsErrorSchema = z
  .object({
    error: z.string().optional(),
    detail: z.string().optional(),
    code: z.string().optional(),
    messageKey: z.string().optional(),
    requestId: z.string().optional(),
  })
  .passthrough();
