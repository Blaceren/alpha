import { NextResponse } from "next/server";
import {
  captureForLink,
  classifyRequest,
  incomingAttributionToken,
  issueAttributionCookie,
  linkWindowDays,
  recordAcquisitionClick,
  resolveServableLink,
  resolveVisitorJourney,
  LANDING_PATHS,
} from "@/lib/affiliate/acquisition-click";
import {
  ATTRIBUTION_COOKIE_NAME,
  attributionCookieOptions,
} from "@/lib/affiliate/attribution-cookie";
import {
  isAffiliateAttributionEnabled,
  requireAttributionSecret,
} from "@/lib/affiliate/attribution-config";
import { emitTrafficClickEvent } from "@/lib/growth/product-events";
import { applyGoAbuseLimit } from "@/lib/affiliate/go-abuse-limit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /go/{publicCode} — the public acquisition route.
 *
 * WHY THERE IS EXACTLY ONE EXPORT. `GET` is the only handler in this file, so
 * Next.js answers 405 to POST, PUT, PATCH, DELETE and HEAD before any of this
 * code runs. A tracking link is a link: nothing else should ever reach it.
 *
 * WHY THIS IS NOT A REDIRECT SERVICE. The destination is not in the request, is
 * not in the database and cannot be influenced by anything a caller sends. It is
 * looked up from a CHECK-bounded logical key in `LANDING_PATHS` — a table of
 * fixed, same-origin, root-relative paths compiled into this file. There is no
 * `url`, `next`, `target`, `redirect` or `return_to` parameter, no external
 * origin, no user-controlled path segment and no way to reach one: the open
 * redirect is not defended against, it is unrepresentable.
 *
 * WHY EVERY FAILURE LOOKS THE SAME. Absent, malformed, draft, paused, archived,
 * parent-paused, parent-archived and feature-disabled all produce the identical
 * 404. Any difference would let a stranger test whether a 160-bit code exists
 * and, worse, watch a competitor's campaigns start and stop.
 *
 * WHY 302 AND NOT 301. A permanent redirect is cached by browsers and
 * intermediaries, so the SECOND click from a returning visitor would never reach
 * this server — no click row, no cookie, no attribution, and an affiliate
 * underpaid for traffic they really sent. 302 plus `no-store` means every click
 * is measured.
 */

/** Applied to every response this route produces, success or failure. */
function acquisitionHeaders(): Record<string, string> {
  return {
    // Nothing about a tracking hop may be cached, by the browser or by anything
    // between us and it.
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    // The affiliate's own URL — which carries their click id — must not travel
    // onward to /register or to anything the registration page loads.
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    // A tracking hop is never a document to render or a frame to embed.
    "X-Content-Type-Options": "nosniff",
  };
}

function notFound(): NextResponse {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { ...acquisitionHeaders(), "Content-Type": "text/plain; charset=utf-8" },
  });
}

function badRequest(): NextResponse {
  // Deliberately bodiless of detail. The affiliate learns their URL was refused
  // and can compare it against the mapping the operator configured; a stranger
  // learns nothing about which parameter names this link recognises.
  return new NextResponse("Bad Request", {
    status: 400,
    headers: { ...acquisitionHeaders(), "Content-Type": "text/plain; charset=utf-8" },
  });
}

function tooManyRequests(): NextResponse {
  return new NextResponse("Too Many Requests", {
    status: 429,
    headers: { ...acquisitionHeaders(), "Content-Type": "text/plain; charset=utf-8" },
  });
}

type RouteContext = { params: Promise<{ publicCode: string }> };

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { publicCode } = await context.params;

  // The feature switch is answered first and answered as "there is nothing
  // here", so a deployment with attribution off exposes no acquisition surface
  // at all — not a disabled one, not an explaining one.
  const attributionEnabled = isAffiliateAttributionEnabled();
  if (!attributionEnabled) return notFound();

  const link = await resolveServableLink(prisma, publicCode, attributionEnabled);
  if (!link) return notFound();

  // Bounded BEFORE the click row is written, so a refusal costs one lookup and
  // leaves nothing behind. A limiter that recorded what it refused would be an
  // amplifier rather than a limit.
  const limit = applyGoAbuseLimit(request, publicCode);
  if (!limit.allowed) return tooManyRequests();

  const url = new URL(request.url);
  const capture = captureForLink(url, link);
  if (capture.kind === "rejected") return badRequest();

  const classification = await classifyRequest(request);
  const now = new Date();

  // A prefetch and a click by an already-authenticated user are recorded, and
  // are recorded as what they are. Neither gets a visitor id and neither gets a
  // cookie, which is what makes them permanently unattributable — a browser
  // preloading a link cannot earn an affiliate a conversion, and an existing
  // learner cannot be re-acquired by clicking someone's tracking link.
  if (classification !== "qualified") {
    await recordAcquisitionClick(prisma, {
      link,
      classification,
      anonymousVisitorId: null,
      captured: capture.captured,
      referer: request.headers.get("referer"),
      occurredAt: now,
    });
    return redirectToLanding(link.landingKey);
  }

  // Reached only when the feature is enabled, so the secret is present and
  // valid — `requireAttributionSecret` throws rather than falling back, and a
  // throw here is a 500, not a silently unsigned cookie.
  const secret = requireAttributionSecret();

  const journey = resolveVisitorJourney({
    existingToken: incomingAttributionToken(request),
    secret,
    effectiveWindowDays: linkWindowDays(link),
    now,
  });

  const click = await recordAcquisitionClick(prisma, {
    link,
    classification,
    anonymousVisitorId: journey.anonymousVisitorId,
    captured: capture.captured,
    referer: request.headers.get("referer"),
    occurredAt: now,
  });

  // G4-GROWTH — the `traffic_click` event for the canonical ledger.
  //
  // FOR THE EVENT-CONSUMER CONTRACT, NOT FOR COUNTING. Every click METRIC in the
  // Growth surfaces is counted from `AffiliateClick`, exactly as the accepted
  // AFD-5B1 analytics counts it, so the two can never report different totals.
  // This event exists so a future outbound postback or CPA consumer has an
  // addressable, immutable event id for the click — which a row id is not.
  //
  // Emitted only for QUALIFIED clicks (the emitter enforces it), and it cannot
  // fail the redirect: a visitor must never see an error because a measurement
  // did not write.
  await emitTrafficClickEvent(prisma, {
    affiliateClickId: click.id,
    classification,
    occurredAt: now,
  });

  const response = redirectToLanding(link.landingKey);

  // Re-issued whenever the visitor is new or the expiry moved out. When neither
  // is true the browser already holds a token that says exactly the right thing,
  // and re-sending it would only risk shortening it through clock skew.
  if (!journey.reused || journey.extended) {
    const cookie = issueAttributionCookie(journey, secret);
    response.cookies.set(
      ATTRIBUTION_COOKIE_NAME,
      cookie.token,
      attributionCookieOptions(cookie.maxAgeSeconds),
    );
  }

  return response;
}

/**
 * The destination, resolved from the server's own table and emitted as a
 * root-relative path.
 *
 * Root-relative is not a stylistic choice. A `Location` of `/register` cannot
 * name another origin however it is parsed, so even a bug in the lookup could
 * not produce a cross-origin redirect. Nothing from the request — not the
 * captured parameters, not the click id, not the visitor id — is appended: the
 * registration page has no use for them and a URL is the one place a value ends
 * up in browser history, in a referrer and in a screenshot.
 */
function redirectToLanding(landingKey: string): NextResponse {
  const path = LANDING_PATHS[landingKey];
  return new NextResponse(null, {
    status: 302,
    headers: { ...acquisitionHeaders(), Location: path },
  });
}
