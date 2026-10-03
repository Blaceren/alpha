/**
 * The learner-facing meaning of each operational support status.
 *
 * An unmapped code renders as itself rather than as an invented phrase — this
 * repository has shipped a raw enum to a learner once already, and the fix was
 * to add the label, not to add a fallback that hides the gap.
 *
 * One map for every place a learner reads a status: the support desk, and
 * since 2026-10-03 the profile's support card (support is a part of the
 * profile now). Moved here from the desk unchanged.
 */
const STATUS_TEXT: Record<string, string> = {
  new: "Получено",
  open: "Получено",
  in_progress: "В работе",
  waiting_learner: "Ждём вашего ответа",
  waiting_internal: "Уточняем внутри команды",
  waiting_external: "Ждём ответа провайдера",
  escalated: "Передано специалисту",
  resolved: "Решено",
  closed: "Закрыто",
};

export const CLOSED_STATUSES: ReadonlySet<string> = new Set(["resolved", "closed"]);

export function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status;
}
