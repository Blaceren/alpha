import type { AcademyNextAction, NextActionKind } from "@/lib/curriculum/next-action";
import type { CurriculumReadError } from "@/lib/curriculum/read-errors";

/**
 * AUTHENTICATED HOME — the field's posture, and the copy that belongs to the
 * frozen contract rather than to the product.
 *
 * FIVE ARCHITECTURAL CLASSES, and the whole surface is one of them at a time:
 *
 *   ACTION   something is required of the learner now, with one handoff
 *   WAIT     someone or something else holds the work; no learner action
 *   NONE     nothing is required
 *   UNKNOWN  the priority could not be determined, and Home declines to guess
 *   LOADING  no truth yet — not a focus posture, and never a skeleton of one
 *
 * WHERE EACH SENTENCE COMES FROM, AND WHY THE SPLIT IS HERE AND NOT ELSEWHERE:
 *
 *   * THE PRODUCT owns what is true of THIS learner right now — which level,
 *     which posture, what the consequence is and why. That is
 *     `deriveNextAction`, the same computation Path renders, and its `title`
 *     and `explanation` are the consequence and the causal basis.
 *
 *   * THE FROZEN CONTRACT owns the words that belong to the SURFACE rather
 *     than to any learner: the five posture labels, the holding-authority
 *     values, the no-action line, the three UNKNOWN sentences and the two
 *     pending lines. Those are not facts about a learner and the product has no
 *     authority to reword them.
 *
 * Nothing here re-decides progression. Every branch reads a `kind` the
 * curriculum layer already chose.
 */
export type HomePosture = "ACTION" | "WAIT" | "NONE" | "UNKNOWN" | "LOADING";

/**
 * The posture word. It names the CONDITION the learner is in. It is a statement
 * in the registration rail — never a badge, a chip or a status pill.
 *
 * UNKNOWN reads «приоритет не определён» and not «состояние не определено»:
 * the earlier wording named a system state, and Home's subject is the learner's
 * current priority.
 */
export const POSTURE_LABEL: Record<HomePosture, string> = {
  ACTION: "требуется действие",
  WAIT: "ожидание",
  NONE: "ничего не требуется",
  UNKNOWN: "приоритет не определён",
  LOADING: "определяем приоритет",
};

/**
 * The holding authority for each waiting kind: a ROLE or a SYSTEM, never a
 * person, never an avatar, never a link. The product has exactly five waiting
 * kinds and the frozen contract has exactly five authorities; this is that map
 * and nothing else.
 */
const AUTHORITY: Partial<Record<NextActionKind, string>> = {
  "wait-mentor-review": "наставник",
  "wait-report-review": "проверяющий",
  "wait-registration": "внешний партнёр",
  "wait-checkpoint": "система проверки",
  /* The programme itself is holding the next step — a system rule, never a
     person. `blocked` lands here too: a locked level is the sequence holding
     the learner, and the level's own lock sentence is the causal basis. */
  "continue-next-level": "последовательность программы",
  blocked: "последовательность программы",
};

export const AUTHORITY_KEY = "ожидает";
export const NO_LEARNER_ACTION = "Сейчас от вас ничего не требуется.";

/** The two pending lines, and the threshold between them. */
export const PENDING_INITIAL = "Определяем, что сейчас важно";
export const PENDING_LONG_WAIT =
  "Всё ещё определяем, что сейчас важно. Мы дождёмся точного ответа и не покажем предположение.";

/**
 * THE LONG-WAIT THRESHOLD — page interaction design, deliberately NOT a token.
 *
 * It describes this page's behaviour in time, not the system's appearance, and a
 * token would invite another surface to inherit a latency decision made for
 * Home's silence.
 *
 * 4000 ms, and the reasoning matters: it is precisely BECAUSE nothing moves —
 * no spinner, no skeleton, no progress, no changing geometry — that the
 * acknowledgement has to arrive early. A motionless surface has nothing else to
 * say "still working" with, and by eight seconds it already reads as stalled.
 *
 * Not a token, not a global timing rule, not a measured percentile, not an SLA
 * and not a production timeout.
 */
export const LONG_WAIT_MS = 4000;

/** The UNKNOWN copy. All three entries share the consequence, deliberately. */
export const UNKNOWN_CONSEQUENCE = "Сейчас не удаётся определить, что для вас главное";
export const UNKNOWN_NOT_ENROLLED =
  "Учебная программа не связана с вашим аккаунтом. Мы не показываем предположение вместо точного ответа.";
export const UNKNOWN_READ_FAILURE =
  "Часть данных о вашей программе временно недоступна. Мы не показываем предположение вместо точного ответа.";
export const UNKNOWN_UNRECOVERABLE =
  "Данные о вашей программе сейчас недоступны. Мы не показываем предположение вместо точного ответа.";
export const RETRY_LABEL = "Проверить данные ещё раз";

/** NONE, for the two states that genuinely ask nothing of anyone. */
export const NONE_COMPLETE = {
  consequence: "Программа пройдена",
  basis: "Все уровни программы завершены. Ничего не ожидает вашего участия.",
} as const;
export const NONE_NO_CURRICULUM = {
  consequence: "Учебная программа не опубликована",
  basis:
    "Сейчас в Академии нет опубликованной программы. Это относится ко всем учащимся, а не только к вашему аккаунту.",
} as const;

/** The route-level boundary. PAGE_FAILURE is not UNKNOWN — see the component. */
export const PAGE_FAILURE = {
  heading: "Страница не открылась",
  explanation:
    "Академия не смогла подготовить эту страницу. Это сбой на нашей стороне — не в вашем аккаунте и не в ваших действиях.",
  retry: "Загрузить страницу заново",
  referenceLabel: "Код обращения",
} as const;

/**
 * The field the surface renders, resolved from the canonical decision.
 *
 * `workIdentity` is present only where naming the work is what makes the
 * consequence intelligible; the frozen contract records an explicit reason
 * wherever it is absent, and the reason here is uniform: the level the action
 * concerns, when there is one.
 */
export type HomeField =
  | {
      posture: "ACTION";
      stateKey: string;
      workIdentity: string | null;
      consequence: string;
      basis: string | null;
      control: { label: string; href: string; levelCode: string | null };
    }
  | {
      posture: "WAIT";
      stateKey: string;
      workIdentity: string | null;
      consequence: string;
      basis: string | null;
      authority: string;
    }
  | { posture: "NONE"; stateKey: string; consequence: string; basis: string | null }
  | {
      posture: "UNKNOWN";
      stateKey: string;
      consequence: string;
      basis: string;
      retry: boolean;
    };

/** The field for a curriculum read that failed. */
export function fieldForError(error: CurriculumReadError): HomeField {
  return {
    posture: "UNKNOWN",
    stateKey: "PRIORITY_AUTHORITY_READ_FAILURE",
    consequence: UNKNOWN_CONSEQUENCE,
    /* «временно недоступна» is only true where the source classified the
       failure as recoverable. Anywhere else it would promise a recovery
       nobody has offered. */
    basis: error.retryable ? UNKNOWN_READ_FAILURE : UNKNOWN_UNRECOVERABLE,
    retry: error.retryable,
  };
}

/** The field for a learner with an account but no programme attached. */
export const FIELD_NOT_ENROLLED: HomeField = {
  posture: "UNKNOWN",
  stateKey: "NOT_ENROLLED",
  consequence: UNKNOWN_CONSEQUENCE,
  basis: UNKNOWN_NOT_ENROLLED,
  /* Re-reading returns the same absence. A retry control here would offer a
     second falsehood on top of the first: that pressing it might change the
     answer. */
  retry: false,
};

/** The field for an Academy with no published programme at all. */
export const FIELD_NO_CURRICULUM: HomeField = {
  posture: "NONE",
  stateKey: "NO_ACTIVE_CURRICULUM",
  consequence: NONE_NO_CURRICULUM.consequence,
  basis: NONE_NO_CURRICULUM.basis,
};

/**
 * The field for an enrolled learner, from the canonical next action.
 *
 * The posture comes from the decision's own posture, and the only translation
 * is `blocked` → WAIT: a locked next level is the programme sequence holding
 * the learner, which is a waiting condition with a named authority, not a
 * demand and not an absence of one.
 */
export function fieldForAction(action: AcademyNextAction): HomeField {
  const stateKey = action.kind.toUpperCase().replace(/-/g, "_");
  const workIdentity = action.level?.title ?? null;

  if (action.kind === "course-complete") {
    return {
      posture: "NONE",
      stateKey: "PROGRAM_COMPLETE",
      consequence: NONE_COMPLETE.consequence,
      basis: NONE_COMPLETE.basis,
    };
  }

  if (action.kind === "not-enrolled") return FIELD_NOT_ENROLLED;

  if (action.posture === "act" && action.ctaLabel && action.href) {
    return {
      posture: "ACTION",
      stateKey,
      workIdentity,
      consequence: action.title,
      basis: action.explanation || null,
      control: {
        label: action.ctaLabel,
        href: action.href,
        /* `data-level` is the ONLY thing that crosses the handoff. */
        levelCode: action.level?.levelCode ?? null,
      },
    };
  }

  const authority = AUTHORITY[action.kind];
  if (authority) {
    return {
      posture: "WAIT",
      stateKey,
      workIdentity,
      consequence: action.title,
      basis: action.explanation || null,
      authority,
    };
  }

  /* An `act` posture with no control, or a kind with no authority to name. The
     truthful field is NONE: the page states what is so and offers nothing,
     rather than inventing a control or a holder. */
  return {
    posture: "NONE",
    stateKey,
    consequence: action.title,
    basis: action.explanation || null,
  };
}
