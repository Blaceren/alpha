/**
 * Signal engine — pure functions that DERIVE signals from synthetic user data +
 * a Clock + SIGNAL_CATALOG thresholds. Signals are never stored as static badges
 * and there is no opaque score (Phase 1B1 §6).
 */
import type { Clock } from "@/lib/clock";
import { DAY_MS, HOUR_MS, hoursFromNow, hoursSince, hoursUntil } from "@/lib/clock";
import type { ISODateString, StateEvidence, StateEvidenceCode } from "@/domain/shared/primitives";
import type { MockUser } from "@/domain/users/mock-user";
import { SIGNAL_THRESHOLDS } from "@/config/signals.config";
import type { SignalCode, SignalSeverity } from "./signal";
import { SIGNAL_TO_ACTIONS, type RecommendedActionCode } from "@/domain/recommendations/catalog";

export interface ComputedSignal {
  code: SignalCode;
  severity: SignalSeverity;
  status: "active";
  reasonCode: string;
  /** Human-readable explanation for operators. */
  reason: string;
  evidence: StateEvidence[];
  calculatedAt: ISODateString;
  expiresAt: ISODateString | null;
  recommendedActionCodes: RecommendedActionCode[];
  suppression: {
    /** Set when a deeper signal supersedes this one. */
    suppressedBy: SignalCode | null;
    /** True when the signal should suppress new outbound communications. */
    suppressesOutbound: boolean;
  };
}

export const SIGNAL_SEVERITY: Record<SignalCode, SignalSeverity> = {
  registration_no_start: "medium",
  pocket_registration_incomplete: "high",
  email_not_confirmed: "medium",
  lesson_abandoned: "medium",
  progression_stalled: "medium",
  repeated_test_failure: "high",
  report_pending: "medium",
  report_rejected_no_return: "high",
  mentor_sla_risk: "high",
  checkpoint_approaching: "medium",
  checkpoint_grace_active: "high",
  financial_access_suspended: "critical",
  balance_data_stale: "medium",
  pocket_data_conflict: "high",
  inactive_3_days: "medium",
  inactive_7_days: "high",
  dormant_14_days: "high",
  dormant_30_days: "high",
  returned_after_absence: "medium",
  communication_fatigue: "high",
  support_blocked: "high",
  frequent_redeposit_pattern: "low",
  rapid_balance_decline: "high",
};

const t = SIGNAL_THRESHOLDS;

/**
 * A MEASURED quantity — a number that says how much/how long. `kind: "metric"`
 * is load-bearing, not decoration: consumers that must stay compact (the Today
 * queue) show metrics and drop references, because a metric adds a fact while a
 * reference only restates the one the reason already made.
 */
function ev(
  code: StateEvidenceCode,
  value: number | null,
  at: ISODateString,
): StateEvidence {
  return { kind: "metric", code, value, observedAt: at, sensitivity: "LOW" };
}

/**
 * A STATE the signal is pointing at — a flag or an enum member. Confirmatory:
 * "Открыт support-блокер" + "Состояние поддержки · Заблокирован" is one fact
 * printed twice, so these are not surfaced where space is tight.
 */
function evRef(
  code: StateEvidenceCode,
  value: string | boolean | null,
  at: ISODateString,
): StateEvidence {
  return { kind: "reference", code, value, observedAt: at, sensitivity: "LOW" };
}

/** Compute all active signals for a user (deterministic given the clock). */
export function computeSignals(user: MockUser, clock: Clock): ComputedSignal[] {
  const now = clock.nowIso();
  const out: ComputedSignal[] = [];

  const push = (
    code: SignalCode,
    reason: string,
    evidence: StateEvidence[],
    opts: { expiresAt?: ISODateString | null; suppressesOutbound?: boolean } = {},
  ) => {
    out.push({
      code,
      severity: SIGNAL_SEVERITY[code],
      status: "active",
      reasonCode: code,
      reason,
      evidence,
      calculatedAt: now,
      expiresAt: opts.expiresAt ?? hoursFromNow(clock, 24),
      recommendedActionCodes: SIGNAL_TO_ACTIONS[code],
      suppression: { suppressedBy: null, suppressesOutbound: opts.suppressesOutbound ?? false },
    });
  };

  const regHours = hoursSince(clock, user.identity.registeredAt) ?? 0;
  const actionHours = hoursSince(clock, user.progression.lastMeaningfulActionAt);
  const learnHours = hoursSince(clock, user.learning.lastLearningActivityAt);

  // registration_no_start
  if (
    user.state.engagementStatus === "not_started" &&
    user.progression.lastMeaningfulActionAt === null &&
    regHours >= t.registration_no_start.hours
  ) {
    push("registration_no_start", `Зарегистрирован ${Math.round(regHours)}ч назад, нет активности.`, [
      ev("hours_since_registration", Math.round(regHours), now),
    ]);
  }

  // pocket_registration_incomplete
  if (
    (user.financial.registrationStatus === "not_registered" ||
      user.financial.registrationStatus === "registration_pending") &&
    regHours >= t.pocket_registration_incomplete.hours
  ) {
    push(
      "pocket_registration_incomplete",
      "Регистрация Pocket не подтверждена — финансовые контрольные точки недоступны.",
      [evRef("pocket_registration_status", user.financial.registrationStatus, now)],
    );
  }

  // email_not_confirmed — depends ONLY on the ATA account email confirmation
  // (identity.emailConfirmed), independent of Pocket registrationStatus.
  if (!user.identity.emailConfirmed && regHours >= t.email_not_confirmed.hours) {
    push("email_not_confirmed", "Email аккаунта ATA не подтверждён.", [
      evRef("email_confirmed", false, now),
      ev("hours_since_registration", Math.round(regHours), now),
    ]);
  }

  // lesson_abandoned
  if (
    user.learning.lastLesson &&
    user.learning.lessonProgressPct > 0 &&
    user.learning.lessonProgressPct < 100 &&
    (learnHours ?? 0) >= t.lesson_abandoned.hours
  ) {
    push("lesson_abandoned", `Урок «${user.learning.lastLesson}» брошен ${Math.round(learnHours ?? 0)}ч назад.`, [
      ev("lesson_progress_pct", user.learning.lessonProgressPct, now),
    ]);
  }

  // progression_stalled
  if (
    user.progression.nextLevel !== null &&
    actionHours !== null &&
    actionHours >= t.progression_stalled.hours
  ) {
    push("progression_stalled", `Нет прогресса ${Math.round(actionHours)}ч при доступном следующем уровне.`, [
      ev("hours_since_last_action", Math.round(actionHours), now),
    ]);
  }

  // repeated_test_failure
  if (user.learning.testAttempts >= t.repeated_test_failure.count) {
    push("repeated_test_failure", `${user.learning.testAttempts} неудачных попытки теста.`, [
      ev("test_attempts", user.learning.testAttempts, now),
      ev("latest_test_score", user.learning.latestScore, now),
    ]);
  }

  // report_pending
  if (user.learning.reportState === "pending") {
    push("report_pending", "Отчёт ожидает mentor-проверки.", [
      evRef("report_state", user.learning.reportState, now),
    ]);
  }

  // report_rejected_no_return
  const reportHours = hoursSince(clock, user.learning.reportSubmittedAt);
  if (
    user.learning.reportState === "rejected" &&
    reportHours !== null &&
    reportHours >= t.report_rejected_no_return.hours
  ) {
    push("report_rejected_no_return", `Отчёт отклонён ${Math.round(reportHours)}ч назад, нет повторной отправки.`, [
      ev("hours_since_report_rejection", Math.round(reportHours), now),
    ]);
  }

  // mentor_sla_risk (warning or breach)
  if (user.operations.sla && user.operations.sla.key === "mentor_review") {
    const started = new Date(user.operations.sla.startedAt).getTime();
    const due = new Date(user.operations.sla.dueAt).getTime();
    const frac = (clock.nowMs() - started) / (due - started);
    if (frac >= t.mentor_sla_risk.warnAtPct / 100) {
      const breached = clock.nowMs() >= due;
      push(
        "mentor_sla_risk",
        breached ? "SLA mentor-проверки нарушен." : "SLA mentor-проверки под риском.",
        [ev("sla_elapsed_pct", Math.round(frac * 100), now), evRef("sla_breached", breached, now)],
        { expiresAt: user.operations.sla.dueAt },
      );
    }
  }

  // checkpoint_approaching
  if (
    user.progression.nextCheckpointRequiredUsd !== null &&
    user.financial.balanceUsd !== null &&
    user.financial.balanceUsd < user.progression.nextCheckpointRequiredUsd
  ) {
    const required = user.progression.nextCheckpointRequiredUsd;
    const deltaPct = ((required - user.financial.balanceUsd) / required) * 100;
    if (deltaPct <= t.checkpoint_approaching.deltaPct) {
      push("checkpoint_approaching", `До checkpoint L${user.progression.nextCheckpointLevel} осталось ${Math.round(deltaPct)}%.`, [
        ev("checkpoint_delta_pct", Math.round(deltaPct), now),
      ]);
    }
  }

  // checkpoint_grace_active
  if (user.financial.grace?.active) {
    const endsIn = hoursUntil(clock, user.financial.grace.endsAt);
    push(
      "checkpoint_grace_active",
      `Grace period активен${endsIn !== null ? `, завершится через ${Math.round(endsIn)}ч` : ""}.`,
      [ev("grace_confirmations_below_threshold", user.financial.grace.belowThresholdConfirmations, now)],
      { expiresAt: user.financial.grace.endsAt },
    );
  }

  // financial_access_suspended (suppresses outbound learning nudges post-checkpoint)
  if (user.financial.accessSuspended) {
    push("financial_access_suspended", "Финансовый доступ после checkpoint приостановлен.", [
      evRef("financial_access_suspended", true, now),
    ], { suppressesOutbound: true });
  }

  // balance_data_stale
  const balAgeMin = user.financial.balanceTimestamp
    ? (clock.nowMs() - new Date(user.financial.balanceTimestamp).getTime()) / 60000
    : null;
  if (
    user.state.fundingStatus === "balance_unknown" ||
    (balAgeMin !== null && balAgeMin >= t.balance_data_stale.staleMinutes)
  ) {
    push("balance_data_stale", "Баланс устарел/недоступен.", [
      ev("balance_age_minutes", balAgeMin === null ? null : Math.round(balAgeMin), now),
    ]);
  }

  // pocket_data_conflict
  if (user.financial.pocketConflict) {
    push("pocket_data_conflict", "Расхождение данных баланса продукт↔Pocket.", [
      evRef("pocket_data_conflict", true, now),
    ]);
  }

  // inactivity ladder
  const days = actionHours === null ? null : actionHours / 24;
  if (days !== null) {
    if (actionHours! >= t.inactive_3_days.hours)
      push("inactive_3_days", `Нет активности ${Math.round(days)}д.`, [ev("days_inactive", Math.round(days), now)]);
    if (days >= t.inactive_7_days.days)
      push("inactive_7_days", `Нет активности ${Math.round(days)}д.`, [ev("days_inactive", Math.round(days), now)]);
    if (days >= t.dormant_14_days.days)
      push("dormant_14_days", `Dormant ${Math.round(days)}д.`, [ev("days_inactive", Math.round(days), now)]);
    if (days >= t.dormant_30_days.days)
      push("dormant_30_days", `Dormant ${Math.round(days)}д.`, [ev("days_inactive", Math.round(days), now)]);
  }

  // returned_after_absence
  if (user.state.engagementStatus === "returned") {
    push("returned_after_absence", "Пользователь вернулся после длительного отсутствия.", [
      evRef("engagement_status", user.state.engagementStatus, now),
    ]);
  }

  // communication_fatigue
  if (
    user.operations.communications24h > t.communication_fatigue.max24h ||
    user.operations.communications7d > t.communication_fatigue.max7d
  ) {
    push("communication_fatigue", `${user.operations.communications24h} сообщений за 24ч.`, [
      ev("communications_24h", user.operations.communications24h, now),
      ev("communications_7d", user.operations.communications7d, now),
    ], { suppressesOutbound: true });
  }

  // support_blocked
  if (user.operations.supportState === "blocked" || user.state.blockers.includes("support_blocked")) {
    push("support_blocked", "Открыт support-блокер.", [evRef("support_state", user.operations.supportState, now)]);
  }

  // frequent_redeposit_pattern
  if (user.financial.redeposits.length >= t.frequent_redeposit_pattern.minRedeposits) {
    push("frequent_redeposit_pattern", `${user.financial.redeposits.length} redeposit — предложить паузу.`, [
      ev("redeposit_count", user.financial.redeposits.length, now),
    ]);
  }

  // rapid_balance_decline
  if (
    user.financial.previousBalanceUsd !== null &&
    user.financial.balanceUsd !== null &&
    user.financial.previousBalanceAt !== null
  ) {
    const withinWindow =
      clock.nowMs() - new Date(user.financial.previousBalanceAt).getTime() <= t.rapid_balance_decline.windowHours * HOUR_MS + DAY_MS;
    const dropPct = ((user.financial.previousBalanceUsd - user.financial.balanceUsd) / user.financial.previousBalanceUsd) * 100;
    if (withinWindow && dropPct >= t.rapid_balance_decline.dropPct) {
      push("rapid_balance_decline", `Баланс упал на ${Math.round(dropPct)}% — образовательный ответ.`, [
        ev("balance_drop_pct", Math.round(dropPct), now),
      ]);
    }
  }

  return applySuppression(out);
}

/** Collapse the inactivity ladder so only the deepest signal stays active. */
function applySuppression(signals: ComputedSignal[]): ComputedSignal[] {
  const has = (c: SignalCode) => signals.some((s) => s.code === c);
  const supersede: Partial<Record<SignalCode, SignalCode>> = {};
  if (has("dormant_30_days")) {
    supersede.dormant_14_days = "dormant_30_days";
    supersede.inactive_7_days = "dormant_30_days";
    supersede.inactive_3_days = "dormant_30_days";
  } else if (has("dormant_14_days")) {
    supersede.inactive_7_days = "dormant_14_days";
    supersede.inactive_3_days = "dormant_14_days";
  } else if (has("inactive_7_days")) {
    supersede.inactive_3_days = "inactive_7_days";
  }
  return signals
    .map((s) => {
      const by = supersede[s.code];
      return by ? { ...s, status: "active" as const, suppression: { ...s.suppression, suppressedBy: by } } : s;
    })
    .filter((s) => s.suppression.suppressedBy === null);
}
