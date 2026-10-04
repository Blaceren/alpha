/**
 * Entry Checklist (L20) — enter or skip, decided before the button is pressed
 * in Pocket.
 *
 * THE BACKEND IS THE AUTHORITY. The nine items come from the Backend, and the
 * verdict below copies its rule (`backend/src/lib/tools/entry-checklist.ts`) so
 * it follows the learner's ticks live; a kept check carries the Backend's own
 * verdict.
 *
 *   any stop factor not confirmed   «Не входить: стоп-фактор» — this wins
 *   any other item not confirmed    «Не входить: условие не выполнено»
 *   all nine confirmed              «Вход по плану допустим»
 *
 * The verdict names the first unconfirmed item in the list's order. Declining a
 * trade is a full decision (L08): a «не входить» check is kept like any other.
 * Nothing is ticked for the learner, and nothing is read from Pocket.
 */
import { localDateTime } from "../model/local-date";
import { PAYOUT_LIMITS, parsePayoutPercent } from "../model/numeric-input";

/* ------------------------------------------------------------------ types */

export type ChecklistVerdict = "enter" | "skip_stop" | "skip_condition";

export type ChecklistItem = {
  readonly code: string;
  readonly group: string;
  readonly stop: boolean;
  readonly label: string;
};

export type ChecklistGroup = { readonly code: string; readonly label: string };

export type ChecklistAnswers = Readonly<Record<string, boolean>>;

/** One kept check, exactly as the Backend sends it. */
export type EntryCheck = {
  readonly id: string;
  readonly asset: { readonly code: string; readonly label: string };
  readonly minPayoutPercent: number | null;
  readonly answers: ChecklistAnswers;
  readonly verdict: ChecklistVerdict;
  readonly missingItem: string | null;
  readonly createdAt: string;
};

export type ChecklistState = {
  readonly recent: readonly EntryCheck[];
  readonly lastMinPayoutPercent: number | null;
  readonly checklist: { readonly groups: readonly ChecklistGroup[]; readonly items: readonly ChecklistItem[] };
  readonly reference: {
    readonly assets: ReadonlyArray<{ readonly code: string; readonly label: string; readonly group: string }>;
  };
};

/** What the form holds: the asset, the minimum as typed, and the ticks. */
export type ChecklistDraft = {
  asset: string;
  minPayoutPercent: string;
  answers: Record<string, boolean>;
};

export type ChecklistField = "asset" | "minPayoutPercent";
export type ChecklistErrors = Partial<Record<ChecklistField, string>>;

/** What the Backend accepts. */
export type EntryCheckInput = {
  asset: string;
  minPayoutPercent: number | null;
  answers: Record<string, boolean>;
};

/* ------------------------------------------------------------ the verdict */

/** Same rule as the Backend: stop factors first, then the rest, each in list order. */
export function checklistVerdict(
  items: readonly ChecklistItem[],
  answers: ChecklistAnswers,
): { verdict: ChecklistVerdict; missingItem: ChecklistItem | null } {
  const stop = items.find((item) => item.stop && !answers[item.code]);
  if (stop) return { verdict: "skip_stop", missingItem: stop };
  const condition = items.find((item) => !answers[item.code]);
  if (condition) return { verdict: "skip_condition", missingItem: condition };
  return { verdict: "enter", missingItem: null };
}

export function confirmedCount(items: readonly ChecklistItem[], answers: ChecklistAnswers): number {
  return items.filter((item) => answers[item.code]).length;
}

/**
 * The item as the learner reads it. The payout item carries the learner's own
 * minimum when they set one: «Payout не ниже моего минимума — 85%».
 */
export function itemLabel(item: ChecklistItem, minPayoutPercent: number | null): string {
  return item.code === "payout_minimum" && minPayoutPercent !== null
    ? `${item.label} — ${minPayoutPercent}%`
    : item.label;
}

/** The verdict in the presentation's words. */
export function verdictWords(
  verdict: ChecklistVerdict,
  missing: string | null,
): { title: string; body: string } {
  switch (verdict) {
    case "enter":
      return {
        title: "Вход по плану допустим",
        body: "Все условия выполнены. Решение и сумму вы подтверждаете сами.",
      };
    case "skip_stop":
      return {
        title: "Не входить: стоп-фактор",
        body: `Не отмечено: «${missing ?? ""}». Отказ от сделки — полноценное решение.`,
      };
    case "skip_condition":
      return {
        title: "Не входить: условие не выполнено",
        body: `Не отмечено: «${missing ?? ""}». Отказ от сделки — полноценное решение.`,
      };
  }
}

/** A kept check's verdict in one line, for the list of checks. */
export function verdictLine(check: EntryCheck, items: readonly ChecklistItem[]): string {
  if (check.verdict === "enter") return "Вход допустим";
  const item = items.find((candidate) => candidate.code === check.missingItem);
  const label = item ? itemLabel(item, check.minPayoutPercent) : (check.missingItem ?? "");
  return check.verdict === "skip_stop" ? `Не входить · стоп-фактор: ${label}` : `Не входить · условие: ${label}`;
}

/* ----------------------------------------------------------------- drafts */

export function emptyAnswers(items: readonly ChecklistItem[]): Record<string, boolean> {
  return Object.fromEntries(items.map((item) => [item.code, false]));
}

/** A fresh check: the learner's last minimum, no asset, nothing ticked. */
export function emptyChecklistDraft(state: Pick<ChecklistState, "checklist" | "lastMinPayoutPercent">): ChecklistDraft {
  return {
    asset: "",
    minPayoutPercent: state.lastMinPayoutPercent === null ? "" : String(state.lastMinPayoutPercent),
    answers: emptyAnswers(state.checklist.items),
  };
}

/** The minimum as a number: null when empty, undefined when it is not a valid one. */
export function parseMinPayout(raw: string): number | null | undefined {
  if (raw.trim() === "") return null;
  return parsePayoutPercent(raw) ?? undefined;
}

/** The learner's own minimum is a payout like any other — the same range — and may be left empty. */
export const MIN_PAYOUT_MESSAGE = `Минимум payout — целое число от ${PAYOUT_LIMITS.min} до ${PAYOUT_LIMITS.max}, или оставьте поле пустым.`;

const MESSAGES: Record<ChecklistField, string> = {
  asset: "Выберите актив, для которого проверка.",
  minPayoutPercent: MIN_PAYOUT_MESSAGE,
};

export function checklistFieldMessage(field: ChecklistField): string {
  return MESSAGES[field];
}

export function validateChecklistDraft(
  draft: ChecklistDraft,
  state: Pick<ChecklistState, "checklist" | "reference">,
): { ok: true; check: EntryCheckInput } | { ok: false; errors: ChecklistErrors } {
  const errors: ChecklistErrors = {};
  if (!state.reference.assets.some((asset) => asset.code === draft.asset)) errors.asset = MESSAGES.asset;
  const minPayoutPercent = parseMinPayout(draft.minPayoutPercent);
  if (minPayoutPercent === undefined) errors.minPayoutPercent = MESSAGES.minPayoutPercent;
  if (Object.keys(errors).length > 0 || minPayoutPercent === undefined) return { ok: false, errors };
  return {
    ok: true,
    check: {
      asset: draft.asset,
      minPayoutPercent,
      answers: Object.fromEntries(state.checklist.items.map((item) => [item.code, draft.answers[item.code] === true])),
    },
  };
}

export function checklistFieldOfServerDetail(detail: string | null): ChecklistField | null {
  if (detail === "invalid_asset") return "asset";
  if (detail === "invalid_minPayoutPercent") return "minPayoutPercent";
  return null;
}

/** «21 сентября, 14:30»: when a check was made, on the learner's clock. */
export const checkTime = localDateTime;
