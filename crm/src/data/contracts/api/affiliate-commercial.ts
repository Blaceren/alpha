/**
 * AFFILIATE-PLATFORM-V1 §8 — the response contracts for the commercial staff
 * surfaces.
 *
 * PARSED, NOT TRUSTED. Every list below is validated with zod before it reaches
 * a component, exactly as the affiliate inventory contracts already are. A
 * response that cannot be validated renders as a failure rather than as data:
 * these are the surfaces an operator reconciles money on, and a half-understood
 * payload displayed optimistically is worse than an error.
 *
 * MONEY IS `string`, EVERYWHERE, AND IS NEVER COERCED TO A NUMBER. The backend
 * stores canonical decimal TEXT for exactly the reason `0.1 + 0.2` exists, and
 * a `z.coerce.number()` here would undo that at the last possible moment. No
 * component in this feature performs arithmetic on these values — totals arrive
 * pre-grouped by currency from the query owner.
 */
import { z } from "zod";

/** A total that always states its unit, and admits when it has none. */
export const currencyTotalSchema = z.object({
  currency: z.string().nullable(),
  amount: z.string(),
  count: z.number().int().nonnegative(),
});
export type CurrencyTotal = z.infer<typeof currencyTotalSchema>;

/* ------------------------------------------------------- partner principals */

export const affiliatePartnerUserSchema = z.object({
  partnerUserId: z.string(),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(["active", "disabled"]),
  sessionEpoch: z.number().int().positive(),
  lastLoginAt: z.string().nullable(),
  passwordUpdatedAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AffiliatePartnerUser = z.infer<typeof affiliatePartnerUserSchema>;

export const affiliatePartnerUserListSchema = z.object({
  items: z.array(affiliatePartnerUserSchema),
  total: z.number().int().nonnegative(),
});
export type AffiliatePartnerUserList = z.infer<typeof affiliatePartnerUserListSchema>;

/**
 * The ONE-TIME reveal.
 *
 * `initialPassword` is present only on the response that created or reset a
 * credential, and no read path returns it. The type says `optional` rather than
 * `nullable` for that reason: its absence is the normal case, not a null value
 * somebody might render.
 */
export const affiliatePartnerUserCreatedSchema = z.object({
  partnerUserId: z.string(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  createdAt: z.string().optional(),
  action: z.string().optional(),
  initialPassword: z.string().optional(),
  initialPasswordNotice: z.string().optional(),
  passwordPolicyMinLength: z.number().int().positive().optional(),
});
export type AffiliatePartnerUserCreated = z.infer<typeof affiliatePartnerUserCreatedSchema>;

/* --------------------------------------------------- commercial terms (CPA) */

export const affiliateCampaignTermsSchema = z.object({
  termsId: z.string(),
  version: z.number().int().positive(),
  cpaAmount: z.string(),
  cpaCurrency: z.string(),
  status: z.enum(["active", "superseded"]),
  effectiveFrom: z.string(),
  supersededAt: z.string().nullable(),
  createdAt: z.string(),
  createdByStaffName: z.string(),
});
export type AffiliateCampaignTerms = z.infer<typeof affiliateCampaignTermsSchema>;

export const affiliateCampaignTermsListSchema = z.object({
  items: z.array(affiliateCampaignTermsSchema),
  total: z.number().int().nonnegative(),
});
export type AffiliateCampaignTermsList = z.infer<typeof affiliateCampaignTermsListSchema>;

export const affiliateCampaignTermsCreatedSchema = z.object({
  termsId: z.string(),
  version: z.number().int().positive(),
  cpaAmount: z.string(),
  cpaCurrency: z.string(),
  supersededVersion: z.number().int().positive().nullable(),
});
export type AffiliateCampaignTermsCreated = z.infer<typeof affiliateCampaignTermsCreatedSchema>;

/* ------------------------------------------- qualifications and commissions */

export const affiliateQualificationSchema = z.object({
  qualificationId: z.string(),
  qualifiedAt: z.string(),
  partner: z.object({
    id: z.number().int().positive(),
    code: z.string(),
    displayName: z.string(),
    codeAtQualification: z.string(),
  }),
  campaignCodeAtQualification: z.string(),
  terms: z.object({
    termsId: z.string(),
    version: z.number().int().positive(),
    cpaAmount: z.string(),
    cpaCurrency: z.string(),
    currentStatus: z.enum(["active", "superseded"]),
  }),
  attributionId: z.number().int().positive(),
  sourceConversion: z.object({
    conversionId: z.string(),
    eventType: z.string(),
    occurredAt: z.string(),
    providerAmount: z.string().nullable(),
    providerCurrency: z.string().nullable(),
    providerCurrencyStatus: z.string().nullable(),
    userId: z.number().int().positive(),
  }),
  commission: z
    .object({
      commissionId: z.string(),
      amount: z.string(),
      currency: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
});
export type AffiliateQualification = z.infer<typeof affiliateQualificationSchema>;

export const affiliateQualificationListSchema = z.object({
  items: z.array(affiliateQualificationSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  commissionTotals: z.array(currencyTotalSchema),
});
export type AffiliateQualificationList = z.infer<typeof affiliateQualificationListSchema>;

/* ---------------------------------------------------- postback deliveries */

export const affiliatePostbackAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  startedAt: z.string(),
  outcome: z.string(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  responseSnippet: z.string().nullable(),
});
export type AffiliatePostbackAttempt = z.infer<typeof affiliatePostbackAttemptSchema>;

export const affiliatePostbackDeliverySchema = z.object({
  deliveryId: z.string(),
  partner: z.object({ id: z.number().int().positive(), code: z.string() }),
  conversionId: z.string(),
  eventType: z.string(),
  status: z.enum(["pending", "delivered", "failed_retryable", "failed_terminal"]),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastOutcome: z.string().nullable(),
  lastHttpStatus: z.number().int().nullable(),
  lastAttemptAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  endpointVersion: z.number().int().positive(),
  createdAt: z.string(),
  attempts: z.array(affiliatePostbackAttemptSchema),
});
export type AffiliatePostbackDelivery = z.infer<typeof affiliatePostbackDeliverySchema>;

export const affiliatePostbackDeliveryListSchema = z.object({
  items: z.array(affiliatePostbackDeliverySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type AffiliatePostbackDeliveryList = z.infer<typeof affiliatePostbackDeliveryListSchema>;
