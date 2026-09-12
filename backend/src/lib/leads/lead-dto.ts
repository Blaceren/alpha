/**
 * AFD-5B2B — the wire shapes.
 *
 * ONE PLACE DECIDES WHAT LEAVES THE PROCESS. Every field a lead response can
 * carry is written out below, so "does this endpoint leak an email" is answered
 * by reading one file rather than by auditing three routes. The builders take
 * `LeadFacts` — which already has no User id, no click id and no Pocket
 * identifier on it — so the dangerous values are absent two layers before
 * serialization rather than filtered out at the last moment.
 */
import { redactedIdentity, toLeadId, type RedactedLeadIdentity } from "@/lib/leads/lead-identity";
import type { LeadFacts } from "@/lib/leads/lead-queries";
import {
  buildLeadTimeline,
  type LeadTimeline,
} from "@/lib/leads/lead-timeline";
import {
  deriveLeadState,
  orderFlags,
  type LeadDepositState,
  type LeadIntegrityFlag,
  type LeadJourneyStage,
} from "@/lib/leads/lead-state";

/* ------------------------------------------------------ acquisition summary */

/**
 * The acquisition dimension as an operator may see it.
 *
 * `code` IS THE CONVERSION-TIME SNAPSHOT and `displayName` is the current
 * label. That split is deliberate and it is the whole point of AFD-3B2 storing
 * both: renaming or archiving an affiliate must not rewrite which code acquired
 * a learner last quarter, while a UI still needs a human name that exists
 * today. When a snapshot is somehow absent the current code is used and the
 * lead carries no extra claim — never a fabricated one.
 */
export type LeadDimensionSummary = {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
};

export type LeadAcquisitionSummary =
  | {
      readonly attributionState: "attributed";
      readonly affiliate: LeadDimensionSummary;
      readonly campaign: LeadDimensionSummary | null;
      readonly trackingLink: LeadDimensionSummary | null;
      readonly firstTouchAt: string | null;
      readonly lastTouchAt: string | null;
      readonly selectedTouchAt: string | null;
      readonly acquisitionModel: string | null;
      readonly selectionReason: string | null;
      readonly frozenAt: string | null;
    }
  | {
      readonly attributionState: "unattributed";
      readonly affiliate: null;
      readonly campaign: null;
      readonly trackingLink: null;
      readonly firstTouchAt: null;
      readonly lastTouchAt: null;
      readonly selectedTouchAt: null;
      readonly acquisitionModel: null;
      readonly selectionReason: null;
      readonly frozenAt: null;
    };

const DIRECT_ACQUISITION: LeadAcquisitionSummary = {
  attributionState: "unattributed",
  affiliate: null,
  campaign: null,
  trackingLink: null,
  firstTouchAt: null,
  lastTouchAt: null,
  selectedTouchAt: null,
  acquisitionModel: null,
  selectionReason: null,
  frozenAt: null,
};

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/**
 * A DIRECT LEAD IS NOT ASSIGNED TO A SYNTHETIC AFFILIATE. It reports
 * `unattributed` with every acquisition field null. Inventing a "(direct)"
 * partner would put organic signups inside somebody's payout report, and
 * hiding direct leads entirely would make the denominator of every affiliate
 * rate wrong.
 */
export function buildAcquisitionSummary(facts: LeadFacts): LeadAcquisitionSummary {
  if (!facts.attributed || facts.partner === null) return DIRECT_ACQUISITION;

  return {
    attributionState: "attributed",
    affiliate: {
      id: String(facts.partner.id),
      code: facts.affiliateCodeSnapshot ?? facts.partner.code,
      displayName: facts.partner.displayName,
    },
    campaign:
      facts.campaign === null
        ? null
        : {
            id: String(facts.campaign.id),
            code: facts.campaignCodeSnapshot ?? facts.campaign.code,
            displayName: facts.campaign.displayName,
          },
    trackingLink:
      facts.trackingLink === null
        ? null
        : {
            id: String(facts.trackingLink.id),
            // The link's own public code — server-generated, immutable and
            // carrying no database id and no partner code. It is the
            // established display-safe identifier of a link.
            code: facts.trackingLinkCodeSnapshot ?? facts.trackingLink.publicCode,
            displayName: facts.trackingLink.displayName,
          },
    firstTouchAt: iso(facts.firstTouchAt),
    lastTouchAt: iso(facts.lastTouchAt),
    selectedTouchAt: iso(facts.selectedTouchAt),
    acquisitionModel: facts.attributionModel,
    selectionReason: facts.selectionReason,
    frozenAt: iso(facts.frozenAt),
  };
}

/* ---------------------------------------------------------- deposit summary */

/** The bounded provider disagreements. Already an enum in the database. */
export type LeadConflictCategory =
  | "click_id_mismatch"
  | "amount_mismatch"
  | "identity_owner_mismatch"
  | "click_owner_missing";

export type LeadDepositSummary = {
  readonly depositState: LeadDepositState;
  readonly firstReceivedAt: string | null;
  readonly confirmedAt: string | null;
  readonly conflictDetectedAt: string | null;
  readonly amountAvailability:
    | { readonly available: true }
    | { readonly available: false; readonly reason: string };
  readonly providerAmount: string | null;
  readonly currencyCode: string | null;
  readonly currencyStatus: string | null;
  readonly conflictCategory: LeadConflictCategory | null;
  /**
   * Whether the provider redelivered this event at all — never how many times.
   * The count is transport metadata about Pocket's retry behaviour, it has no
   * product meaning for a lead, and publishing it would invite it to be read
   * as a number of deposits.
   */
  readonly replayObserved: boolean;
};

/** The exact two-decimal form AFD-4 stores. Anything else is not summable. */
const CANONICAL_AMOUNT = /^\d+\.\d{2}$/;

/**
 * The amount, under the ESTABLISHED currency contract and no other.
 *
 * An amount whose unit nobody stated is withheld rather than rendered beside a
 * guessed symbol. AFD-4 never defaults to USD and neither does this: a number
 * on a screen with the wrong currency is worse than an explicit absence,
 * because only one of the two gets questioned.
 */
export function buildDepositSummary(facts: LeadFacts, state: LeadDepositState): LeadDepositSummary {
  const configured =
    facts.firstDepositCurrencyStatus === "configured" &&
    typeof facts.firstDepositCurrency === "string" &&
    facts.firstDepositCurrency.length > 0;
  const canonical =
    typeof facts.firstDepositAmount === "string" && CANONICAL_AMOUNT.test(facts.firstDepositAmount);

  const amountAvailable = facts.firstDepositAmount !== null && configured && canonical;
  const reason =
    facts.firstDepositAmount === null
      ? "no_confirmed_first_deposit"
      : !configured
        ? "currency_unspecified"
        : "amount_not_canonical";

  return {
    depositState: state,
    firstReceivedAt: iso(facts.providerFirstReceivedAt),
    confirmedAt: iso(facts.firstDepositAt),
    conflictDetectedAt: iso(facts.providerConflictDetectedAt),
    amountAvailability: amountAvailable ? { available: true } : { available: false, reason },
    providerAmount: amountAvailable ? facts.firstDepositAmount : null,
    currencyCode: amountAvailable ? facts.firstDepositCurrency : null,
    currencyStatus: facts.firstDepositCurrencyStatus,
    conflictCategory: (facts.providerConflictCode as LeadConflictCategory | null) ?? null,
    replayObserved: facts.providerReplayCount > 0,
  };
}

/* ----------------------------------------------------------------- list row */

export type LeadListRow = RedactedLeadIdentity & {
  readonly academyRegisteredAt: string;
  readonly selectedAcquisitionAt: string | null;
  readonly pocketRegisteredAt: string | null;
  readonly firstDepositAt: string | null;
  readonly journeyStage: LeadJourneyStage;
  readonly depositState: LeadDepositState;
  readonly attributionState: "attributed" | "unattributed";
  readonly affiliate: LeadDimensionSummary | null;
  readonly campaign: LeadDimensionSummary | null;
  readonly trackingLink: LeadDimensionSummary | null;
  readonly integrityFlags: readonly LeadIntegrityFlag[];
  /**
   * Whether THIS caller could reveal this lead's identity. A capability hint
   * for a UI, never the authorization itself: the reveal route re-checks the
   * permission from the session and does not consult this field.
   */
  readonly canRevealPii: boolean;
};

/** Everything a lead's state needs, derived once and shared by both builders. */
function leadState(facts: LeadFacts) {
  return deriveLeadState({
    academyRegisteredAt: facts.registeredAt,
    academyRegistrationCount: facts.academyRegistrationCount,
    pocketRegisteredAt: facts.pocketBoundAt,
    pocketIdentitySource: facts.pocketSource,
    firstDepositConfirmedAt: facts.firstDepositAt,
    firstDepositConversionCount: facts.firstDepositConversionCount,
    providerEventCount: facts.providerEventCount,
    providerStatus: facts.providerStatus,
    providerFirstReceivedAt: facts.providerFirstReceivedAt,
    providerConflictDetectedAt: facts.providerConflictDetectedAt,
    providerMatchedAt: facts.providerMatchedAt,
  });
}

/**
 * One list row.
 *
 * NO TIMELINE ARRAY LIVES HERE. A hundred rows each carrying six events is six
 * hundred objects an operator scrolled past to read twenty-five names, and it
 * is the shape in which a list quietly becomes a bulk export. The timeline is
 * the detail route's job.
 */
export function buildLeadListRow(facts: LeadFacts, canRevealPii: boolean): LeadListRow {
  const leadId = toLeadId(facts.eventId);
  const state = leadState(facts);
  const acquisition = buildAcquisitionSummary(facts);

  return {
    ...redactedIdentity(leadId, facts.email),
    academyRegisteredAt: facts.registeredAt.toISOString(),
    selectedAcquisitionAt: iso(facts.selectedTouchAt),
    pocketRegisteredAt: iso(state.pocketRegisteredAt),
    firstDepositAt: iso(facts.firstDepositAt),
    journeyStage: state.journeyStage,
    depositState: state.depositState,
    attributionState: acquisition.attributionState,
    affiliate: acquisition.affiliate,
    campaign: acquisition.campaign,
    trackingLink: acquisition.trackingLink,
    integrityFlags: state.integrityFlags,
    canRevealPii,
  };
}

/* -------------------------------------------------------------- lead detail */

export type LeadJourneySummary = {
  readonly journeyStage: LeadJourneyStage;
  readonly academyRegisteredAt: string;
  readonly pocketRegisteredAt: string | null;
  readonly firstDepositConfirmedAt: string | null;
};

export type LeadDetail = RedactedLeadIdentity & {
  readonly acquisition: LeadAcquisitionSummary;
  readonly journey: LeadJourneySummary;
  readonly deposit: LeadDepositSummary;
  readonly timeline: LeadTimeline;
  readonly integrityFlags: readonly LeadIntegrityFlag[];
  readonly canRevealPii: boolean;
};

export function buildLeadDetail(
  facts: LeadFacts,
  timezone: string,
  canRevealPii: boolean,
): LeadDetail {
  const leadId = toLeadId(facts.eventId);
  const state = leadState(facts);

  // The only tracking link a lead's timeline can refer to is the one its own
  // frozen attribution names, so the label resolver is a closed lookup rather
  // than a query: an id that is not this lead's link resolves to null.
  const linkLabel = (linkId: number | null) =>
    linkId !== null && facts.trackingLink !== null && facts.trackingLink.id === linkId
      ? {
          trackingLinkPublicCode:
            facts.trackingLinkCodeSnapshot ?? facts.trackingLink.publicCode,
          displayName: facts.trackingLink.displayName,
        }
      : null;

  const timeline = buildLeadTimeline(facts, timezone, linkLabel);

  return {
    ...redactedIdentity(leadId, facts.email),
    acquisition: buildAcquisitionSummary(facts),
    journey: {
      journeyStage: state.journeyStage,
      academyRegisteredAt: facts.registeredAt.toISOString(),
      pocketRegisteredAt: iso(state.pocketRegisteredAt),
      firstDepositConfirmedAt: iso(facts.firstDepositAt),
    },
    deposit: buildDepositSummary(facts, state.depositState),
    timeline,
    // The lead's own findings and the timeline's, merged into one canonical
    // list so a client has a single place to look.
    integrityFlags: orderFlags([...state.integrityFlags, ...timeline.integrityFlags]),
    canRevealPii,
  };
}
