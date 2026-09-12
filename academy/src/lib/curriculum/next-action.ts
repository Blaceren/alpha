/**
 * THE ONE ANSWER TO "WHAT SHOULD I DO NOW?".
 *
 * WHY THIS EXISTS. Home, Path and the level page each used to work out the
 * learner's situation for themselves — Home showed "current level" with a link,
 * Path showed a hundred equal rows, the level page showed whichever surface its
 * own props implied. Three readings of the same canonical state is three chances
 * to disagree, and a learner who is told different things by three screens stops
 * trusting all of them. This module derives the answer once so every surface
 * renders the SAME sentence (ACADEMY-EXPERIENCE-COMPLETION-1 §19).
 *
 * WHAT IT IS NOT. It is not a progression engine, and it cannot become one.
 * Every input is a decision the Backend already made — the effective level
 * state, the lock reason, the completion method, the checkpoint verification
 * verdict — and this file only chooses which sentence describes that decision.
 * It has no access to XP totals, sequence rules, review outcomes or provider
 * responses, so it cannot conclude that a level is passable. If the Backend says
 * `locked`, every branch here still says locked; the only thing that varies is
 * how honestly the reason is phrased.
 *
 * THE FAIL-CLOSED RULE. An unrecognised combination resolves to `blocked` with
 * an unknown reason, never to an actionable state. Being vague is a product
 * defect; inviting a learner to act on a level the server will refuse is a
 * trust defect, and the second is much worse.
 */
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";
import type { AcademyCompletionMethod } from "@/lib/curriculum/completion-method";

/**
 * What the learner is being asked to do, in canonical terms.
 *
 * The vocabulary is closed on purpose: each member corresponds to a real
 * situation the Backend can actually be in, and adding one means a Backend state
 * exists that we can prove. The three `wait-*` members are deliberately separate
 * from `blocked` — waiting is not being stuck, and a learner who is waiting has
 * already done their part.
 */
export type NextActionKind =
  | "start-lesson"
  | "continue-lesson"
  | "take-assessment"
  | "retry-assessment"
  | "complete-practical"
  | "submit-report"
  | "revise-report"
  | "wait-report-review"
  | "request-mentor-review"
  | "wait-mentor-review"
  | "verify-checkpoint"
  | "wait-checkpoint"
  | "start-registration"
  | "wait-registration"
  | "continue-next-level"
  | "blocked"
  | "course-complete"
  | "not-enrolled";

/** Whether the learner can act, is waiting on someone else, or is stopped. */
export type NextActionPosture = "act" | "waiting" | "blocked" | "done";

export type AcademyNextAction = {
  kind: NextActionKind;
  posture: NextActionPosture;
  /** Imperative, learner-facing, one line. */
  title: string;
  /** Why this is the next step / what is being waited for. Never internal jargon. */
  explanation: string;
  /** Button text, or null when there is nothing to press. */
  ctaLabel: string | null;
  href: string | null;
  /** The level this action concerns, when there is one. */
  level: AcademyLevelSummary | null;
  module: AcademyModuleSummary | null;
};

/* -------------------------------------------------------------------------- */

/**
 * Checkpoint verification states that mean "the platform is working on it or
 * cannot ask right now". None of them is the learner's fault and none is a
 * balance — see academy-view.ts on why no amount can reach this file.
 */
const CHECKPOINT_WAITING = new Set([
  "checking",
  "cooldown",
  "verification_unavailable",
  "unsupported",
]);

/**
 * Reason text for a checkpoint the platform cannot currently confirm.
 *
 * Every branch describes the PLATFORM's situation, never the learner's money.
 * "not_met" is the one member that is about the requirement itself, and even
 * there the sentence names the requirement, not an amount — the amount belongs
 * to the published curriculum, which the level title already carries.
 */
function checkpointExplanation(reason: string): string {
  switch (reason) {
    case "not_met":
      return "Требование контрольной точки пока не выполнено.";
    case "cooldown_active":
    case "rate_limited":
      return "Проверка недавно выполнялась. Повторите чуть позже.";
    case "identity_unlinked":
      return "Счёт ещё не связан с аккаунтом Академии.";
    case "identity_mismatch":
      return "Связанный счёт не совпадает с аккаунтом Академии.";
    case "provider_timeout":
    case "provider_maintenance":
    case "provider_rate_limited":
    case "provider_disabled":
    case "provider_unconfigured":
      return "Сейчас не удаётся получить подтверждение. Мы повторим проверку автоматически.";
    case "requirement_unconfigured":
    case "checkpoint_disabled":
    case "integration_unknown":
    case "invalid_provider_response":
    case "unsupported_currency":
    case "stale":
    case "unsupported":
      return "Проверка этой контрольной точки сейчас недоступна. Мы уже знаем об этом.";
    default:
      return "Проверка контрольной точки пока не завершена.";
  }
}

/** Learner-facing reason for a locked level, from the Backend's own blocker. */
function lockExplanation(level: AcademyLevelSummary): string {
  switch (level.lockReason) {
    case "sequence":
      return "Сначала нужно завершить предыдущие уровни.";
    case "not_current":
      return "Этот уровень откроется, когда вы дойдёте до него по программе.";
    case "xp":
      return "Для этого уровня нужно больше опыта с предыдущих шагов.";
    case "checkpoint":
      return "Нужно пройти контрольную точку на более раннем уровне.";
    case "external":
      return "Нужно подтверждение внешнего условия на более раннем уровне.";
    case "inactive":
      return "Уровень временно недоступен в программе.";
    case "visibility":
      return "Уровень пока не открыт в вашей программе.";
    default:
      return "Уровень пока закрыт.";
  }
}

/**
 * A canonical fact a level's own owner knows that the progression engine does
 * not. Optional everywhere: the derivation is complete without it and only ever
 * becomes MORE specific when one is supplied.
 *
 * Today there is exactly one member. A report that a reviewer returned for
 * corrections is `in_progress` to the progression engine — deliberately, so the
 * learner can act on it again — which makes it indistinguishable from a report
 * that was never written. `reportState` is the report owner's own answer, read
 * separately, and it is the difference between "подготовьте отчёт" and "внесите
 * правки". See server/curriculum/report-state-read.ts.
 */
export type NextActionDetail = {
  readonly reportState?: "available" | "draft" | "pending_review" | "rejected" | "approved" | null;
};

/** The action for a level the learner may work on right now. */
function actionableLevel(
  level: AcademyLevelSummary,
  module: AcademyModuleSummary | null,
  detail: NextActionDetail = {},
): AcademyNextAction {
  const base = { level, module, href: level.href } as const;
  const inProgress = level.state === "in_progress";
  const method: AcademyCompletionMethod = level.completionMethod;

  switch (method) {
    case "assessment":
      return {
        ...base,
        kind: inProgress ? "retry-assessment" : "take-assessment",
        posture: "act",
        title: inProgress ? "Продолжите проверку знаний" : "Пройдите проверку знаний",
        explanation: inProgress
          ? "Вы уже начали этот уровень. Проверка знаний завершит его."
          : "Изучите урок и пройдите короткую проверку, чтобы завершить уровень.",
        ctaLabel: inProgress ? "Продолжить" : "Открыть уровень",
      };

    case "manual":
      return {
        ...base,
        kind: inProgress ? "complete-practical" : "start-lesson",
        posture: "act",
        title: inProgress ? "Завершите практический шаг" : "Выполните практический шаг",
        // Honest about who confirms it: the learner does. Nothing here claims ATA
        // watched a real trading action (§11).
        explanation:
          "Этот уровень выполняется вами самостоятельно — отметьте выполнение, когда закончите.",
        ctaLabel: inProgress ? "Продолжить" : "Открыть уровень",
      };

    case "report": {
      // THE §16 DISTINCTION. A returned report and an unwritten one are the
      // same progression state; only the report owner can tell them apart, and
      // when it has told us, we say the specific thing.
      if (detail.reportState === "rejected") {
        return {
          ...base,
          kind: "revise-report",
          posture: "act",
          title: "Внесите правки в отчёт",
          explanation:
            "Наставник вернул отчёт с замечаниями. Исправьте их и отправьте отчёт снова — уровень пока не завершён.",
          ctaLabel: "Открыть отчёт",
        };
      }
      if (detail.reportState === "draft") {
        return {
          ...base,
          kind: "submit-report",
          posture: "act",
          title: "Допишите и отправьте отчёт",
          explanation: "Черновик отчёта сохранён. Закончите его и отправьте на проверку наставнику.",
          ctaLabel: "Продолжить отчёт",
        };
      }
      return {
        ...base,
        kind: "submit-report",
        posture: "act",
        title: "Подготовьте и отправьте отчёт",
        explanation: "Отчёт проверяет наставник. После одобрения уровень будет завершён.",
        ctaLabel: "Открыть отчёт",
      };
    }

    case "mentor-review":
      return {
        ...base,
        kind: "request-mentor-review",
        posture: "act",
        title: "Отправьте работу на проверку наставнику",
        explanation: "Наставник посмотрит работу и подтвердит завершение уровня.",
        ctaLabel: "Открыть уровень",
      };

    case "checkpoint": {
      const cp = level.checkpoint;
      if (cp && CHECKPOINT_WAITING.has(cp.verificationState)) {
        return {
          ...base,
          kind: "wait-checkpoint",
          posture: "waiting",
          title: "Проверяем контрольную точку",
          explanation: checkpointExplanation(cp.reason),
          ctaLabel: "Посмотреть контрольную точку",
        };
      }
      if (cp && cp.verificationState === "not_met") {
        return {
          ...base,
          kind: "verify-checkpoint",
          posture: "blocked",
          title: "Контрольная точка пока не пройдена",
          explanation: checkpointExplanation(cp.reason),
          ctaLabel: "Посмотреть требование",
        };
      }
      return {
        ...base,
        kind: "verify-checkpoint",
        posture: "act",
        title: "Пройдите контрольную точку",
        explanation: "Это требование программы. Откройте уровень, чтобы увидеть, что нужно.",
        ctaLabel: "Открыть контрольную точку",
      };
    }

    case "external-event":
      return {
        ...base,
        kind: inProgress ? "wait-registration" : "start-registration",
        posture: inProgress ? "waiting" : "act",
        title: inProgress ? "Ожидаем подтверждение регистрации" : "Пройдите регистрацию",
        explanation: inProgress
          ? "Мы ждём подтверждение от партнёра. Уровень завершится автоматически, когда оно придёт."
          : "Для этого уровня нужна регистрация у партнёра. Откройте уровень — там есть ссылка и инструкция.",
        ctaLabel: "Открыть уровень",
      };

    default:
      // `unsupported` — a level type this build does not understand. Say so
      // rather than offering a control that will not work.
      return {
        ...base,
        kind: "blocked",
        posture: "blocked",
        title: "Уровень пока недоступен",
        explanation: "Этот тип уровня не поддерживается текущей версией приложения.",
        ctaLabel: null,
        href: null,
      };
  }
}

/** The action for a level whose outcome someone else owns right now. */
function pendingLevel(
  level: AcademyLevelSummary,
  module: AcademyModuleSummary | null,
): AcademyNextAction {
  const base = { level, module, href: level.href, ctaLabel: "Посмотреть статус" } as const;

  // The distinction §14 turns on: a report under review and a mentor review are
  // both `pending_review` to the progression engine, and the learner is waiting
  // for different people with different next steps.
  if (level.completionMethod === "report") {
    return {
      ...base,
      kind: "wait-report-review",
      posture: "waiting",
      title: "Отчёт на проверке",
      explanation:
        "Наставник читает ваш отчёт. Если потребуются правки, вы увидите их здесь — уровень пока не завершён.",
    };
  }
  if (level.completionMethod === "mentor-review") {
    return {
      ...base,
      kind: "wait-mentor-review",
      posture: "waiting",
      title: "Работа на проверке у наставника",
      // Says plainly that a message is not an approval — the exact confusion §14
      // asks the product to make impossible.
      explanation:
        "Наставник может написать вам до решения. Уровень завершится только после подтверждения наставника.",
    };
  }
  return {
    ...base,
    kind: "wait-report-review",
    posture: "waiting",
    title: "Ожидает проверки",
    explanation: "Мы сообщим, когда проверка завершится.",
  };
}

/* -------------------------------------------------------------------------- */

type Enrolled = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

/**
 * Find the level the learner should act on, and describe it.
 *
 * SELECTION ORDER, and why. The Backend names a current level and a next
 * available level; when they disagree the current one wins, because a level the
 * learner has already opened is where they left off. If neither is set — a fresh
 * enrolment, or a state this build cannot read — we fall back to the first level
 * that is not completed, in curriculum order, and if every level is complete the
 * answer is that the programme is finished.
 */
export function deriveNextAction(
  view: AcademyCurriculumView,
  /**
   * Optional canonical detail the progression read cannot carry. Absent by
   * default, so every existing caller keeps its exact behaviour and the
   * derivation stays a pure function of canonical facts.
   */
  detail: NextActionDetail = {},
): AcademyNextAction {
  if (view.state === "unavailable" || view.state === "candidate") {
    return {
      kind: "not-enrolled",
      posture: "blocked",
      title: "Программа пока недоступна",
      explanation:
        view.state === "candidate"
          ? "Вы ещё не зачислены на программу. Зачисление появится позже."
          : "Активная учебная программа пока не опубликована.",
      ctaLabel: null,
      href: null,
      level: null,
      module: null,
    };
  }

  const enrolled = view as Enrolled;
  const moduleOf = new Map<string, AcademyModuleSummary>();
  for (const m of enrolled.modules) for (const l of m.levels) moduleOf.set(l.levelCode, m);
  const levels = enrolled.modules.flatMap((m) => m.levels);

  const byCode = (code: string | null) =>
    code ? levels.find((l) => l.levelCode === code) ?? null : null;

  const target =
    byCode(enrolled.progress.currentLevelCode) ??
    byCode(enrolled.progress.nextAvailableLevelCode) ??
    levels.find((l) => l.state !== "completed") ??
    null;

  if (!target) {
    return {
      kind: "course-complete",
      posture: "done",
      title: "Программа пройдена",
      explanation: `Вы завершили все ${enrolled.progress.totalLevels} уровней. Материалы остаются доступными.`,
      ctaLabel: "Открыть путь",
      href: "/path",
      level: null,
      module: null,
    };
  }

  const levelModule = moduleOf.get(target.levelCode) ?? null;

  switch (target.state) {
    case "pending_review":
      return pendingLevel(target, levelModule);

    case "available":
    case "in_progress":
      return actionableLevel(target, levelModule, detail);

    case "checkpoint_unverified":
      return {
        kind: "wait-checkpoint",
        posture: "waiting",
        title: "Проверка контрольной точки недоступна",
        explanation: target.checkpoint
          ? checkpointExplanation(target.checkpoint.reason)
          : "Мы пока не можем подтвердить эту контрольную точку.",
        ctaLabel: "Посмотреть контрольную точку",
        href: target.href,
        level: target,
        module: levelModule,
      };

    case "completed": {
      // The named level is finished but nothing later is open yet: the honest
      // answer is "continue", not a second invitation to redo it.
      const nextOpen = levels.find(
        (l) => l.order > target.order && (l.state === "available" || l.state === "in_progress"),
      );
      if (nextOpen) return actionableLevel(nextOpen, moduleOf.get(nextOpen.levelCode) ?? null, detail);
      return {
        kind: "continue-next-level",
        posture: "waiting",
        title: "Уровень завершён",
        explanation: "Следующий шаг откроется, когда программа его подготовит.",
        ctaLabel: "Открыть путь",
        href: "/path",
        level: target,
        module: levelModule,
      };
    }

    case "locked":
    default:
      return {
        kind: "blocked",
        posture: "blocked",
        title: "Следующий уровень пока закрыт",
        explanation: lockExplanation(target),
        ctaLabel: target.routeAccessible ? "Посмотреть уровень" : null,
        href: target.routeAccessible ? target.href : null,
        level: target,
        module: levelModule,
      };
  }
}

/**
 * The learner-facing lock sentence for ANY level, shared by Path and the level
 * page so a locked row and the page it opens never explain themselves
 * differently. Exported separately because most locked levels are not the next
 * action and still have to say why.
 */
export function explainLevelState(level: AcademyLevelSummary): string {
  if (level.state === "locked") return lockExplanation(level);
  if (level.state === "checkpoint_unverified") {
    return level.checkpoint
      ? checkpointExplanation(level.checkpoint.reason)
      : "Проверка контрольной точки сейчас недоступна.";
  }
  if (level.state === "pending_review") {
    return level.completionMethod === "mentor-review"
      ? "Наставник ещё не подтвердил завершение."
      : "Проверка ещё не завершена.";
  }
  if (level.state === "completed") return "Уровень завершён.";
  if (level.state === "in_progress") return "Вы начали этот уровень.";
  return "Уровень доступен для прохождения.";
}
