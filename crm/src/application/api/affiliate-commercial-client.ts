/**
 * AFFILIATE-PLATFORM-V1 §8 — the one client for the commercial staff APIs.
 *
 * IT REUSES the inventory client's `request` helper rather than forking it: the
 * closed error envelope, the exhaustive status mapping, the timeout and the
 * refusal to render an unvalidated body are the same contract, and a second
 * copy would be a second place for them to drift.
 *
 * RELATIVE PATHS ONLY. The browser never learns the backend origin; the Next
 * rewrite maps these exact paths server-side.
 *
 * NO PASSWORD, NO SIGNING SECRET AND NO CREDENTIAL IS EVER PERSISTED HERE. The
 * one-time reveal returned by a create or a reset is handed straight to the
 * caller, which shows it once and drops it. Nothing in this module writes to
 * storage of any kind.
 */
import {
  affiliateCampaignTermsCreatedSchema,
  affiliateCampaignTermsListSchema,
  affiliatePartnerUserCreatedSchema,
  affiliatePartnerUserListSchema,
  affiliatePostbackDeliveryListSchema,
  affiliateQualificationListSchema,
  type AffiliateCampaignTermsCreated,
  type AffiliateCampaignTermsList,
  type AffiliatePartnerUserCreated,
  type AffiliatePartnerUserList,
  type AffiliatePostbackDeliveryList,
  type AffiliateQualificationList,
} from "@/data/contracts/api/affiliate-commercial";
import { mutate, request, type AffiliateOutcome, type AffiliateRequestOptions } from "./affiliates-client";

export const PARTNER_USERS_ENDPOINT = "/api/crm/v1/affiliates/partner-users";
export const CAMPAIGN_TERMS_ENDPOINT = "/api/crm/v1/affiliates/campaign-terms";
export const COMMISSIONS_ENDPOINT = "/api/crm/v1/affiliates/commissions";
export const POSTBACK_DELIVERIES_ENDPOINT = "/api/crm/v1/affiliates/postback-deliveries";

/**
 * The CRM's affiliate contracts expose every identifier as an OPAQUE STRING —
 * the inventory client has always done so, and the backend owns identifier
 * validation. The commercial endpoints take a numeric id, so the conversion
 * happens HERE, once, at the boundary, and it FAILS CLOSED.
 *
 * A value that is not a positive integer never reaches the network: it returns
 * the same `invalid_input` outcome the backend would, rather than being sent as
 * `NaN` and answered with a confusing 400.
 */
function asNumericId(value: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const INVALID_ID = {
  status: "invalid_input",
  messageKey: "crm.affiliates.invalid_identifier",
} as const;


/* --------------------------------------------------------- principals */

export function fetchPartnerUsers(
  affiliatePartnerId: string,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartnerUserList>> {
  const id = asNumericId(affiliatePartnerId);
  if (id === null) return Promise.resolve(INVALID_ID);
  return request(
    `${PARTNER_USERS_ENDPOINT}?affiliatePartnerId=${id}`,
    affiliatePartnerUserListSchema,
    { method: "GET" },
    options,
  );
}

export function createPartnerUser(
  input: { affiliatePartnerId: string; email: string; displayName: string },
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartnerUserCreated>> {
  const id = asNumericId(input.affiliatePartnerId);
  if (id === null) return Promise.resolve(INVALID_ID);
  return mutate(
    PARTNER_USERS_ENDPOINT,
    affiliatePartnerUserCreatedSchema,
    "POST",
    { ...input, affiliatePartnerId: id },
    options,
  );
}

/**
 * Disable, enable, or reset a partner login's password.
 *
 * DISABLE AND RESET BOTH BUMP THE SESSION EPOCH server-side, so both take
 * effect on the principal's very next request rather than at token expiry. The
 * UI says so; this client makes no claim of its own.
 */
export function updatePartnerUser(
  input: { partnerUserId: string; action: "disable" | "enable" | "reset_password" },
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartnerUserCreated>> {
  return mutate(
    PARTNER_USERS_ENDPOINT,
    affiliatePartnerUserCreatedSchema,
    "PATCH",
    input,
    options,
  );
}

/* ---------------------------------------------------- commercial terms */

export function fetchCampaignTerms(
  affiliateCampaignId: string,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateCampaignTermsList>> {
  const id = asNumericId(affiliateCampaignId);
  if (id === null) return Promise.resolve(INVALID_ID);
  return request(
    `${CAMPAIGN_TERMS_ENDPOINT}?affiliateCampaignId=${id}`,
    affiliateCampaignTermsListSchema,
    { method: "GET" },
    options,
  );
}

/**
 * Set a campaign's CPA.
 *
 * THERE IS NO `updateCampaignTerms` AND NO `deleteCampaignTerms`, here or in the
 * backend. Setting a price appends a version and supersedes the previous one;
 * §11's "no retroactive money rewrite" is expressed in this module as an ABSENCE
 * OF FUNCTIONS, which is the only form of it a UI cannot get wrong.
 */
export function setCampaignTerms(
  input: { affiliateCampaignId: string; cpaAmount: string; cpaCurrency: string },
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateCampaignTermsCreated>> {
  const id = asNumericId(input.affiliateCampaignId);
  if (id === null) return Promise.resolve(INVALID_ID);
  return mutate(
    CAMPAIGN_TERMS_ENDPOINT,
    affiliateCampaignTermsCreatedSchema,
    "POST",
    { ...input, affiliateCampaignId: id },
    options,
  );
}

/* -------------------------------------------- qualifications / commissions */

export function fetchQualifications(
  query: { affiliatePartnerId?: string; limit?: number; offset?: number } = {},
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateQualificationList>> {
  const params = new URLSearchParams();
  if (query.affiliatePartnerId !== undefined) {
    const id = asNumericId(query.affiliatePartnerId);
    if (id === null) return Promise.resolve(INVALID_ID);
    params.set("affiliatePartnerId", String(id));
  }
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return request(
    `${COMMISSIONS_ENDPOINT}${suffix}`,
    affiliateQualificationListSchema,
    { method: "GET" },
    options,
  );
}

/* ------------------------------------------------------ delivery ledger */

export function fetchPostbackDeliveries(
  query: { affiliatePartnerId?: string; status?: string; limit?: number; offset?: number } = {},
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePostbackDeliveryList>> {
  const params = new URLSearchParams();
  if (query.affiliatePartnerId !== undefined) {
    const id = asNumericId(query.affiliatePartnerId);
    if (id === null) return Promise.resolve(INVALID_ID);
    params.set("affiliatePartnerId", String(id));
  }
  if (query.status !== undefined && query.status !== "") params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return request(
    `${POSTBACK_DELIVERIES_ENDPOINT}${suffix}`,
    affiliatePostbackDeliveryListSchema,
    { method: "GET" },
    options,
  );
}
