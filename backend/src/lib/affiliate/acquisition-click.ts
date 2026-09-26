/**
 * AFD-3B2 — the acquisition-click owner.
 *
 * Everything the public route does between "a request arrived" and "a row
 * exists" lives here, so the route handler stays a thin, auditable shell and so
 * the rules can be exercised without an HTTP server.
 */
import type { PrismaClient } from "@prisma/client";
import {
  captureParameters,
  isPrefetchRequest,
  sanitizeReferrerHost,
  type CapturedParameters,
  type QueryRejection,
} from "@/lib/affiliate/click-capture";
import { readAttributionCookie } from "@/lib/affiliate/attribution-cookie";
import {
  createAttributionToken,
  verifyAttributionToken,
  ATTRIBUTION_TOKEN_MAX_LIFETIME_SECONDS,
} from "@/lib/affiliate/attribution-token";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import {
  effectiveAttributionWindowDays,
  isLinkEffectivelyActive,
  type AffiliateStatus,
  type TrackingLinkStatus,
} from "@/lib/crm/affiliates";
import { SESSION_COOKIE_NAME, resolveSession } from "@/lib/session";

export const PUBLIC_CODE_PATTERN = /^[a-z2-7]{32}$/;

/** The only landing destination that exists, and it is a fixed same-origin path. */
export const LANDING_PATHS: Readonly<Record<string, string>> = {
  academy_registration: "/register",
};

export type ClickClassification = "qualified" | "prefetch" | "authenticated_user";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide how this request is treated, before any row is written.
 *
 * PREFETCH IS CHECKED FIRST. A browser that prefetches a link on behalf of an
 * already-signed-in user has made a machine request, and calling it
 * `authenticated_user` would suggest a person clicked. Neither classification
 * can ever be attributed, so the ordering costs nothing and the more specific
 * fact is the one recorded.
 */
export async function classifyRequest(request: Request): Promise<ClickClassification> {
  if (isPrefetchRequest(request.headers)) return "prefetch";

  /* THE SESSION IS VERIFIED, NOT ASSUMED.
     An intermediate version of this read the cookie and called its mere
     presence `authenticated_user`. That is wrong even for analytics: anyone can
     set a cookie, so the label would have meant "this browser sent a string",
     and a label nobody can trust is worse than no label — it would have
     silently suppressed attribution for visitors who were never signed in.

     So it resolves the token through the same authority every authenticated
     request uses. Revoked, expired, unknown, forged and blocked all resolve to
     null and fall through to `qualified`, which is the honest answer: as far as
     this platform is concerned, nobody is signed in.

     The cost is one indexed lookup on a hash, and only when a session cookie is
     actually present. */
  const token = readSessionCookieValue(request.headers.get("cookie"));
  if (token !== null && (await resolveSession(token)) !== null) {
    return "authenticated_user";
  }

  return "qualified";
}

/** The session cookie's raw value from a Cookie header, or null. */
function readSessionCookieValue(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader.length > 8192) return null;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    if (segment.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const value = segment.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

export type VisitorJourney = {
  readonly anonymousVisitorId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /** True when an existing valid token's visitor was carried forward. */
  readonly reused: boolean;
  /** True when the cookie must be re-issued because the expiry moved out. */
  readonly extended: boolean;
};

/**
 * Resolve the visitor journey a qualified click belongs to.
 *
 * THE THREE RULES, AND WHY.
 *
 *  1. A VALID token's visitor is reused. Two clicks from the same browser are
 *     one journey, which is the entire basis on which first touch and last touch
 *     can be different clicks.
 *
 *  2. Expiry only ever moves OUT. A visitor who clicks a 7-day link after
 *     clicking a 90-day link must not have their 90-day journey silently cut to
 *     7 days — the earlier affiliate's window was earned and is not the later
 *     one's to shorten. Note that this only extends the COOKIE: each click keeps
 *     its own snapshotted window, so extending the cookie never makes an expired
 *     click eligible again.
 *
 *  3. An EXPIRED, forged or malformed token starts a NEW visitor. Reviving the
 *     old id would resurrect a journey whose window has run out, and would let
 *     anyone who kept a copy of an old token re-enter a journey that may already
 *     have been spent.
 *
 * The 365-day ceiling is measured from the journey's own start, so a journey
 * lives at most a year however many times it is extended.
 */
export function resolveVisitorJourney(input: {
  existingToken: string | null;
  secret: string;
  effectiveWindowDays: number;
  now: Date;
}): VisitorJourney {
  const nowMs = input.now.getTime();
  const verification = verifyAttributionToken(input.existingToken, input.secret, input.now);

  const reused = verification.kind === "valid";
  const anonymousVisitorId = reused ? verification.payload.anonymousVisitorId : randomBase32Id();
  const issuedAtMs = reused ? verification.payload.issuedAt * 1000 : nowMs;
  const currentExpiryMs = reused ? verification.payload.expiresAt * 1000 : 0;

  const clickExpiryMs = nowMs + input.effectiveWindowDays * DAY_MS;
  const journeyCeilingMs = issuedAtMs + ATTRIBUTION_TOKEN_MAX_LIFETIME_SECONDS * 1000;

  // Never shorter than what the visitor already holds, never longer than the
  // journey ceiling. Both clamps are applied in that order so the "never
  // shorten" guarantee survives the ceiling.
  let expiresAtMs = Math.min(Math.max(currentExpiryMs, clickExpiryMs), journeyCeilingMs);
  if (expiresAtMs < currentExpiryMs) expiresAtMs = currentExpiryMs;

  return {
    anonymousVisitorId,
    issuedAt: new Date(issuedAtMs),
    expiresAt: new Date(expiresAtMs),
    reused,
    extended: expiresAtMs > currentExpiryMs,
  };
}

export function issueAttributionCookie(journey: VisitorJourney, secret: string): {
  token: string;
  maxAgeSeconds: number;
} {
  return {
    token: createAttributionToken({
      secret,
      anonymousVisitorId: journey.anonymousVisitorId,
      issuedAt: journey.issuedAt,
      expiresAt: journey.expiresAt,
    }),
    maxAgeSeconds: Math.max(
      0,
      Math.floor((journey.expiresAt.getTime() - Date.now()) / 1000),
    ),
  };
}

export type ResolvedLink = {
  readonly id: number;
  readonly status: TrackingLinkStatus;
  readonly landingKey: string;
  readonly externalClickParameter: string;
  readonly sub1Parameter: string | null;
  readonly sub2Parameter: string | null;
  readonly sub3Parameter: string | null;
  readonly sub4Parameter: string | null;
  readonly sub5Parameter: string | null;
  readonly attributionWindowDays: number | null;
  readonly partner: { status: AffiliateStatus; defaultAttributionWindowDays: number };
  readonly campaign: { status: AffiliateStatus } | null;
};

export const GO_LINK_SELECT = {
  id: true,
  status: true,
  landingKey: true,
  externalClickParameter: true,
  sub1Parameter: true,
  sub2Parameter: true,
  sub3Parameter: true,
  sub4Parameter: true,
  sub5Parameter: true,
  attributionWindowDays: true,
  partner: { select: { status: true, defaultAttributionWindowDays: true } },
  campaign: { select: { status: true } },
} as const;

/**
 * Resolve a public code to a link that may serve traffic RIGHT NOW.
 *
 * Returns null for every reason a link cannot serve — absent, malformed, draft,
 * paused, archived, parent paused, parent archived, feature disabled — because
 * the caller must answer all of them identically. Distinguishing them in the
 * response would turn this route into an oracle for whether a given 160-bit code
 * exists, and, worse, for which of a competitor's links are currently running.
 */
export async function resolveServableLink(
  db: Pick<PrismaClient, "affiliateTrackingLink">,
  publicCode: string,
  attributionEnabled: boolean,
): Promise<ResolvedLink | null> {
  if (!PUBLIC_CODE_PATTERN.test(publicCode)) return null;
  if (!attributionEnabled) return null;

  const row = await db.affiliateTrackingLink.findUnique({
    where: { publicCode },
    select: GO_LINK_SELECT,
  });
  if (!row) return null;

  const link: ResolvedLink = {
    ...row,
    status: row.status as TrackingLinkStatus,
    landingKey: row.landingKey as string,
    partner: {
      status: row.partner.status as AffiliateStatus,
      defaultAttributionWindowDays: row.partner.defaultAttributionWindowDays,
    },
    campaign: row.campaign ? { status: row.campaign.status as AffiliateStatus } : null,
  };

  if (
    !isLinkEffectivelyActive({
      linkStatus: link.status,
      partnerStatus: link.partner.status,
      campaignStatus: link.campaign?.status ?? null,
      attributionEnabled,
    })
  ) {
    return null;
  }

  // A landing key with no server-owned path is not servable. Unreachable while
  // the enum has one member, and present so that adding a member without adding
  // a path fails closed rather than redirecting to `undefined`.
  if (!(link.landingKey in LANDING_PATHS)) return null;

  return link;
}

export function linkWindowDays(link: ResolvedLink): number {
  return effectiveAttributionWindowDays(
    link.attributionWindowDays,
    link.partner.defaultAttributionWindowDays,
  );
}

export type ClickCapture =
  | { readonly kind: "rejected"; readonly reason: QueryRejection }
  | { readonly kind: "ok"; readonly captured: CapturedParameters };

export function captureForLink(url: URL, link: ResolvedLink): ClickCapture {
  const result = captureParameters(url, {
    externalClickParameter: link.externalClickParameter,
    sub1Parameter: link.sub1Parameter,
    sub2Parameter: link.sub2Parameter,
    sub3Parameter: link.sub3Parameter,
    sub4Parameter: link.sub4Parameter,
    sub5Parameter: link.sub5Parameter,
  });
  return result.kind === "ok"
    ? { kind: "ok", captured: result.captured }
    : { kind: "rejected", reason: result.reason };
}

/**
 * Write the click.
 *
 * `ataClickId` is generated here and nowhere else, and the unique index is the
 * real guarantee: a collision at 160 bits is not a thing that happens, and if it
 * somehow did, the insert would fail loudly rather than overwrite another
 * affiliate's click.
 */
export async function recordAcquisitionClick(
  db: Pick<PrismaClient, "affiliateClick">,
  input: {
    link: ResolvedLink;
    classification: ClickClassification;
    anonymousVisitorId: string | null;
    captured: CapturedParameters;
    referer: string | null;
    occurredAt: Date;
  },
): Promise<{ id: number; ataClickId: string }> {
  return db.affiliateClick.create({
    data: {
      // G4-GROWTH note: `AffiliateClick` REMAINS the counting authority for every
      // click metric, in the G4 growth surfaces exactly as in AFD-5B1. The
      // `traffic_click` growth event emitted alongside it (see
      // `emitTrafficClickEvent`) exists for the event-consumer contract — a
      // future outbound postback needs an addressable event id — and is
      // deliberately NOT what any dashboard counts, so the two can never report
      // different click totals.
      ataClickId: randomBase32Id(),
      trackingLinkId: input.link.id,
      // Belt and braces against a future caller: only a qualified click may ever
      // carry a visitor, and the database CHECK says the same thing again.
      anonymousVisitorId:
        input.classification === "qualified" ? input.anonymousVisitorId : null,
      externalAffiliateClickId: input.captured.externalAffiliateClickId,
      sub1: input.captured.sub1,
      sub2: input.captured.sub2,
      sub3: input.captured.sub3,
      sub4: input.captured.sub4,
      sub5: input.captured.sub5,
      classification: input.classification,
      effectiveAttributionWindowDays: linkWindowDays(input.link),
      sanitizedReferrerHost: sanitizeReferrerHost(input.referer),
      occurredAt: input.occurredAt,
    },
    select: { id: true, ataClickId: true },
  });
}

/** Read the incoming attribution cookie, if any, from a raw request. */
export function incomingAttributionToken(request: Request): string | null {
  return readAttributionCookie(request.headers.get("cookie"));
}
