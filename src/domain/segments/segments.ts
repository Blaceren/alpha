/**
 * Computed segments (Phase 1B1 §14). Membership is DERIVED from a predicate over
 * the dataset — there is no separately-stored membership list (single source of
 * truth). Counts are computed on demand.
 */
import type { Clock } from "@/lib/clock";
import type { MockUser } from "@/domain/users/mock-user";

export type SegmentCode =
  | "new_registrations"
  | "pocket_registration_incomplete"
  | "pre_ftd"
  | "active_learners"
  | "progression_stalled"
  | "reports_pending"
  | "checkpoint_grace"
  | "financial_access_suspended"
  | "repeat_funders"
  | "frequent_repeat_funders"
  | "dormant_users"
  | "returned_users"
  | "support_blocked"
  | "communication_fatigue";

export interface SegmentDefinition {
  code: SegmentCode;
  title: string;
  description: string;
  predicate: (u: MockUser) => boolean;
}

export const SEGMENT_DEFINITIONS: SegmentDefinition[] = [
  {
    code: "new_registrations",
    title: "Новые регистрации",
    description: "Зарегистрировались, ещё не продвинулись дальше начала.",
    predicate: (u) => u.state.lifecycleStage === "registered",
  },
  {
    code: "pocket_registration_incomplete",
    title: "Регистрация Pocket не завершена",
    description: "Регистрация Pocket не подтверждена — финансовые контрольные точки недоступны.",
    predicate: (u) =>
      u.state.blockers.includes("pocket_registration_incomplete") ||
      u.financial.registrationStatus === "not_registered" ||
      u.financial.registrationStatus === "registration_pending",
  },
  {
    code: "pre_ftd",
    title: "Pre-FTD",
    description: "Подключены, но без первого депозита.",
    predicate: (u) => u.state.lifecycleStage === "pre_ftd",
  },
  {
    code: "active_learners",
    title: "Активные ученики",
    description: "Активная стадия и активная вовлечённость.",
    predicate: (u) => u.state.lifecycleStage === "active" && u.state.engagementStatus === "active",
  },
  {
    code: "progression_stalled",
    title: "Прогресс остановился",
    description: "Нет движения по уровням при доступном следующем.",
    predicate: (u) => u.state.engagementStatus === "progression_stalled",
  },
  {
    code: "reports_pending",
    title: "Отчёты на проверке",
    description: "Есть report, ожидающий mentor-проверки.",
    predicate: (u) => u.learning.reportState === "pending",
  },
  {
    code: "checkpoint_grace",
    title: "Checkpoint grace",
    description: "Активен grace period финансовой контрольной точки.",
    predicate: (u) => u.state.fundingStatus === "checkpoint_grace",
  },
  {
    code: "financial_access_suspended",
    title: "Доступ приостановлен",
    description: "Финансовый доступ после checkpoint приостановлен.",
    predicate: (u) => u.state.fundingStatus === "financial_access_suspended",
  },
  {
    code: "repeat_funders",
    title: "Repeat funders",
    description: "Хотя бы один redeposit.",
    predicate: (u) => u.state.valueSegments.includes("repeat_funder"),
  },
  {
    code: "frequent_repeat_funders",
    title: "Frequent repeat funders",
    description: "Частые повторные пополнения.",
    predicate: (u) => u.state.valueSegments.includes("frequent_repeat_funder"),
  },
  {
    code: "dormant_users",
    title: "Dormant",
    description: "Длительная неактивность (14+/30+ дней).",
    predicate: (u) =>
      u.state.engagementStatus === "dormant_14d" || u.state.engagementStatus === "dormant_30d",
  },
  {
    code: "returned_users",
    title: "Вернувшиеся",
    description: "Вернулись после длительного отсутствия.",
    predicate: (u) => u.state.engagementStatus === "returned",
  },
  {
    code: "support_blocked",
    title: "Support blocked",
    description: "Открыт support-блокер.",
    predicate: (u) => u.operations.supportState === "blocked" || u.state.blockers.includes("support_blocked"),
  },
  {
    code: "communication_fatigue",
    title: "Communication fatigue",
    description: "Перегрузка коммуникациями.",
    predicate: (u) => u.state.blockers.includes("communication_fatigue") || u.operations.communications24h > 2,
  },
];

export interface ComputedSegment {
  code: SegmentCode;
  title: string;
  description: string;
  userCount: number;
  updatedAt: string;
}

export function computeSegments(users: MockUser[], clock: Clock): ComputedSegment[] {
  const at = clock.nowIso();
  return SEGMENT_DEFINITIONS.map((def) => ({
    code: def.code,
    title: def.title,
    description: def.description,
    userCount: users.filter(def.predicate).length,
    updatedAt: at,
  }));
}

export function segmentMembers(users: MockUser[], code: SegmentCode): MockUser[] {
  const def = SEGMENT_DEFINITIONS.find((d) => d.code === code);
  return def ? users.filter(def.predicate) : [];
}
