/**
 * AFD-5A — runtime contracts for the affiliate inventory API.
 *
 * These mirror the backend's `src/lib/crm/schemas.ts` affiliate DTOs exactly.
 * Every object is `.strict()` for the same reason the backend's are: a field the
 * backend starts sending later — a click count, a conversion total, a provider
 * amount, an external click id — must fail parsing HERE and stop the page from
 * rendering, rather than quietly appearing in the UI.
 *
 * That is the mechanism by which "AFD-5A displays no traffic analytics" is
 * enforced rather than merely intended: there is no field to put a number in,
 * and an unexpected one is a hard error.
 */
import { z } from "zod";

export const affiliateEntityStatusSchema = z.enum(["active", "paused", "archived"]);
export const affiliateLinkStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export const affiliateAvailabilitySchema = z.enum(["available", "paused", "archived"]);

export type AffiliateEntityStatus = z.infer<typeof affiliateEntityStatusSchema>;
export type AffiliateLinkStatus = z.infer<typeof affiliateLinkStatusSchema>;
export type AffiliateAvailability = z.infer<typeof affiliateAvailabilitySchema>;

/** Opaque staff id plus a display-safe label. Never an email, never a role. */
export const affiliateActorSchema = z
  .object({
    employeeId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

/**
 * CONFIGURATION counts, not traffic. `campaigns`/`trackingLinks` count rows an
 * operator created; `activeTrackingLinks` counts those they set active. Safe to
 * render as zero — "no campaigns yet" is a true statement about configuration.
 */
export const affiliateInventorySchema = z
  .object({
    campaigns: z.number().int().nonnegative(),
    trackingLinks: z.number().int().nonnegative(),
    activeTrackingLinks: z.number().int().nonnegative(),
  })
  .strict();

export const affiliateCampaignInventorySchema = affiliateInventorySchema.omit({ campaigns: true });

export const affiliatePartnerSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().nullable(),
    status: affiliateEntityStatusSchema,
    availability: affiliateAvailabilitySchema,
    defaultAttributionWindowDays: z.number().int().positive(),
    inventory: affiliateInventorySchema,
    createdBy: affiliateActorSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();

export const affiliateCampaignSchema = z
  .object({
    id: z.string().min(1),
    affiliatePartnerId: z.string().min(1),
    affiliatePartnerCode: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
    notes: z.string().nullable(),
    status: affiliateEntityStatusSchema,
    availability: affiliateAvailabilitySchema,
    inventory: affiliateCampaignInventorySchema,
    createdBy: affiliateActorSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();

export const affiliateSubParametersSchema = z
  .object({
    sub1: z.string().nullable(),
    sub2: z.string().nullable(),
    sub3: z.string().nullable(),
    sub4: z.string().nullable(),
    sub5: z.string().nullable(),
  })
  .strict();

/** Why a link would not serve traffic right now. */
export const affiliatePublicRouteStateSchema = z.enum([
  "serving",
  "feature_disabled",
  "not_active",
  "parent_paused",
  "parent_archived",
]);

/** Whether an operator could set this link active today. */
export const affiliateActivationStateSchema = z.enum([
  "available",
  "feature_disabled",
  "blocked",
  "terminal",
]);

export const affiliateTrackingLinkSchema = z
  .object({
    id: z.string().min(1),
    affiliatePartnerId: z.string().min(1),
    affiliatePartnerCode: z.string().min(1),
    affiliateCampaignId: z.string().min(1).nullable(),
    affiliateCampaignCode: z.string().min(1).nullable(),
    publicCode: z.string().length(32),
    displayName: z.string().min(1),
    status: affiliateLinkStatusSchema,
    availability: affiliateAvailabilitySchema,
    landingKey: z.literal("academy_registration"),
    externalClickParameter: z.string().min(1),
    subParameters: affiliateSubParametersSchema,
    attributionWindowDays: z.number().int().positive().nullable(),
    effectiveAttributionWindowDays: z.number().int().positive(),
    publicRouteState: affiliatePublicRouteStateSchema,
    activationState: affiliateActivationStateSchema,
    // Origin-free and always present, so the CRM can describe a link even when
    // no canonical URL exists.
    publicPath: z.string().regex(/^\/go\/[a-z2-7]{32}$/),
    // The ONLY URL the CRM may copy. Built by the backend from its validated
    // public origin; `null` when that origin is unavailable. The CRM never
    // reconstructs it from `location.host` — see `affiliates-client.ts`.
    publicUrl: z.string().url().nullable(),
    publicUrlUnavailableReason: z.enum(["public_origin_unavailable"]).nullable(),
    createdBy: affiliateActorSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();

const listSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
    })
    .strict();

export const affiliatePartnerListSchema = listSchema(affiliatePartnerSchema);
export const affiliateCampaignListSchema = listSchema(affiliateCampaignSchema);
export const affiliateTrackingLinkListSchema = listSchema(affiliateTrackingLinkSchema);

/** The backend's closed failure envelope: `{code, messageKey, requestId}`. */
export const affiliateErrorSchema = z
  .object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type AffiliatePartner = z.infer<typeof affiliatePartnerSchema>;
export type AffiliateCampaign = z.infer<typeof affiliateCampaignSchema>;
export type AffiliateTrackingLink = z.infer<typeof affiliateTrackingLinkSchema>;
export type AffiliatePartnerList = z.infer<typeof affiliatePartnerListSchema>;
export type AffiliateCampaignList = z.infer<typeof affiliateCampaignListSchema>;
export type AffiliateTrackingLinkList = z.infer<typeof affiliateTrackingLinkListSchema>;
export type AffiliateActor = z.infer<typeof affiliateActorSchema>;
export type AffiliateError = z.infer<typeof affiliateErrorSchema>;
