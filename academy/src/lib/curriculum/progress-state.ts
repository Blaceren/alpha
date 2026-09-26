/**
 * Backend presentation state + blockers -> Academy display state.
 *
 * The Backend level-state resolver is progression authority. It emits an
 * EffectiveLevelState (completed | pending_review | in_progress | available |
 * xp_eligible | locked) plus blocker codes. The Academy renders those decisions
 * and NEVER weakens a lock: an unknown state maps to `locked`, and an unknown
 * blocker maps to a generic lock reason. Nothing here can unlock a level.
 */
export type BackendPresentationState =
  | "completed"
  | "pending_review"
  | "in_progress"
  | "available"
  | "xp_eligible"
  | "checkpoint_unverified"
  | "locked";

export type BackendBlocker =
  | "not_current_level"
  | "sequence_incomplete"
  | "definition_inactive"
  | "xp_engine_unavailable"
  | "xp_insufficient"
  | "checkpoint_engine_unavailable"
  | "checkpoint_verification_unavailable"
  | "visibility_rule_unsupported";

export type AcademyLevelState =
  | "completed"
  | "pending_review"
  | "in_progress"
  | "available"
  // The learner has reached a financial checkpoint the platform cannot verify.
  // Deliberately its own state: it is not `available` (nothing can be done) and
  // not `locked` (the learner has arrived and lost nothing).
  | "checkpoint_unverified"
  | "locked";

export type AcademyLockReason =
  | "not_current"
  | "sequence"
  | "xp"
  | "checkpoint"
  | "external"
  | "inactive"
  | "visibility"
  | "unknown";

export type AcademyStateInfo = {
  state: AcademyLevelState;
  /** Present only when state === "locked". */
  lockReason: AcademyLockReason | null;
  label: string;
  /** May the route be opened at all (read-only in CI-2). */
  routeAccessible: boolean;
  /** May level content be displayed (Backend still enforces this server-side). */
  contentViewable: boolean;
  /** No further transitions expected from the learner's side. */
  terminal: boolean;
};

const STATE_LABEL: Record<AcademyLevelState, string> = {
  completed: "Завершён",
  pending_review: "На проверке",
  in_progress: "В процессе",
  available: "Доступен",
  // Truthful, and deliberately not «Заблокирован»: nothing is blocking the
  // learner, the platform simply cannot confirm the condition yet.
  checkpoint_unverified: "Проверка недоступна",
  locked: "Заблокирован",
};

const LOCK_LABEL: Record<AcademyLockReason, string> = {
  not_current: "Ещё не текущий уровень",
  sequence: "Сначала завершите предыдущие уровни",
  xp: "Недостаточно XP",
  checkpoint: "Требуется контрольная точка",
  external: "Требуется внешнее условие",
  inactive: "Уровень недоступен",
  visibility: "Уровень пока недоступен",
  unknown: "Уровень заблокирован",
};

// Priority order: the most actionable/meaningful reason wins.
const BLOCKER_PRIORITY: BackendBlocker[] = [
  "checkpoint_verification_unavailable",
  "checkpoint_engine_unavailable",
  "xp_insufficient",
  "xp_engine_unavailable",
  "visibility_rule_unsupported",
  "definition_inactive",
  "sequence_incomplete",
  "not_current_level",
];

const BLOCKER_REASON: Record<BackendBlocker, AcademyLockReason> = {
  checkpoint_verification_unavailable: "checkpoint",
  checkpoint_engine_unavailable: "checkpoint",
  xp_insufficient: "xp",
  xp_engine_unavailable: "xp",
  visibility_rule_unsupported: "visibility",
  definition_inactive: "inactive",
  sequence_incomplete: "sequence",
  not_current_level: "not_current",
};

function deriveLockReason(blockers: string[], isExternal: boolean): AcademyLockReason {
  // An external-event gate is the dominant reason when present (Pocket/external).
  if (isExternal) return "external";
  for (const blocker of BLOCKER_PRIORITY) {
    if (blockers.includes(blocker)) return BLOCKER_REASON[blocker];
  }
  return "unknown";
}

function locked(reason: AcademyLockReason): AcademyStateInfo {
  return {
    state: "locked",
    lockReason: reason,
    label: `${STATE_LABEL.locked}: ${LOCK_LABEL[reason]}`,
    routeAccessible: false,
    contentViewable: false,
    terminal: false,
  };
}

export type MapStateInput = {
  /** Present in enrolled context; absent (undefined) in completed context. */
  presentationState?: string;
  blockers?: string[];
  /** Durable progress status when present (in_progress | pending_review | completed). */
  durableStatus?: string | null;
  isExternal: boolean;
};

export function mapLevelState(input: MapStateInput): AcademyStateInfo {
  // Completed context: no presentationState — completion is the durable truth.
  if (input.presentationState === undefined) {
    if (input.durableStatus === "completed") {
      return { state: "completed", lockReason: null, label: STATE_LABEL.completed, routeAccessible: true, contentViewable: true, terminal: true };
    }
    if (input.durableStatus === "pending_review") {
      return { state: "pending_review", lockReason: null, label: STATE_LABEL.pending_review, routeAccessible: true, contentViewable: true, terminal: false };
    }
    if (input.durableStatus === "in_progress") {
      return { state: "in_progress", lockReason: null, label: STATE_LABEL.in_progress, routeAccessible: true, contentViewable: true, terminal: false };
    }
    // No durable status in a completed enrollment -> treat as completed-context locked/done, but never accessible-by-default.
    return locked("unknown");
  }

  const blockers = input.blockers ?? [];
  switch (input.presentationState) {
    case "completed":
      return { state: "completed", lockReason: null, label: STATE_LABEL.completed, routeAccessible: true, contentViewable: true, terminal: true };
    case "pending_review":
      return { state: "pending_review", lockReason: null, label: STATE_LABEL.pending_review, routeAccessible: true, contentViewable: true, terminal: false };
    case "in_progress":
      return { state: "in_progress", lockReason: null, label: STATE_LABEL.in_progress, routeAccessible: true, contentViewable: true, terminal: false };
    case "available":
      return { state: "available", lockReason: null, label: STATE_LABEL.available, routeAccessible: true, contentViewable: true, terminal: false };
    case "checkpoint_unverified":
      // The route opens so the learner can read the gate — its condition, what
      // it opens, and why the check is unavailable. `contentViewable` stays
      // false: a checkpoint has no lesson content, and the Backend refuses it
      // regardless. `terminal` is false because the learner is not finished.
      return {
        state: "checkpoint_unverified",
        lockReason: null,
        label: STATE_LABEL.checkpoint_unverified,
        routeAccessible: true,
        contentViewable: false,
        terminal: false,
      };
    case "xp_eligible":
      // XP satisfied but sequence/current-level not reached: still not startable.
      return locked(deriveLockReason(blockers, input.isExternal));
    case "locked":
      return locked(deriveLockReason(blockers, input.isExternal));
    default:
      // Unknown Backend state MUST fail locked (never unlock).
      return locked("unknown");
  }
}

export { STATE_LABEL, LOCK_LABEL };
