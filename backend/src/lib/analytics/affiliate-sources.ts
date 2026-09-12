/**
 * AFD-5B1 — the authoritative event source for every affiliate metric.
 *
 * ONE OWNER PER METRIC, NAMED HERE AND NOWHERE ELSE. Each metric below states
 * the table it counts, the column that carries its OWN occurrence time, and the
 * predicate that makes it that metric. Nothing derives an occurrence time from
 * `now()`, from `updatedAt`, or from a neighbouring event.
 *
 *   rawClicks               AffiliateClick                 occurredAt
 *   qualifiedClicks         AffiliateClick                 occurredAt   classification=qualified
 *   prefetchClicks          AffiliateClick                 occurredAt   classification=prefetch
 *   authenticatedUserClicks AffiliateClick                 occurredAt   classification=authenticated_user
 *   uniqueVisitors          AffiliateClick                 occurredAt   qualified, DISTINCT anonymousVisitorId
 *   academyRegistrations    AffiliateConversionEvent       occurredAt   eventType=academy_registration
 *   pocketRegistrations     PocketTraderIdentity           boundAt      source=registration_postback
 *   confirmedFirstDeposits  AffiliateConversionEvent       occurredAt   eventType=first_deposit
 *   pendingIdentityDeposits PocketProviderEvent            firstReceivedAt    status=pending_identity
 *   conflictingDeposits     PocketProviderEvent            conflictDetectedAt status=conflict
 *
 * WHY `PocketTraderIdentity.boundAt` IS THE POCKET-REGISTRATION OWNER, and why
 * nothing else was acceptable:
 *
 *   * It is written by exactly one function, the identity binder exported from
 *     `src/lib/exchange/pocketTraderIdentity.ts`, which uses `create` and NEVER
 *     `upsert` or `update`. There is no rebinding path in the application, so
 *     the value cannot move after the fact. (That module's own regression suite
 *     asserts the binder has exactly one caller, the Pocket postback route, so
 *     this file deliberately does not name the symbol.)
 *   * `source` is constrained by the DATABASE to the single literal
 *     `registration_postback`, so a row here cannot mean anything other than a
 *     trusted `goal=reg` binding. The predicate is still written out below
 *     rather than assumed, so the day a second provenance is added this query
 *     narrows instead of silently widening.
 *   * `updatedAt` is `@updatedAt` and therefore mutable — it is deliberately not
 *     used. `createdAt` would also work but `boundAt` is the column that NAMES
 *     the event, and a metric should read the field that means what it counts.
 *   * `ExchangeAccount.traderId` was rejected: it is nullable, non-unique and
 *     overwritten by every postback goal. L4PA-1 already established it is an
 *     attribution hint, not an authority.
 *   * L1 completion time was rejected: it is a curriculum fact that merely
 *     follows registration, and no contract makes the two identical.
 *
 * WHAT IS DELIBERATELY NOT COUNTED: referral-link creation, a CTA click, an
 * ExchangeAccount on its own, a rejected or conflicting postback, a replay
 * (`PocketProviderEvent.replayCount` is transport metadata and never money), a
 * redeposit, or any current balance.
 */
import { Prisma } from "@prisma/client";

export const ANALYTICS_MODE = "event_date";
export const RATE_MODE = "period_event_ratio";

export const METRIC_KEYS = [
  "rawClicks",
  "qualifiedClicks",
  "prefetchClicks",
  "authenticatedUserClicks",
  "uniqueVisitors",
  "academyRegistrations",
  "pocketRegistrations",
  "confirmedFirstDeposits",
  "pendingIdentityDeposits",
  "conflictingDeposits",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricCounts = Record<MetricKey, number>;

export const ZERO_COUNTS: MetricCounts = {
  rawClicks: 0,
  qualifiedClicks: 0,
  prefetchClicks: 0,
  authenticatedUserClicks: 0,
  uniqueVisitors: 0,
  academyRegistrations: 0,
  pocketRegistrations: 0,
  confirmedFirstDeposits: 0,
  pendingIdentityDeposits: 0,
  conflictingDeposits: 0,
};

/**
 * Which slice of a metric a query is asking for.
 *
 * `attributed` and `unattributed` partition `total` exactly, for every metric,
 * so the three always reconcile. A direct registration is NOT assigned to a
 * synthetic affiliate and no "organic" partner row exists — `unattributed` is a
 * reporting bucket, never a database entity.
 */
export type Coverage = "attributed" | "unattributed" | "total";

export type AnalyticsFilters = {
  readonly affiliatePartnerId?: number;
  readonly affiliateCampaignId?: number;
  readonly affiliateTrackingLinkId?: number;
};

export type StreamScope = {
  readonly coverage: Coverage;
  readonly filters: AnalyticsFilters;
  /** Inclusive. Null only for all-time, which has no historical cutoff. */
  readonly startUtc: Date | null;
  /** Exclusive, always present. */
  readonly endUtc: Date;
};

/**
 * A metric rendered as a uniform event stream.
 *
 * EVERY metric is reduced to the same five columns, which is what lets one
 * bucket-join, one summary count and one breakdown grouping serve all ten
 * instead of ten bespoke queries each:
 *
 *   t     the event's own occurrence time
 *   vid   the distinct key, for uniqueVisitors only; null elsewhere
 *   pid   affiliate partner id at acquisition, or null when unattributed
 *   cid   campaign id at acquisition, or null
 *   lid   tracking link id at acquisition, or null
 *   amt   canonical decimal amount, for confirmed first deposits only
 *   curst currency status, for confirmed first deposits only
 *   cur   currency code, for confirmed first deposits only
 *
 * The period bounds are folded INTO the stream rather than applied outside it,
 * so the index on (discriminator, time) drives the scan in every caller.
 */
export type EventStream = {
  readonly sql: Prisma.Sql;
  /** uniqueVisitors counts distinct `vid`; everything else counts rows. */
  readonly distinct: boolean;
};

function timeWindow(column: Prisma.Sql, scope: StreamScope): Prisma.Sql {
  const lower =
    scope.startUtc === null ? Prisma.empty : Prisma.sql`AND ${column} >= ${scope.startUtc}`;
  return Prisma.sql`${column} < ${scope.endUtc} ${lower}`;
}

/** Attributed means "this event carries an acquisition link"; the two are exclusive. */
function coverageClause(linkColumn: Prisma.Sql, coverage: Coverage): Prisma.Sql {
  switch (coverage) {
    case "attributed":
      return Prisma.sql`AND ${linkColumn} IS NOT NULL`;
    case "unattributed":
      return Prisma.sql`AND ${linkColumn} IS NULL`;
    case "total":
      return Prisma.empty;
  }
}

/**
 * Dimension filters, applied to whichever columns the metric resolved.
 *
 * A filtered report necessarily excludes unattributed events: they belong to no
 * affiliate, so they cannot appear in one affiliate's result. That is why the
 * unattributed slice is only ever reported when NO affiliate filter is set.
 */
function filterClause(
  partner: Prisma.Sql,
  campaign: Prisma.Sql,
  link: Prisma.Sql,
  filters: AnalyticsFilters,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filters.affiliatePartnerId !== undefined) {
    parts.push(Prisma.sql`AND ${partner} = ${filters.affiliatePartnerId}`);
  }
  if (filters.affiliateCampaignId !== undefined) {
    parts.push(Prisma.sql`AND ${campaign} = ${filters.affiliateCampaignId}`);
  }
  if (filters.affiliateTrackingLinkId !== undefined) {
    parts.push(Prisma.sql`AND ${link} = ${filters.affiliateTrackingLinkId}`);
  }
  return parts.length === 0 ? Prisma.empty : Prisma.join(parts, " ");
}

/* ------------------------------------------------------------ click stream */

const CLICK_CLASSIFICATION: Partial<Record<MetricKey, string>> = {
  qualifiedClicks: "qualified",
  prefetchClicks: "prefetch",
  authenticatedUserClicks: "authenticated_user",
};

/**
 * Clicks, joined to their link so a partner or campaign filter can apply.
 *
 * EVERY CLICK IS ATTRIBUTED, structurally: `AffiliateClick.trackingLinkId` is
 * NOT NULL, so a click cannot exist without a link. The unattributed slice of
 * any click metric is therefore always zero, and the coverage clause below says
 * so through the same rule as everything else rather than by a special case.
 */
function clickStream(metric: MetricKey, scope: StreamScope): EventStream {
  const classification = CLICK_CLASSIFICATION[metric];
  const classClause =
    classification === undefined
      ? Prisma.empty
      : Prisma.sql`AND c."classification" = ${classification}`;

  // uniqueVisitors is qualified-only and excludes null visitor ids: prefetch and
  // authenticated-user clicks carry no visitor journey by design, and counting
  // "unknown" as a visitor would invent traffic.
  const unique = metric === "uniqueVisitors";
  const uniqueClause = unique
    ? Prisma.sql`AND c."classification" = 'qualified' AND c."anonymousVisitorId" IS NOT NULL`
    : Prisma.empty;

  return {
    distinct: unique,
    sql: Prisma.sql`
      SELECT
        c."occurredAt"          AS "t",
        c."anonymousVisitorId"  AS "vid",
        l."affiliatePartnerId"  AS "pid",
        l."affiliateCampaignId" AS "cid",
        l."id"                  AS "lid",
        NULL                    AS "amt",
        NULL                    AS "curst",
        NULL                    AS "cur"
      FROM "AffiliateClick" c
      JOIN "AffiliateTrackingLink" l ON l."id" = c."trackingLinkId"
      WHERE ${timeWindow(Prisma.sql`c."occurredAt"`, scope)}
        ${classClause}
        ${uniqueClause}
        ${coverageClause(Prisma.sql`l."id"`, scope.coverage)}
        ${filterClause(
          Prisma.sql`l."affiliatePartnerId"`,
          Prisma.sql`l."affiliateCampaignId"`,
          Prisma.sql`l."id"`,
          scope.filters,
        )}
    `,
  };
}

/* ------------------------------------------------------- conversion stream */

/**
 * Academy registrations and confirmed first deposits.
 *
 * DIMENSIONS COME FROM THE ROW'S OWN IMMUTABLE SNAPSHOT, never from a join back
 * to the link. AFD-3B2 and AFD-4 both froze the affiliate, campaign and link on
 * the conversion at the moment it happened, precisely so a later rename, pause
 * or archive cannot rewrite history — and so a deposit is never reattributed to
 * whoever the learner clicked most recently.
 */
function conversionStream(
  eventType: "academy_registration" | "first_deposit",
  scope: StreamScope,
): EventStream {
  const money =
    eventType === "first_deposit"
      ? Prisma.sql`e."providerAmount" AS "amt", e."currencyStatus" AS "curst", e."currencyCode" AS "cur"`
      : Prisma.sql`NULL AS "amt", NULL AS "curst", NULL AS "cur"`;

  return {
    distinct: false,
    sql: Prisma.sql`
      SELECT
        e."occurredAt"          AS "t",
        NULL                    AS "vid",
        e."affiliatePartnerId"  AS "pid",
        e."affiliateCampaignId" AS "cid",
        e."trackingLinkId"      AS "lid",
        ${money}
      FROM "AffiliateConversionEvent" e
      WHERE e."eventType" = ${eventType}
        AND ${timeWindow(Prisma.sql`e."occurredAt"`, scope)}
        ${coverageClause(Prisma.sql`e."trackingLinkId"`, scope.coverage)}
        ${filterClause(
          Prisma.sql`e."affiliatePartnerId"`,
          Prisma.sql`e."affiliateCampaignId"`,
          Prisma.sql`e."trackingLinkId"`,
          scope.filters,
        )}
    `,
  };
}

/* -------------------------------------------- pocket registration stream */

/**
 * Trusted Pocket registrations.
 *
 * The dimension is the learner's FROZEN acquisition: identity → attribution →
 * the click that attribution selected → that click's link. Never a later click,
 * and never the link a learner happens to be associated with today.
 */
function pocketRegistrationStream(scope: StreamScope): EventStream {
  return {
    distinct: false,
    sql: Prisma.sql`
      SELECT
        i."boundAt"             AS "t",
        NULL                    AS "vid",
        l."affiliatePartnerId"  AS "pid",
        l."affiliateCampaignId" AS "cid",
        l."id"                  AS "lid",
        NULL                    AS "amt",
        NULL                    AS "curst",
        NULL                    AS "cur"
      FROM "PocketTraderIdentity" i
      LEFT JOIN "AffiliateAttribution" a ON a."userId" = i."userId"
      LEFT JOIN "AffiliateClick" sc      ON sc."id" = a."selectedClickId"
      LEFT JOIN "AffiliateTrackingLink" l ON l."id" = sc."trackingLinkId"
      WHERE i."source" = 'registration_postback'
        AND ${timeWindow(Prisma.sql`i."boundAt"`, scope)}
        ${coverageClause(Prisma.sql`l."id"`, scope.coverage)}
        ${filterClause(
          Prisma.sql`l."affiliatePartnerId"`,
          Prisma.sql`l."affiliateCampaignId"`,
          Prisma.sql`l."id"`,
          scope.filters,
        )}
    `,
  };
}

/* ------------------------------------------- provider deposit-event stream */

/**
 * Pending-identity and conflicting deposit events.
 *
 * OWNERSHIP IS RESOLVED CONSERVATIVELY. `matchedUserId` is used when the event
 * already has one. Otherwise the canonical `pocketClickId → ExchangeAccount →
 * user` chain is consulted — but ONLY when that click resolves to exactly one
 * account. `ExchangeAccount.clickId` is nullable and non-unique, so a value
 * shared by two accounts names no single learner; picking either one would
 * fabricate an affiliate, and joining both would double-count the event. The
 * `n = 1` guard in the derived table below is what makes an ambiguous owner stay
 * honestly unattributed.
 *
 * A pending event is, by definition, one whose owner is not yet known, so most
 * of these rows are expected to be unattributed. That is a fact worth reporting,
 * not a gap to paper over.
 */
function providerEventStream(
  status: "pending_identity" | "conflict",
  scope: StreamScope,
): EventStream {
  // Each status reads its OWN occurrence column: when the event first arrived,
  // versus when the disagreement was detected.
  const timeColumn =
    status === "pending_identity"
      ? Prisma.sql`e."firstReceivedAt"`
      : Prisma.sql`e."conflictDetectedAt"`;

  return {
    distinct: false,
    sql: Prisma.sql`
      SELECT
        ${timeColumn}           AS "t",
        NULL                    AS "vid",
        l."affiliatePartnerId"  AS "pid",
        l."affiliateCampaignId" AS "cid",
        l."id"                  AS "lid",
        NULL                    AS "amt",
        NULL                    AS "curst",
        NULL                    AS "cur"
      FROM "PocketProviderEvent" e
      LEFT JOIN (
        SELECT "clickId" AS "clickId", MIN("userId") AS "userId", COUNT(*) AS "n"
        FROM "ExchangeAccount"
        WHERE "clickId" IS NOT NULL
        GROUP BY "clickId"
      ) owner ON owner."clickId" = e."pocketClickId" AND owner."n" = 1
      LEFT JOIN "AffiliateAttribution" a
        ON a."userId" = COALESCE(e."matchedUserId", owner."userId")
      LEFT JOIN "AffiliateClick" sc      ON sc."id" = a."selectedClickId"
      LEFT JOIN "AffiliateTrackingLink" l ON l."id" = sc."trackingLinkId"
      WHERE e."provider" = 'pocket'
        AND e."eventType" = 'first_deposit'
        AND e."status" = ${status}
        AND ${timeColumn} IS NOT NULL
        AND ${timeWindow(timeColumn, scope)}
        ${coverageClause(Prisma.sql`l."id"`, scope.coverage)}
        ${filterClause(
          Prisma.sql`l."affiliatePartnerId"`,
          Prisma.sql`l."affiliateCampaignId"`,
          Prisma.sql`l."id"`,
          scope.filters,
        )}
    `,
  };
}

/** The one place a metric name becomes a query. */
export function buildEventStream(metric: MetricKey, scope: StreamScope): EventStream {
  switch (metric) {
    case "rawClicks":
    case "qualifiedClicks":
    case "prefetchClicks":
    case "authenticatedUserClicks":
    case "uniqueVisitors":
      return clickStream(metric, scope);
    case "academyRegistrations":
      return conversionStream("academy_registration", scope);
    case "confirmedFirstDeposits":
      return conversionStream("first_deposit", scope);
    case "pocketRegistrations":
      return pocketRegistrationStream(scope);
    case "pendingIdentityDeposits":
      return providerEventStream("pending_identity", scope);
    case "conflictingDeposits":
      return providerEventStream("conflict", scope);
  }
}
