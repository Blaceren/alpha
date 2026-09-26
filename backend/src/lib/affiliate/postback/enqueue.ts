/**
 * AFFILIATE-PLATFORM-V1 §25/§27 — turning a conversion into a logical delivery.
 *
 * DELIVERY IS DRIVEN BY THE CONVERSION LEDGER, NOT BY A UI ACTION. §25 is
 * explicit, and it matters: a postback that could be triggered by a button is a
 * postback whose count depends on how often somebody clicked. The only input
 * here is an `AffiliateConversionEvent` row id — the canonical statement that
 * something happened.
 *
 * IT RUNS AFTER THE CONVERSION COMMITS, AND IT SWALLOWS ITS OWN FAILURES. §28:
 * conversion truth must commit independently of postback delivery. A partner's
 * misconfigured endpoint, a full disk or a bug in this module must never roll
 * back a deposit. What is lost by a failure here is recoverable, because
 * enqueueing is idempotent on UNIQUE(conversionEventId, endpointId,
 * endpointVersion) — running it again later reaches the same one row.
 *
 * A CONVERSION WITH NO CONFIGURED ENDPOINT PRODUCES NOTHING, and that is a
 * normal outcome rather than an error. Most partners will not configure all
 * three event types, and an unattributed conversion has no partner at all.
 */
import type { AffiliateConversionEventType, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import {
  POSTBACK_EVENT_NAMES,
  renderPostbackTemplate,
  type PostbackMacroValues,
} from "@/lib/affiliate/postback/template";

/**
 * SIX ATTEMPTS, AND THEN THE DELIVERY IS TERMINALLY FAILED.
 *
 * With the backoff below that is roughly seven hours of trying. An endpoint
 * that has not answered in seven hours is not experiencing a blip, and
 * continuing would be the unbounded retry storm §28 forbids. A partner who
 * fixes their server after that reads the failed deliveries in their console.
 */
export const POSTBACK_MAX_ATTEMPTS = 6;

/**
 * Backoff before attempt N+1, in seconds. Immediate, then widening.
 *
 * THE FIRST ATTEMPT IS NOT DELAYED. A conversion postback is time-sensitive to
 * a partner's own optimisation, and the common case is that it works.
 */
const BACKOFF_SECONDS = [0, 60, 300, 900, 3_600, 21_600] as const;

export function nextAttemptAt(attemptCount: number, now: Date): Date {
  const index = Math.min(attemptCount, BACKOFF_SECONDS.length - 1);
  return new Date(now.getTime() + BACKOFF_SECONDS[index] * 1_000);
}

export type EnqueueResult =
  | { readonly kind: "enqueued"; readonly deliveryId: number }
  | { readonly kind: "already_enqueued"; readonly deliveryId: number }
  | { readonly kind: "no_endpoint" }
  | { readonly kind: "unattributed" }
  | { readonly kind: "endpoint_disabled" }
  | { readonly kind: "template_unusable" }
  | { readonly kind: "conversion_not_found" };

/**
 * Build the macro values for one conversion.
 *
 * EVERY VALUE COMES FROM A ROW ATA OWNS. Nothing is derived from a request,
 * nothing from configuration, nothing from a clock read here. An absent fact is
 * the empty string — never `null`, never `undefined`, never the macro left in
 * place. See `template.ts`.
 */
function macroValues(conversion: {
  eventType: AffiliateConversionEventType;
  eventId: string;
  providerAmount: string | null;
  currencyCode: string | null;
  occurredAt: Date;
  campaignCodeSnapshot: string | null;
  trackingLinkPublicCodeSnapshot: string | null;
  selectedClick: {
    ataClickId: string;
    externalAffiliateClickId: string | null;
    sub1: string | null;
    sub2: string | null;
    sub3: string | null;
    sub4: string | null;
    sub5: string | null;
  } | null;
}): PostbackMacroValues {
  const click = conversion.selectedClick;
  return {
    event: POSTBACK_EVENT_NAMES[conversion.eventType],
    click_id: click?.ataClickId ?? "",
    external_click_id: click?.externalAffiliateClickId ?? "",
    sub1: click?.sub1 ?? "",
    sub2: click?.sub2 ?? "",
    sub3: click?.sub3 ?? "",
    sub4: click?.sub4 ?? "",
    sub5: click?.sub5 ?? "",
    // EMPTY FOR A REGISTRATION, which carries no money at all — and an empty
    // amount is the truth, where `0` would be a claim about a deposit that
    // never happened.
    amount: conversion.providerAmount ?? "",
    // EMPTY WHEN THE PROVIDER NEVER STATED ONE. Every deposit in this database
    // is currently in that state, and inventing `USD` here would be exactly the
    // fabrication §23 forbids.
    currency: conversion.currencyCode ?? "",
    event_time: conversion.occurredAt.toISOString(),
    conversion_id: conversion.eventId,
    campaign: conversion.campaignCodeSnapshot ?? "",
    link: conversion.trackingLinkPublicCodeSnapshot ?? "",
  };
}

/**
 * Create the logical delivery for one conversion, if the partner configured a
 * destination for its event type.
 */
export async function enqueueConversionPostback(
  db: PrismaClient,
  conversionEventId: number,
  now: Date = new Date(),
): Promise<EnqueueResult> {
  const conversion = await db.affiliateConversionEvent.findUnique({
    where: { id: conversionEventId },
    select: {
      id: true,
      eventId: true,
      eventType: true,
      affiliatePartnerId: true,
      providerAmount: true,
      currencyCode: true,
      occurredAt: true,
      campaignCodeSnapshot: true,
      trackingLinkPublicCodeSnapshot: true,
      selectedClick: {
        select: {
          ataClickId: true,
          externalAffiliateClickId: true,
          sub1: true,
          sub2: true,
          sub3: true,
          sub4: true,
          sub5: true,
        },
      },
    },
  });

  if (conversion === null) return { kind: "conversion_not_found" };
  // No partner, nothing to notify. A direct registration is the common case.
  if (conversion.affiliatePartnerId === null) return { kind: "unattributed" };

  const endpoint = await db.affiliatePostbackEndpoint.findUnique({
    where: {
      affiliatePartnerId_eventType: {
        affiliatePartnerId: conversion.affiliatePartnerId,
        eventType: conversion.eventType,
      },
    },
    select: { id: true, version: true, status: true, urlTemplate: true },
  });

  if (endpoint === null) return { kind: "no_endpoint" };
  // A disabled endpoint enqueues NOTHING. The alternative — enqueue and refuse
  // at delivery — would build a backlog that floods the partner's server the
  // moment they re-enable it.
  if (endpoint.status !== "active") return { kind: "endpoint_disabled" };

  const requestUrl = renderPostbackTemplate(endpoint.urlTemplate, macroValues(conversion));
  // The storage CHECK would refuse these anyway. Catching them here turns a
  // constraint violation into a named outcome the caller can record.
  if (requestUrl.length < 12 || requestUrl.length > 4096 || !requestUrl.startsWith("https://")) {
    return { kind: "template_unusable" };
  }

  try {
    const created = await db.affiliatePostbackDelivery.create({
      data: {
        publicId: randomBase32Id(),
        conversionEventId: conversion.id,
        endpointId: endpoint.id,
        endpointVersion: endpoint.version,
        affiliatePartnerId: conversion.affiliatePartnerId,
        eventType: conversion.eventType,
        status: "pending",
        maxAttempts: POSTBACK_MAX_ATTEMPTS,
        nextAttemptAt: nextAttemptAt(0, now),
        requestUrl,
      },
      select: { id: true },
    });
    return { kind: "enqueued", deliveryId: created.id };
  } catch (error) {
    // THE IDEMPOTENCY KEY DID ITS JOB. Two callers raced, or this ran twice.
    if (isDeliveryCollision(error)) {
      const existing = await db.affiliatePostbackDelivery.findUnique({
        where: {
          conversionEventId_endpointId_endpointVersion: {
            conversionEventId: conversion.id,
            endpointId: endpoint.id,
            endpointVersion: endpoint.version,
          },
        },
        select: { id: true },
      });
      if (existing !== null) return { kind: "already_enqueued", deliveryId: existing.id };
    }
    throw error;
  }
}

export function isDeliveryCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return false;
  const target = JSON.stringify(candidate.meta ?? {});
  return target.includes("conversionEventId") || target.includes("endpointVersion");
}

/**
 * Enqueue without failing the caller. The form every conversion path uses.
 */
export async function enqueueConversionPostbackSafely(
  conversionEventId: number,
  now: Date = new Date(),
  db: PrismaClient = prisma,
): Promise<EnqueueResult | { readonly kind: "failed" }> {
  try {
    return await enqueueConversionPostback(db, conversionEventId, now);
  } catch {
    return { kind: "failed" };
  }
}
