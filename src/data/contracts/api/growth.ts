/**
 * G4-GROWTH — the wire contracts for the five Growth surfaces.
 *
 * STRICT SCHEMAS, PARSED BEFORE RENDER. A response that does not match is
 * reported as `malformed_response` and nothing is drawn. That is deliberate for
 * an analytics surface above all others: a partially-rendered funnel looks like
 * a complete one, and a missing field silently rendered as a dash is
 * indistinguishable from a real absence.
 *
 * RATIOS ARE `string | null`, AND THE NULL IS LOAD-BEARING. See `ratioSchema`.
 *
 * MONEY IS A STRING. Canonical decimal text, exactly as stored. Parsing it to a
 * JavaScript number here would reintroduce float money at the last possible
 * moment, after every other layer took care to avoid it.
 */
import { z } from "zod";

/** The closed error envelope the backend analytics routes share. */
export const growthErrorSchema = z.object({
  code: z.string(),
  messageKey: z.string(),
  requestId: z.string().optional(),
});

const availabilityStateSchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);

export type GrowthAvailabilityState = z.infer<typeof availabilityStateSchema>;

export const growthAvailabilitySchema = z.object({
  trafficClicks: availabilityStateSchema,
  ataRegistrations: availabilityStateSchema,
  enrollments: availabilityStateSchema,
  academyActivation: availabilityStateSchema,
  educationProgression: availabilityStateSchema,
  mentorReviewSubmissions: availabilityStateSchema,
  pocketRegistrations: availabilityStateSchema,
  firstDeposits: availabilityStateSchema,
  firstDepositAmountAggregation: availabilityStateSchema,
  redeposits: availabilityStateSchema,
  currentBalance: availabilityStateSchema,
  acquisitionCreativeDimensions: availabilityStateSchema,
  cpaAndCommission: availabilityStateSchema,
});

export type GrowthAvailability = z.infer<typeof growthAvailabilitySchema>;

const periodSchema = z.object({
  resolvedPreset: z.string(),
  timezone: z.string(),
  weekStart: z.string(),
  startUtc: z.string().nullable(),
  endUtc: z.string(),
});

/**
 * An exact decimal string, or null. NEVER a number.
 *
 * The backend publishes ratios as truncated exact decimals (the accepted
 * AFD-5B1 convention) precisely so nothing is rounded on the wire, and returns
 * `null` — never `0` — when a denominator is zero. Typing this as `number` would
 * invite a `?? 0` somewhere in the UI, which is exactly the fabrication §60
 * forbids: it turns "no traffic yet" into "0% converted".
 */
const ratioSchema = z.string().nullable();

const countsSchema = z.object({
  clicks: z.number(),
  ataRegistrations: z.number(),
  enrollments: z.number(),
  activatedLearners: z.number(),
  levelStarted: z.number(),
  levelCompleted: z.number(),
  assessmentsCompleted: z.number(),
  assessmentsPassed: z.number(),
  reportsSubmitted: z.number(),
  reportsApproved: z.number(),
  mentorReviewsSubmitted: z.number(),
  mentorReviewsApproved: z.number(),
  pocketRegistrations: z.number(),
  firstDeposits: z.number(),
  confirmedRedeposits: z.number(),
  unresolvedRedeposits: z.number(),
  ratios: z.object({
    ataRegistrationRate: ratioSchema,
    activationRate: ratioSchema,
    enrollmentRate: ratioSchema,
    assessmentPassRate: ratioSchema,
    reportApprovalRate: ratioSchema,
    pocketRegistrationRate: ratioSchema,
    depositRatePerRegistration: ratioSchema,
    depositRatePerPocketRegistration: ratioSchema,
  }),
});

export type GrowthCounts = z.infer<typeof countsSchema>;

const depositAmountSchema = z.object({
  count: z.number(),
  // Canonical decimal TEXT or null. Never a number — see the header.
  sum: z.string().nullable(),
  average: z.string().nullable(),
  median: z.string().nullable(),
  amountAggregationAvailable: z.boolean(),
  unavailableReason: z.string().nullable(),
  currencyCode: z.string().nullable(),
});

export type GrowthDepositAmount = z.infer<typeof depositAmountSchema>;

export const growthOverviewSchema = z.object({
  mode: z.string(),
  rateMode: z.string(),
  rateModeExplanation: z.string(),
  attributionExplanation: z.string(),
  period: periodSchema,
  coverage: z.object({
    attributed: countsSchema,
    unattributed: countsSchema.nullable(),
    total: countsSchema.nullable(),
  }),
  firstDepositAmount: depositAmountSchema,
  dataAvailability: growthAvailabilitySchema,
  generatedAt: z.string(),
});

export type GrowthOverview = z.infer<typeof growthOverviewSchema>;

const funnelStepSchema = z.object({
  step: z.string(),
  count: z.number(),
  /** The step this one is a fraction OF. Null on the first step only. */
  ofStep: z.string().nullable(),
  rate: ratioSchema,
  dropOff: z.number().nullable(),
});

export const growthFunnelSchema = z.object({
  mode: z.string(),
  attributionExplanation: z.string(),
  period: periodSchema,
  maxLevel: z.number(),
  acquisitionFunnel: z.object({
    denominatorModel: z.string(),
    steps: z.array(funnelStepSchema),
  }),
  levelFunnel: z.object({
    absentMeans: z.string(),
    steps: z.array(
      z.object({
        levelNumber: z.number(),
        started: z.number(),
        completed: z.number(),
        completionRate: ratioSchema,
      }),
    ),
  }),
  educationQuality: z.object({
    assessmentsCompleted: z.number(),
    assessmentsPassed: z.number(),
    assessmentPassRate: ratioSchema,
    reportsSubmitted: z.number(),
    reportsApproved: z.number(),
    reportApprovalRate: ratioSchema,
    mentorReviewsSubmitted: z.number(),
    mentorReviewsApproved: z.number(),
  }),
  dataAvailability: growthAvailabilitySchema,
  generatedAt: z.string(),
});

export type GrowthFunnel = z.infer<typeof growthFunnelSchema>;

export const growthAcquisitionSchema = z.object({
  mode: z.string(),
  attributionExplanation: z.string(),
  period: periodSchema,
  dimension: z.string(),
  limit: z.number(),
  rankingPolicy: z.string(),
  qualityScorePolicy: z.string(),
  rows: z.array(
    z.object({
      dimension: z.string(),
      label: z.string().nullable(),
      clicks: z.number(),
      ataRegistrations: z.number(),
      activatedLearners: z.number(),
      pocketRegistrations: z.number(),
      firstDeposits: z.number(),
      ataRegistrationRate: ratioSchema,
      activationRate: ratioSchema,
      pocketRegistrationRate: ratioSchema,
      depositRatePerRegistration: ratioSchema,
      depositRatePerPocketRegistration: ratioSchema,
    }),
  ),
  dataAvailability: growthAvailabilitySchema,
  generatedAt: z.string(),
});

export type GrowthAcquisition = z.infer<typeof growthAcquisitionSchema>;

export const growthPocketConversionsSchema = z.object({
  mode: z.string(),
  period: periodSchema,
  conversions: z.object({
    pocketRegistrations: z.number(),
    firstDeposits: z.number(),
    confirmedRedeposits: z.number(),
  }),
  // A separate object on the wire, so a client cannot render it beside a
  // confirmed conversion by accident.
  operational: z.object({
    unresolvedRedeposits: z.number(),
    unresolvedRedepositsMeaning: z.string(),
  }),
  firstDepositAmount: depositAmountSchema,
  totalDepositAmountNote: z.string(),
  prohibited: z.object({
    currentBalance: z.string(),
    profitAndLoss: z.string(),
    commission: z.string(),
  }),
  dataAvailability: growthAvailabilitySchema,
  generatedAt: z.string(),
});

export type GrowthPocketConversions = z.infer<typeof growthPocketConversionsSchema>;

export const growthIngressHealthSchema = z.object({
  period: periodSchema,
  switches: z.object({
    masterEnabled: z.boolean(),
    regIngestEnabled: z.boolean(),
    depIngestEnabled: z.boolean(),
    rdepIngestEnabled: z.boolean(),
    redepositIdentityContract: z.string(),
    redepositIdentityReason: z.string().nullable(),
  }),
  deliveries: z.object({
    total: z.number(),
    byGoal: z.record(z.string(), z.number()),
    byStatus: z.record(z.string(), z.number()),
    byRejectionCode: z.record(z.string(), z.number()),
  }),
  summary: z.object({
    accepted: z.number(),
    duplicates: z.number(),
    pendingLinkage: z.number(),
    identityUnresolved: z.number(),
    rejected: z.number(),
    quarantined: z.number(),
    authRejected: z.number(),
    schemaRejected: z.number(),
    unknownGoal: z.number(),
    disabledGoal: z.number(),
    unlinkedClick: z.number(),
    playerConflict: z.number(),
    orderingUnresolved: z.number(),
  }),
  notes: z.object({
    identityUnresolved: z.string(),
    authRejected: z.string(),
  }),
  generatedAt: z.string(),
});

export type GrowthIngressHealth = z.infer<typeof growthIngressHealthSchema>;
