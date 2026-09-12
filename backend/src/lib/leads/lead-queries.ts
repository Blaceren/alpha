/**
 * AFD-5B2B — the lead-list and lead-detail reads.
 *
 * SET-BASED AND BOUNDED. One page costs exactly TWO statements no matter how
 * many rows it returns and no matter how large the tables are: a narrow keyset
 * scan that decides WHICH leads, and one hydration that fills them in. There is
 * no per-lead journey query, no per-lead timeline query and no loop that issues
 * SQL — the query count is a constant of this module, which is what makes the
 * N+1 proof a matter of counting statements rather than of hoping.
 *
 * WHY TWO PHASES AND NOT ONE. Every journey fact a lead row carries — the Pocket
 * binding, the provider deposit event, the confirmed conversion, the duplicate
 * counts — is a correlated lookup. Computing them inside the ordered scan would
 * make SQLite evaluate them for every candidate row before sorting, so an
 * unfiltered list would pay for the whole table to answer for twenty-five rows.
 * Phase one touches only the columns the ORDER BY needs; phase two is keyed by
 * primary key on at most `limit + 1` rows.
 *
 * NO DYNAMIC SQL FROM A REQUEST. Sort columns and directions come from the
 * closed union in `lead-request.ts`; every date, id and limit arrives as a bound
 * parameter through a Prisma tagged template. `$queryRawUnsafe` and
 * `Prisma.raw` appear nowhere in this file.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";
import type { LeadListQuery, LeadSort } from "@/lib/leads/lead-request";
import { TRUSTED_POCKET_IDENTITY_SOURCE } from "@/lib/leads/lead-state";

/* Row shapes are NAMED, never written inline: the raw-SQL auditor refuses to
 * parse a type-argument list containing `;`, and an unclassifiable call site
 * fails the gate even when it is perfectly parameter-bound. */
type KeyRow = { id: unknown; sv: unknown; nb: unknown };
type LeadRow = {
  id: unknown;
  eventId: unknown;
  registeredAt: unknown;
  email: unknown;
  name: unknown;
  attributionId: unknown;
  selectedAt: unknown;
  frozenAt: unknown;
  attributionModel: unknown;
  selectionReason: unknown;
  firstTouchAt: unknown;
  lastTouchAt: unknown;
  selectedTouchAt: unknown;
  firstTouchLinkId: unknown;
  lastTouchLinkId: unknown;
  selectedTouchLinkId: unknown;
  firstTouchClickRef: unknown;
  lastTouchClickRef: unknown;
  selectedClickRef: unknown;
  partnerId: unknown;
  partnerCode: unknown;
  partnerName: unknown;
  partnerStatus: unknown;
  campaignId: unknown;
  campaignCode: unknown;
  campaignName: unknown;
  campaignStatus: unknown;
  linkId: unknown;
  linkPublicCode: unknown;
  linkName: unknown;
  linkStatus: unknown;
  affiliateCodeSnapshot: unknown;
  campaignCodeSnapshot: unknown;
  linkCodeSnapshot: unknown;
  pocketBoundAt: unknown;
  pocketSource: unknown;
  fdAt: unknown;
  fdAmount: unknown;
  fdCurrency: unknown;
  fdCurrencyStatus: unknown;
  ppeStatus: unknown;
  ppeFirstReceivedAt: unknown;
  ppeConflictAt: unknown;
  ppeMatchedAt: unknown;
  ppeConflictCode: unknown;
  ppeReplayCount: unknown;
  regCount: unknown;
  fdCount: unknown;
  ppeCount: unknown;
};

/**
 * The database handle. Injected so a suite can drive a throwaway file.
 *
 * Spelled as the canonical union rather than as a `Pick` of the raw-query
 * method: the auditor classifies call SHAPES textually, and naming the method
 * in a type position produces a call site it cannot parse and therefore refuses.
 */
export type LeadDb = PrismaClient | Prisma.TransactionClient;

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  throw new TypeError("unexpected numeric shape from the lead query");
}

/** SQLite hands DateTime back as either a Date or integer milliseconds. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "bigint" || typeof value === "number") return new Date(Number(value));
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/* ------------------------------------------------------- shared predicates */

/**
 * The lead population itself, stated once.
 *
 * A LEAD IS AN `academy_registration` CONVERSION EVENT — not a User row, not an
 * enrollment, not a session and not an ExchangeAccount. Staff, seeds and
 * administratively created accounts never pass through the public registration
 * owner and therefore have no such event, so they are excluded by the
 * population's own definition rather than by an exclusion list somebody has to
 * remember to maintain.
 */
const POPULATION = Prisma.sql`e."eventType" = 'academy_registration'`;

/**
 * ONE LEAD PER LEARNER, EVEN WHEN THE LEDGER HOLDS TWO ROWS.
 *
 * §12 defines a lead as a learner with EXACTLY ONE `academy_registration`
 * event, and the ledger's unique key makes a second one unreachable through the
 * supported path. "Unreachable" is not "impossible", though, and the failure
 * mode if one ever appears is the worst kind: the same learner would occupy two
 * positions in every page, be counted twice in every filter, and carry two
 * different lead references that an operator would have no way to tell apart.
 *
 * The canonical row is the LOWEST id — the one written first, and therefore the
 * registration that actually happened; a later duplicate cannot displace it by
 * claiming an earlier `occurredAt`. The extra rows do not vanish silently: the
 * survivor carries the `duplicate_academy_registration` integrity flag, so the
 * anomaly is reported on exactly one lead instead of manufacturing a second.
 */
const CANONICAL_REGISTRATION = Prisma.sql`
  e."id" = (
    SELECT MIN(ce."id") FROM "AffiliateConversionEvent" ce
    WHERE ce."userId" = e."userId" AND ce."eventType" = 'academy_registration'
  )`;

/** The complete population predicate: the right event type, and the right row. */
const LEAD_ROWS = Prisma.sql`${POPULATION} AND ${CANONICAL_REGISTRATION}`;

/** The trusted Pocket binding, judged on `source` exactly as AFD-5B1 does. */
const TRUSTED_IDENTITY = Prisma.sql`
  EXISTS (
    SELECT 1 FROM "PocketTraderIdentity" ti
    WHERE ti."userId" = e."userId" AND ti."source" = ${TRUSTED_POCKET_IDENTITY_SOURCE}
  )`;

/** The ledger's own statement that a first deposit was counted for this lead. */
const CONFIRMED_DEPOSIT = Prisma.sql`
  EXISTS (
    SELECT 1 FROM "AffiliateConversionEvent" fx
    WHERE fx."userId" = e."userId" AND fx."eventType" = 'first_deposit'
  )`;

/**
 * The ONE provider deposit event this lead owns, chosen deterministically.
 *
 * TWO AUTHORITIES, NEITHER OF THEM A GUESS. `matchedUserId` is AFD-4's own
 * conclusion about who a deposit belongs to. The second arm reaches the rows
 * that conclusion has not been drawn for yet — a deposit that arrived before
 * the registration that would name its owner — through the TRUSTED identity
 * binding, which is the same join `convergePendingEvent` itself uses to decide
 * ownership. It is not an inference from a click, a balance or a name.
 *
 * A row that can be reached by NEITHER arm belongs to nobody and stays that
 * way: this phase will not invent an owner for it.
 */
const TRUSTED_PLAYER = Prisma.sql`(
  SELECT ti2."pocketUserId" FROM "PocketTraderIdentity" ti2
  WHERE ti2."userId" = e."userId" AND ti2."source" = ${TRUSTED_POCKET_IDENTITY_SOURCE}
)`;

/**
 * TWO ARMS, COALESCED — NOT ONE ARM WITH AN `OR`.
 *
 * The obvious spelling of this is a single query whose WHERE is
 * `matchedUserId = ? OR pocketPlayerId IN (...)`. It is also the wrong one, and
 * the query-plan suite is what proved it: SQLite cannot use its multi-index OR
 * optimisation once that predicate is wrapped in `ORDER BY ... LIMIT 1`, so the
 * subquery degenerates to `SCAN PocketProviderEvent` — a FULL TABLE SCAN
 * evaluated once per candidate lead. That is the exact shape §32 exists to
 * refuse, and no index could have fixed it because the problem was the OR, not
 * a missing index.
 *
 * Split, each arm seeks: the first on `@@index([matchedUserId])`, the second on
 * the `@@unique([provider, eventType, pocketPlayerId])` key — which is why
 * `provider` is named explicitly rather than left to the column default.
 *
 * COALESCE ALSO FIXES THE TIE. The matched arm wins whenever it has a row,
 * which is the right precedence rather than an arbitrary one: `matchedUserId`
 * is AFD-4's own conclusion about who a deposit belongs to, and the identity arm
 * exists only to reach the rows that conclusion has not been drawn for yet. When
 * both arms hit they hit the SAME row anyway — a matched event's player is, by
 * the reconciliation contract, the player its learner is bound to.
 */
const OWNED_PROVIDER_EVENT_ID = Prisma.sql`COALESCE(
  (SELECT pm."id" FROM "PocketProviderEvent" pm
    WHERE pm."eventType" = 'first_deposit' AND pm."matchedUserId" = e."userId"
    ORDER BY pm."firstReceivedAt" ASC, pm."id" ASC LIMIT 1),
  (SELECT pi."id" FROM "PocketProviderEvent" pi
    WHERE pi."provider" = 'pocket' AND pi."eventType" = 'first_deposit'
      AND pi."pocketPlayerId" = ${TRUSTED_PLAYER}
    ORDER BY pi."firstReceivedAt" ASC, pi."id" ASC LIMIT 1)
)`;

/**
 * How many provider deposit events resolve to this lead, for the integrity
 * flag. Split for the same planner reason, and the second arm excludes the
 * rows the first already counted so one event is never counted twice.
 */
const OWNED_PROVIDER_EVENT_COUNT = Prisma.sql`(
  (SELECT COUNT(*) FROM "PocketProviderEvent" cm
    WHERE cm."eventType" = 'first_deposit' AND cm."matchedUserId" = e."userId")
  +
  (SELECT COUNT(*) FROM "PocketProviderEvent" ci
    WHERE ci."provider" = 'pocket' AND ci."eventType" = 'first_deposit'
      AND ci."pocketPlayerId" = ${TRUSTED_PLAYER}
      AND (ci."matchedUserId" IS NULL OR ci."matchedUserId" <> e."userId"))
)`;

/**
 * The join phase one needs for the acquisition dimension.
 *
 * Read from the FROZEN attribution and its click relationships. Nothing here
 * recomputes a selection, consults a cookie or looks at a click that was not
 * already named by `AffiliateAttribution`.
 */
const ACQUISITION_JOIN = Prisma.sql`
  LEFT JOIN "AffiliateAttribution" a ON a."id" = e."attributionId"
  LEFT JOIN "AffiliateClick" sc ON sc."id" = a."selectedClickId"`;

function filterClauses(query: {
  filters: AnalyticsFilters;
  attributionState: LeadListQuery["attributionState"];
  journeyStage: LeadListQuery["journeyStage"];
  depositState: LeadListQuery["depositState"];
  registrationPeriod: LeadListQuery["registrationPeriod"];
  acquisitionPeriod: LeadListQuery["acquisitionPeriod"];
}): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [LEAD_ROWS];

  if (query.filters.affiliatePartnerId !== undefined) {
    clauses.push(Prisma.sql`e."affiliatePartnerId" = ${query.filters.affiliatePartnerId}`);
  }
  if (query.filters.affiliateCampaignId !== undefined) {
    clauses.push(Prisma.sql`e."affiliateCampaignId" = ${query.filters.affiliateCampaignId}`);
  }
  if (query.filters.affiliateTrackingLinkId !== undefined) {
    clauses.push(Prisma.sql`e."trackingLinkId" = ${query.filters.affiliateTrackingLinkId}`);
  }

  if (query.attributionState === "attributed") {
    clauses.push(Prisma.sql`e."attributionId" IS NOT NULL`);
  } else if (query.attributionState === "unattributed") {
    clauses.push(Prisma.sql`e."attributionId" IS NULL`);
  }

  // The stage filter is expressed as the SAME ladder `deriveLeadState` walks,
  // so a row can never be listed under one stage and detailed under another.
  if (query.journeyStage === "first_deposit_confirmed") {
    clauses.push(CONFIRMED_DEPOSIT);
  } else if (query.journeyStage === "pocket_registered") {
    clauses.push(Prisma.sql`NOT ${CONFIRMED_DEPOSIT} AND ${TRUSTED_IDENTITY}`);
  } else if (query.journeyStage === "academy_registered") {
    clauses.push(Prisma.sql`NOT ${CONFIRMED_DEPOSIT} AND NOT ${TRUSTED_IDENTITY}`);
  }

  if (query.depositState !== null) {
    // THE SAME LADDER `deriveDepositState` WALKS, expressed once in SQL. If the
    // two ever disagreed a lead would be listed under one deposit state and
    // detailed under another, so the CASE below mirrors that function exactly:
    // a detected conflict outranks a match, and `none` is the absent row.
    const state = Prisma.sql`(
      SELECT CASE
        WHEN pe2."status" = 'conflict' OR pe2."conflictDetectedAt" IS NOT NULL THEN 'conflict'
        WHEN pe2."status" = 'matched' THEN 'confirmed'
        ELSE 'pending_identity'
      END
      FROM "PocketProviderEvent" pe2 WHERE pe2."id" = ${OWNED_PROVIDER_EVENT_ID})`;
    clauses.push(
      query.depositState === "none"
        ? Prisma.sql`${state} IS NULL`
        : Prisma.sql`${state} = ${query.depositState}`,
    );
  }

  if (query.registrationPeriod !== null) {
    const period = query.registrationPeriod;
    if (period.startUtc !== null) {
      clauses.push(Prisma.sql`e."occurredAt" >= ${period.startUtc}`);
    }
    clauses.push(Prisma.sql`e."occurredAt" < ${period.endUtc}`);
  }

  // The acquisition window names the SELECTED click and therefore matches only
  // attributed leads. A direct lead has no acquisition instant, and giving it a
  // synthetic one would put it inside somebody's affiliate report.
  if (query.acquisitionPeriod !== null) {
    const period = query.acquisitionPeriod;
    clauses.push(Prisma.sql`sc."occurredAt" IS NOT NULL`);
    if (period.startUtc !== null) {
      clauses.push(Prisma.sql`sc."occurredAt" >= ${period.startUtc}`);
    }
    clauses.push(Prisma.sql`sc."occurredAt" < ${period.endUtc}`);
  }

  return clauses;
}

function joinAnd(clauses: Prisma.Sql[]): Prisma.Sql {
  return clauses.reduce((left, right) => Prisma.sql`${left} AND ${right}`);
}

/* ------------------------------------------------------------------- sorts */

type SortSpec = {
  /** The ordered value. Null-capable for every sort except registration. */
  readonly value: Prisma.Sql;
  readonly descending: boolean;
  readonly nullable: boolean;
};

/**
 * The sort vocabulary, resolved to SQL exactly once.
 *
 * NULLS ALWAYS SORT LAST, in both directions. SQLite's own default puts them
 * first ascending and last descending, which would mean reversing the direction
 * silently moved every direct lead from one end of the list to the other. A
 * leading bucket expression pins them, so "no acquisition" means the same thing
 * whichever way the operator sorts.
 */
function sortSpec(sort: LeadSort): SortSpec {
  switch (sort) {
    case "registration_desc":
      return { value: Prisma.sql`e."occurredAt"`, descending: true, nullable: false };
    case "registration_asc":
      return { value: Prisma.sql`e."occurredAt"`, descending: false, nullable: false };
    case "acquisition_desc":
      return { value: Prisma.sql`sc."occurredAt"`, descending: true, nullable: true };
    case "acquisition_asc":
      return { value: Prisma.sql`sc."occurredAt"`, descending: false, nullable: true };
    case "pocket_registration_desc":
      return {
        value: Prisma.sql`(SELECT ti3."boundAt" FROM "PocketTraderIdentity" ti3
          WHERE ti3."userId" = e."userId" AND ti3."source" = ${TRUSTED_POCKET_IDENTITY_SOURCE})`,
        descending: true,
        nullable: true,
      };
    case "first_deposit_desc":
      return {
        value: Prisma.sql`(SELECT MIN(fd3."occurredAt") FROM "AffiliateConversionEvent" fd3
          WHERE fd3."userId" = e."userId" AND fd3."eventType" = 'first_deposit')`,
        descending: true,
        nullable: true,
      };
  }
}

/**
 * The keyset predicate that resumes after a cursor.
 *
 * THE NULL BUCKET IS BRANCHED, NOT EXPRESSED IN SQL. Once the cursor sits in
 * the null bucket every comparison against its (absent) sort value is itself
 * NULL, so `value < cursorValue` would be neither true nor false and the scan
 * would never advance. The branch is chosen from the DECODED cursor's own flag
 * — a server-side boolean, never a request string — so both arms stay fully
 * parameter-bound.
 */
function keysetClause(spec: SortSpec, cursor: NonNullable<LeadListQuery["cursor"]>): Prisma.Sql {
  const bucket = Prisma.sql`(CASE WHEN ${spec.value} IS NULL THEN 1 ELSE 0 END)`;

  if (cursor.nullBucket) {
    // Already past every non-null row: only later ids in the same bucket remain.
    return Prisma.sql`${bucket} = 1 AND e."id" < ${cursor.rowId}`;
  }

  const value = cursor.sortValue as Date;
  const beyond = spec.descending
    ? Prisma.sql`${spec.value} < ${value}`
    : Prisma.sql`${spec.value} > ${value}`;

  const tail = spec.nullable ? Prisma.sql` OR ${bucket} = 1` : Prisma.empty;

  return Prisma.sql`(
    ${beyond}
    OR (${spec.value} = ${value} AND e."id" < ${cursor.rowId})
    ${tail}
  )`;
}

function orderClause(spec: SortSpec): Prisma.Sql {
  // `e."id"` is the tie breaker for EVERY sort and always descending, so two
  // leads registered in the same millisecond have one fixed relative order and
  // a page boundary can never fall between them twice.
  const direction = spec.descending ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  if (!spec.nullable) {
    return Prisma.sql`ORDER BY ${spec.value} ${direction}, e."id" DESC`;
  }
  return Prisma.sql`ORDER BY (CASE WHEN ${spec.value} IS NULL THEN 1 ELSE 0 END) ASC,
    ${spec.value} ${direction}, e."id" DESC`;
}

/* ------------------------------------------------------------ phase 1: keys */

export type LeadKey = {
  readonly rowId: number;
  readonly sortValue: Date | null;
  readonly nullBucket: boolean;
};

/**
 * Decide which leads this page contains, reading only the ordering columns.
 *
 * `limit + 1` rows are fetched so `hasMore` is answered without a COUNT. An
 * exact total over an unbounded lead population would be a second full scan on
 * every page for a number an operator cannot act on; the extra row costs one
 * index step.
 */
export async function loadLeadKeys(db: LeadDb, query: LeadListQuery): Promise<LeadKey[]> {
  const spec = sortSpec(query.sort);
  const clauses = filterClauses(query);
  if (query.cursor !== null) clauses.push(keysetClause(spec, query.cursor));

  const rows = await db.$queryRaw<KeyRow[]>(Prisma.sql`
    SELECT e."id" AS "id",
           ${spec.value} AS "sv",
           (CASE WHEN ${spec.value} IS NULL THEN 1 ELSE 0 END) AS "nb"
    FROM "AffiliateConversionEvent" e
    ${ACQUISITION_JOIN}
    WHERE ${joinAnd(clauses)}
    ${orderClause(spec)}
    LIMIT ${query.limit + 1}
  `);

  return rows.map((row) => ({
    rowId: toNumber(row.id),
    sortValue: toDate(row.sv),
    nullBucket: toNumber(row.nb) === 1,
  }));
}

/* ------------------------------------------------- phase 2: the lead facts */

/** Every stored fact one lead row is built from. Nothing here is derived. */
export type LeadFacts = {
  readonly rowId: number;
  readonly eventId: string;
  readonly registeredAt: Date;
  readonly email: string;
  readonly displayName: string | null;
  readonly attributed: boolean;
  readonly selectedAt: Date | null;
  readonly frozenAt: Date | null;
  readonly attributionModel: string | null;
  readonly selectionReason: string | null;
  readonly firstTouchAt: Date | null;
  readonly lastTouchAt: Date | null;
  readonly selectedTouchAt: Date | null;
  readonly firstTouchLinkId: number | null;
  readonly lastTouchLinkId: number | null;
  readonly selectedTouchLinkId: number | null;
  /**
   * INTERNAL ONLY — the frozen click row ids, loaded so the timeline can tell
   * whether first, last and selected touch are ONE click occurrence or three.
   * §21 requires that deduplication and there is no other way to know.
   *
   * These are never serialized. `lead-dto.ts` has no field that carries them,
   * and the redaction suite asserts no response body contains them.
   */
  readonly firstTouchClickRef: number | null;
  readonly lastTouchClickRef: number | null;
  readonly selectedClickRef: number | null;
  readonly partner: { id: number; code: string; displayName: string; status: string } | null;
  readonly campaign: { id: number; code: string; displayName: string; status: string } | null;
  readonly trackingLink: {
    id: number;
    publicCode: string;
    displayName: string;
    status: string;
  } | null;
  readonly affiliateCodeSnapshot: string | null;
  readonly campaignCodeSnapshot: string | null;
  readonly trackingLinkCodeSnapshot: string | null;
  readonly pocketBoundAt: Date | null;
  readonly pocketSource: string | null;
  readonly firstDepositAt: Date | null;
  readonly firstDepositAmount: string | null;
  readonly firstDepositCurrency: string | null;
  readonly firstDepositCurrencyStatus: string | null;
  readonly providerStatus: string | null;
  readonly providerFirstReceivedAt: Date | null;
  readonly providerConflictDetectedAt: Date | null;
  readonly providerMatchedAt: Date | null;
  readonly providerConflictCode: string | null;
  readonly providerReplayCount: number;
  readonly academyRegistrationCount: number;
  readonly firstDepositConversionCount: number;
  readonly providerEventCount: number;
};

/**
 * The full projection, applied to an already-decided set of rows.
 *
 * WHAT IS DELIBERATELY NOT SELECTED. There is no `AffiliateClick.ataClickId`,
 * no `anonymousVisitorId`, no `externalAffiliateClickId`, no `sub1`..`sub5`, no
 * `PocketProviderEvent.pocketClickId`, no `pocketPlayerId`, no
 * `PocketTraderIdentity.clickId`, no password material, no IP and no
 * User-Agent. They are absent from the SELECT list, so no serializer downstream
 * can leak one by accident — the values never enter the process.
 *
 * The User id is loaded ONLY as the join key `e."userId"` and is never
 * projected: `LeadFacts` has no field to carry it.
 */
const LEAD_PROJECTION = Prisma.sql`
  SELECT
    e."id"                AS "id",
    e."eventId"           AS "eventId",
    e."occurredAt"        AS "registeredAt",
    u."email"             AS "email",
    u."name"              AS "name",
    e."attributionId"     AS "attributionId",
    a."selectedAt"        AS "selectedAt",
    a."frozenAt"          AS "frozenAt",
    a."attributionModel"  AS "attributionModel",
    a."selectionReason"   AS "selectionReason",
    fc."occurredAt"       AS "firstTouchAt",
    lc."occurredAt"       AS "lastTouchAt",
    sc."occurredAt"       AS "selectedTouchAt",
    fc."trackingLinkId"   AS "firstTouchLinkId",
    lc."trackingLinkId"   AS "lastTouchLinkId",
    sc."trackingLinkId"   AS "selectedTouchLinkId",
    a."firstTouchClickId" AS "firstTouchClickRef",
    a."lastTouchClickId"  AS "lastTouchClickRef",
    a."selectedClickId"   AS "selectedClickRef",
    p."id"                AS "partnerId",
    p."code"              AS "partnerCode",
    p."displayName"       AS "partnerName",
    p."status"            AS "partnerStatus",
    c."id"                AS "campaignId",
    c."code"              AS "campaignCode",
    c."displayName"       AS "campaignName",
    c."status"            AS "campaignStatus",
    tl."id"               AS "linkId",
    tl."publicCode"       AS "linkPublicCode",
    tl."displayName"      AS "linkName",
    tl."status"           AS "linkStatus",
    e."affiliateCodeSnapshot"          AS "affiliateCodeSnapshot",
    e."campaignCodeSnapshot"           AS "campaignCodeSnapshot",
    e."trackingLinkPublicCodeSnapshot" AS "linkCodeSnapshot",
    ti."boundAt"          AS "pocketBoundAt",
    ti."source"           AS "pocketSource",
    fd."occurredAt"       AS "fdAt",
    fd."providerAmount"   AS "fdAmount",
    fd."currencyCode"     AS "fdCurrency",
    fd."currencyStatus"   AS "fdCurrencyStatus",
    pe."status"             AS "ppeStatus",
    pe."firstReceivedAt"    AS "ppeFirstReceivedAt",
    pe."conflictDetectedAt" AS "ppeConflictAt",
    pe."matchedAt"          AS "ppeMatchedAt",
    pe."conflictCode"       AS "ppeConflictCode",
    pe."replayCount"        AS "ppeReplayCount",
    (SELECT COUNT(*) FROM "AffiliateConversionEvent" rc
      WHERE rc."userId" = e."userId" AND rc."eventType" = 'academy_registration') AS "regCount",
    (SELECT COUNT(*) FROM "AffiliateConversionEvent" dc
      WHERE dc."userId" = e."userId" AND dc."eventType" = 'first_deposit') AS "fdCount",
    ${OWNED_PROVIDER_EVENT_COUNT} AS "ppeCount"
  FROM "AffiliateConversionEvent" e
  JOIN "User" u ON u."id" = e."userId"
  LEFT JOIN "AffiliateAttribution" a ON a."id" = e."attributionId"
  LEFT JOIN "AffiliateClick" fc ON fc."id" = a."firstTouchClickId"
  LEFT JOIN "AffiliateClick" lc ON lc."id" = a."lastTouchClickId"
  LEFT JOIN "AffiliateClick" sc ON sc."id" = a."selectedClickId"
  LEFT JOIN "AffiliatePartner" p ON p."id" = e."affiliatePartnerId"
  LEFT JOIN "AffiliateCampaign" c ON c."id" = e."affiliateCampaignId"
  LEFT JOIN "AffiliateTrackingLink" tl ON tl."id" = e."trackingLinkId"
  LEFT JOIN "PocketTraderIdentity" ti ON ti."userId" = e."userId"
  LEFT JOIN "AffiliateConversionEvent" fd ON fd."id" = (
    SELECT fd2."id" FROM "AffiliateConversionEvent" fd2
    WHERE fd2."userId" = e."userId" AND fd2."eventType" = 'first_deposit'
    ORDER BY fd2."occurredAt" ASC, fd2."id" ASC LIMIT 1
  )
  LEFT JOIN "PocketProviderEvent" pe ON pe."id" = ${OWNED_PROVIDER_EVENT_ID}`;

function toFacts(row: LeadRow): LeadFacts {
  const partnerId = row.partnerId === null ? null : toNumber(row.partnerId);
  const campaignId = row.campaignId === null ? null : toNumber(row.campaignId);
  const linkId = row.linkId === null ? null : toNumber(row.linkId);

  return {
    rowId: toNumber(row.id),
    eventId: String(row.eventId),
    registeredAt: toDate(row.registeredAt) as Date,
    email: String(row.email),
    displayName: toText(row.name),
    attributed: row.attributionId !== null && row.attributionId !== undefined,
    selectedAt: toDate(row.selectedAt),
    frozenAt: toDate(row.frozenAt),
    attributionModel: toText(row.attributionModel),
    selectionReason: toText(row.selectionReason),
    firstTouchAt: toDate(row.firstTouchAt),
    lastTouchAt: toDate(row.lastTouchAt),
    selectedTouchAt: toDate(row.selectedTouchAt),
    firstTouchLinkId: row.firstTouchLinkId === null ? null : toNumber(row.firstTouchLinkId),
    lastTouchLinkId: row.lastTouchLinkId === null ? null : toNumber(row.lastTouchLinkId),
    selectedTouchLinkId:
      row.selectedTouchLinkId === null ? null : toNumber(row.selectedTouchLinkId),
    firstTouchClickRef: row.firstTouchClickRef === null ? null : toNumber(row.firstTouchClickRef),
    lastTouchClickRef: row.lastTouchClickRef === null ? null : toNumber(row.lastTouchClickRef),
    selectedClickRef: row.selectedClickRef === null ? null : toNumber(row.selectedClickRef),
    partner:
      partnerId === null
        ? null
        : {
            id: partnerId,
            code: String(row.partnerCode),
            displayName: String(row.partnerName),
            status: String(row.partnerStatus),
          },
    campaign:
      campaignId === null
        ? null
        : {
            id: campaignId,
            code: String(row.campaignCode),
            displayName: String(row.campaignName),
            status: String(row.campaignStatus),
          },
    trackingLink:
      linkId === null
        ? null
        : {
            id: linkId,
            publicCode: String(row.linkPublicCode),
            displayName: String(row.linkName),
            status: String(row.linkStatus),
          },
    affiliateCodeSnapshot: toText(row.affiliateCodeSnapshot),
    campaignCodeSnapshot: toText(row.campaignCodeSnapshot),
    trackingLinkCodeSnapshot: toText(row.linkCodeSnapshot),
    pocketBoundAt: toDate(row.pocketBoundAt),
    pocketSource: toText(row.pocketSource),
    firstDepositAt: toDate(row.fdAt),
    firstDepositAmount: toText(row.fdAmount),
    firstDepositCurrency: toText(row.fdCurrency),
    firstDepositCurrencyStatus: toText(row.fdCurrencyStatus),
    providerStatus: toText(row.ppeStatus),
    providerFirstReceivedAt: toDate(row.ppeFirstReceivedAt),
    providerConflictDetectedAt: toDate(row.ppeConflictAt),
    providerMatchedAt: toDate(row.ppeMatchedAt),
    providerConflictCode: toText(row.ppeConflictCode),
    providerReplayCount: row.ppeReplayCount === null ? 0 : toNumber(row.ppeReplayCount),
    academyRegistrationCount: toNumber(row.regCount),
    firstDepositConversionCount: toNumber(row.fdCount),
    providerEventCount: toNumber(row.ppeCount),
  };
}

/**
 * Hydrate an already-decided page.
 *
 * The caller's key order is restored here rather than re-sorted in SQL: phase
 * one already decided the ordering, and asking the database to reproduce it
 * would be a second chance to disagree with itself.
 */
export async function loadLeadFacts(db: LeadDb, rowIds: number[]): Promise<LeadFacts[]> {
  if (rowIds.length === 0) return [];

  const rows = await db.$queryRaw<LeadRow[]>(Prisma.sql`
    ${LEAD_PROJECTION}
    WHERE e."id" IN (${Prisma.join(rowIds)})
  `);

  const byId = new Map<number, LeadFacts>();
  for (const row of rows) {
    const facts = toFacts(row);
    byId.set(facts.rowId, facts);
  }
  return rowIds.map((id) => byId.get(id)).filter((value): value is LeadFacts => value !== undefined);
}

/**
 * One lead, by its stored conversion `eventId`.
 *
 * The population predicate is applied HERE as well as in the list. A
 * `first_deposit` event id handed to this route must not resolve: it is a real
 * `eventId`, but it is not a lead, and answering for it would make the
 * population definition depend on which route you asked.
 */
export async function loadLeadByEventId(db: LeadDb, eventId: string): Promise<LeadFacts | null> {
  const rows = await db.$queryRaw<LeadRow[]>(Prisma.sql`
    ${LEAD_PROJECTION}
    WHERE ${LEAD_ROWS} AND e."eventId" = ${eventId}
    LIMIT 1
  `);
  return rows.length === 0 ? null : toFacts(rows[0]);
}
