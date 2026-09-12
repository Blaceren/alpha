/**
 * AFFILIATE-PLATFORM-V1 §21/§22 — parsing the report filters a partner sends.
 *
 * EVERY FILTER IS PARSED, BOUNDED AND RESOLVED TO A TENANT-OWNED ROW.
 *
 * The campaign and tracking-link filters arrive as PUBLIC identifiers and are
 * resolved to internal ids by a query that already carries the partner
 * predicate. So a partner who substitutes another tenant's campaign code does
 * not receive that tenant's data and does not receive an error revealing the
 * code exists — the lookup simply finds nothing, and the request is refused as
 * an invalid filter, exactly as it would be for a code that never existed.
 *
 * SUB VALUES ARE UNTRUSTED PARTNER-SUPPLIED TEXT (§21). They are bounded to the
 * same length the acquisition route accepts, stripped of control characters,
 * and passed to Prisma as PARAMETERS — never concatenated into SQL, and never
 * rendered as HTML by any reader. There is no string interpolation of a filter
 * value anywhere in this platform.
 */
import type { PrismaClient } from "@prisma/client";
import type { PartnerReportFilters } from "@/lib/affiliate/partner/reporting";

/** The same bound the acquisition click capture applies. */
export const SUB_VALUE_MAX_LENGTH = 255;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type FilterRejection =
  | "invalid_date"
  | "range_inverted"
  | "invalid_sub"
  | "unknown_campaign"
  | "unknown_link";

export type FilterResult =
  | { readonly ok: true; readonly filters: PartnerReportFilters }
  | { readonly ok: false; readonly reason: FilterRejection };

function parseDate(raw: string | null): Date | null | "invalid" {
  if (raw === null || raw === "") return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return "invalid";
  return value;
}

function parseSub(raw: string | null): string | null | "invalid" {
  if (raw === null || raw === "") return null;
  if (raw.length > SUB_VALUE_MAX_LENGTH) return "invalid";
  if (CONTROL_CHARACTERS.test(raw)) return "invalid";
  return raw;
}

/**
 * Resolve query parameters into a tenant-scoped filter set.
 *
 * THE PARTNER ID IS A PARAMETER OF THIS FUNCTION, NOT A FIELD OF THE REQUEST.
 * Callers pass the value from the session principal.
 */
export async function parsePartnerFilters(
  db: PrismaClient,
  affiliatePartnerId: number,
  params: URLSearchParams,
): Promise<FilterResult> {
  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));
  if (from === "invalid" || to === "invalid") return { ok: false, reason: "invalid_date" };
  if (from !== null && to !== null && from.getTime() > to.getTime()) {
    return { ok: false, reason: "range_inverted" };
  }

  const subs: Record<string, string | undefined> = {};
  for (const key of ["sub1", "sub2", "sub3", "sub4", "sub5"]) {
    const parsed = parseSub(params.get(key));
    if (parsed === "invalid") return { ok: false, reason: "invalid_sub" };
    if (parsed !== null) subs[key] = parsed;
  }

  let campaignId: number | undefined;
  const campaignCode = params.get("campaign");
  if (campaignCode !== null && campaignCode !== "") {
    // THE TENANT PREDICATE IS IN THE LOOKUP. Another partner's campaign code
    // resolves to nothing here, and the caller answers "unknown filter" — the
    // same answer a nonexistent code gets.
    const campaign = await db.affiliateCampaign.findFirst({
      where: { affiliatePartnerId, code: campaignCode },
      select: { id: true },
    });
    if (campaign === null) return { ok: false, reason: "unknown_campaign" };
    campaignId = campaign.id;
  }

  let trackingLinkId: number | undefined;
  const linkCode = params.get("link");
  if (linkCode !== null && linkCode !== "") {
    const link = await db.affiliateTrackingLink.findFirst({
      where: { affiliatePartnerId, publicCode: linkCode },
      select: { id: true },
    });
    if (link === null) return { ok: false, reason: "unknown_link" };
    trackingLinkId = link.id;
  }

  return {
    ok: true,
    filters: {
      ...(from !== null ? { from } : {}),
      ...(to !== null ? { to } : {}),
      ...(campaignId !== undefined ? { campaignId } : {}),
      ...(trackingLinkId !== undefined ? { trackingLinkId } : {}),
      ...(subs.sub1 !== undefined ? { sub1: subs.sub1 } : {}),
      ...(subs.sub2 !== undefined ? { sub2: subs.sub2 } : {}),
      ...(subs.sub3 !== undefined ? { sub3: subs.sub3 } : {}),
      ...(subs.sub4 !== undefined ? { sub4: subs.sub4 } : {}),
      ...(subs.sub5 !== undefined ? { sub5: subs.sub5 } : {}),
    },
  };
}
