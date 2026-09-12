// SYNTHETIC MOCK DATA — NOT PRODUCTION.
// Resolves raw persona offsets into fully-timestamped MockUser aggregates using
// a Clock. Deterministic: same clock → identical output. No runtime randomness.
import type { Clock } from "@/lib/clock";
import { FixedMockClock, HOUR_MS, daysAgo, hoursAgo, hoursFromNow, minutesAgo } from "@/lib/clock";
import { nextCheckpointForLevel } from "@/domain/financial/checkpoints";
import type {
  MockDeposit,
  MockUser,
  MockWithdrawal,
} from "@/domain/users/mock-user";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { RawPersona } from "./persona-types";
import { RAW_PERSONAS } from "./personas";

function mapDeposit(clock: Clock, usd: number, dAgo: number, kind: MockDeposit["kind"]): MockDeposit {
  return { amountUsd: usd, at: daysAgo(clock, dAgo), kind };
}
function mapWithdrawal(clock: Clock, w: { usd: number; daysAgo: number; status: MockWithdrawal["status"] }): MockWithdrawal {
  return { amountUsd: w.usd, at: daysAgo(clock, w.daysAgo), status: w.status };
}

function deriveCheckpointStatus(raw: RawPersona): CheckpointStatus {
  if (raw.checkpointStatus) return raw.checkpointStatus;
  if (raw.level > 100) return "future_checkpoint_not_defined";
  switch (raw.fundingStatus) {
    case "checkpoint_grace":
      return "grace";
    case "financial_access_suspended":
      return "suspended";
    case "funded":
      return "met";
    default:
      return "not_reached";
  }
}

export function buildUser(clock: Clock, raw: RawPersona): MockUser {
  const ftd: MockDeposit | null =
    raw.ftdUsd != null ? mapDeposit(clock, raw.ftdUsd, raw.ftdDaysAgo ?? 0, "ftd") : null;
  const redeposits = raw.redeposits.map((d) => mapDeposit(clock, d.usd, d.daysAgo, "redeposit"));
  const successfulWithdrawals = raw.successfulWithdrawals.map((w) => mapWithdrawal(clock, w));
  const withdrawalRequests = raw.withdrawalRequests.map((w) => mapWithdrawal(clock, w));

  const netDepositsUsd =
    (ftd?.amountUsd ?? 0) +
    redeposits.reduce((s, d) => s + d.amountUsd, 0) -
    successfulWithdrawals.reduce((s, w) => s + w.amountUsd, 0);

  const balanceUsd = raw.balanceUsd === "unknown" ? null : raw.balanceUsd;
  const balanceTimestamp = raw.balanceAgeMinutes == null ? null : minutesAgo(clock, raw.balanceAgeMinutes);

  const checkpoint = nextCheckpointForLevel(raw.level);

  const graceEndsAt = raw.grace ? hoursFromNow(clock, raw.grace.endsInHours) : null;
  const graceStartedAt = raw.grace ? hoursFromNow(clock, raw.grace.endsInHours - 24) : null;

  const slaDueAt = raw.sla
    ? new Date(new Date(hoursAgo(clock, raw.sla.startedHoursAgo)).getTime() + raw.sla.durationHours * HOUR_MS).toISOString()
    : null;

  return {
    identity: {
      userId: raw.id,
      displayName: raw.name,
      maskedEmail: raw.maskedEmail,
      fullEmail: raw.fullEmail,
      emailConfirmed: raw.emailConfirmed,
      country: raw.country,
      locale: raw.locale,
      timezone: raw.timezone,
      registeredAt: daysAgo(clock, raw.registeredDaysAgo),
      acquisitionSource: raw.acquisitionSource,
      campaign: raw.campaign,
      deviceClass: raw.deviceClass,
    },
    state: {
      lifecycleStage: raw.lifecycleStage,
      fundingStatus: raw.fundingStatus,
      engagementStatus: raw.engagementStatus,
      valueSegments: raw.valueSegments,
      blockers: raw.blockers,
      reasonCode: raw.reasonCode,
      evidence: raw.evidence,
      calculatedAt: clock.nowIso(),
      expiresAt: raw.stateExpiresInHours != null ? hoursFromNow(clock, raw.stateExpiresInHours) : null,
    },
    progression: {
      curriculumVersion: "2026-07",
      currentLevel: raw.level,
      highestCompletedLevel: raw.highestCompletedLevel,
      xp: raw.xp,
      nextRequiredXp: raw.nextRequiredXp,
      currentModule: raw.currentModule,
      nextLevel: raw.level >= 100 ? null : raw.level + 1,
      nextCheckpointLevel: checkpoint?.level ?? null,
      nextCheckpointRequiredUsd: checkpoint?.requiredUsd ?? null,
      checkpointStatus: deriveCheckpointStatus(raw),
      lastMeaningfulActionAt: raw.lastActionHoursAgo == null ? null : hoursAgo(clock, raw.lastActionHoursAgo),
    },
    learning: {
      lastLesson: raw.lastLesson,
      lessonProgressPct: raw.lessonProgressPct,
      testAttempts: raw.testAttempts,
      latestScore: raw.latestScore,
      reportState: raw.reportState,
      reportSubmittedAt: raw.reportSubmittedHoursAgo != null ? hoursAgo(clock, raw.reportSubmittedHoursAgo) : null,
      mentorReviewState: raw.mentorReviewState,
      lastLearningActivityAt: raw.lastLearningHoursAgo == null ? null : hoursAgo(clock, raw.lastLearningHoursAgo),
    },
    financial: {
      registrationStatus: raw.registrationStatus,
      traderId: raw.hasTraderId ? `pp_mock_${raw.id.slice(-3)}` : null,
      balanceUsd,
      balanceTimestamp,
      ftd,
      redeposits,
      successfulWithdrawals,
      withdrawalRequests,
      netDepositsUsd,
      pocketConflict: raw.pocketConflict,
      previousBalanceUsd: raw.previousBalanceUsd ?? null,
      previousBalanceAt: raw.previousBalanceHoursAgo != null ? hoursAgo(clock, raw.previousBalanceHoursAgo) : null,
      grace: raw.grace
        ? {
            active: true,
            startedAt: graceStartedAt,
            endsAt: graceEndsAt,
            belowThresholdConfirmations: raw.grace.confirmations,
            hasOpenTrades: raw.grace.openTrades,
            checkpointLevel: raw.grace.checkpointLevel,
          }
        : null,
      accessSuspended: raw.accessSuspended,
      accessRestoredAt: raw.accessRestoredDaysAgo != null ? daysAgo(clock, raw.accessRestoredDaysAgo) : null,
    },
    operations: {
      primaryOwnerId: raw.primaryOwnerId,
      activeTaskCount: raw.activeTaskCount,
      activeCaseCount: raw.activeCaseCount,
      lastEmployeeContactAt: raw.lastEmployeeContactDaysAgo == null ? null : daysAgo(clock, raw.lastEmployeeContactDaysAgo),
      nextFollowUpAt: raw.nextFollowUpInHours == null ? null : hoursFromNow(clock, raw.nextFollowUpInHours),
      supportState: raw.supportState,
      mentorState: raw.mentorState,
      sla:
        raw.sla && slaDueAt
          ? { key: raw.sla.key, startedAt: hoursAgo(clock, raw.sla.startedHoursAgo), dueAt: slaDueAt }
          : null,
      communications24h: raw.communications24h,
      communications7d: raw.communications7d,
    },
    primaryScenario: raw.primaryScenario,
  };
}

/** Build the full 30-user dataset for a given clock (deterministic). */
export function buildDataset(clock: Clock = new FixedMockClock()): MockUser[] {
  return RAW_PERSONAS.map((p) => buildUser(clock, p));
}
