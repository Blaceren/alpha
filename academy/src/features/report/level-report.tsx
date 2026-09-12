"use client";

/**
 * L3 learner report workflow (Client Component).
 *
 * The form is driven ENTIRELY by the Backend report definition. Draft/save/
 * submit/resubmit are server-authoritative via the same-origin proxy; this
 * component never computes completion, never writes L3 completion and never
 * awards XP. On a server-confirmed approval it re-reads the authoritative
 * curriculum via `router.refresh()` so L3-completed / L4-available come from the
 * Backend, not the client. Attachments are never surfaced.
 */
import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  fetchReportContext,
  newReportRequestId,
  resubmitReport,
  saveReportDraft,
  submitReport,
} from "@/lib/report/report-client";
import {
  initialState,
  reducer,
  restingEditingStatus,
  type ReportState,
} from "@/features/report/report-machine";
import { isFieldEffectivelyRequired } from "@/features/report/required-when";
import { validateReport } from "@/features/report/report-validation";
import { ReportField } from "@/features/report/components/report-field";
import { ReportStatusPanel } from "@/features/report/components/report-status-panel";
import { ValidationSummary } from "@/features/report/components/validation-summary";
import "@/features/report/report.css";

export type LevelReportProps = {
  stableCode: string;
  locale: string;
  /** From server navigation: next level code once route-accessible, else null. */
  nextLevelCode: string | null;
};

const EDITING_STATUSES = new Set(["NO_REPORT", "DRAFT_READY", "DRAFT_DIRTY", "DRAFT_SAVED", "VALIDATION_ERROR"]);

function statusMessage(state: ReportState): string {
  switch (state.status) {
    case "DEFINITION_LOADING": return "Загрузка формы отчёта…";
    case "DRAFT_CREATING": return "Создаём черновик…";
    case "NEW_REVISION_CREATING": return "Готовим новую версию…";
    case "DRAFT_SAVING": return "Сохраняем черновик…";
    case "DRAFT_SAVED": return "Черновик сохранён на сервере.";
    case "DRAFT_DIRTY": return "Есть несохранённые изменения.";
    case "SUBMITTING": return "Отправляем отчёт на проверку…";
    case "RESUBMITTING": return "Отправляем исправленную версию…";
    case "PENDING_REVIEW": return "Отчёт отправлен и ожидает проверки наставника.";
    case "REVISION_REQUESTED": return "Наставник запросил доработку отчёта.";
    case "APPROVED":
    case "LEVEL_COMPLETED": return "Отчёт принят. Уровень завершён.";
    case "STALE_REVISION": return "Отчёт был изменён в другом месте. Обновите форму.";
    case "VALIDATION_ERROR": return "Проверьте отмеченные поля.";
    case "FLAG_DISABLED": return "Отправка отчёта сейчас недоступна.";
    case "NETWORK_ERROR": return "Не удалось связаться с сервером. Попробуйте ещё раз.";
    case "FATAL_ERROR": return "Не удалось загрузить отчёт.";
    default: return "";
  }
}

export function LevelReport({ stableCode, locale, nextLevelCode }: LevelReportProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      dispatch({ type: "load_pending" });
      return fetchReportContext(stableCode, locale, signal).then((res) => {
        if (signal?.aborted) return;
        if (res.ok) dispatch({ type: "load_ok", context: res.data });
        else dispatch({ type: "load_err", error: res.error });
      });
    },
    [stableCode, locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Announce terminal transitions by moving focus to the live status.
  useEffect(() => {
    if (state.status === "APPROVED" || state.status === "PENDING_REVIEW" || state.status === "REVISION_REQUESTED") {
      statusRef.current?.focus();
    }
  }, [state.status]);

  // When an approval is observed, re-read the server-authoritative curriculum.
  useEffect(() => {
    if (state.status === "APPROVED") router.refresh();
  }, [state.status, router]);

  const onEdit = useCallback((stableKey: string, value: unknown) => {
    dispatch({ type: "edit", stableKey, value });
  }, []);

  const onSave = useCallback(async () => {
    if (inFlight.current || !state.model) return;
    const requestId = newReportRequestId("save");
    dispatch({ type: "save_pending", requestId });
    inFlight.current = true;
    const res = await saveReportDraft(stableCode, state.expectedRevision, state.values, requestId);
    inFlight.current = false;
    if (res.ok) dispatch({ type: "save_ok", result: res.data });
    else dispatch({ type: "save_err", error: res.error });
  }, [stableCode, state.expectedRevision, state.values, state.model]);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (inFlight.current || !state.model) return;
      const requestId = newReportRequestId(state.correcting ? "resubmit" : "submit");
      const correcting = state.correcting;
      dispatch({ type: "submit_pending", requestId });
      // If client validation failed, the reducer stays in VALIDATION_ERROR and
      // no network write happens.
      if (validateReport(state.model, state.values).length > 0) return;
      inFlight.current = true;

      // Submit is server-authoritative and requires a persisted revision. Persist
      // the current values first (this CREATES the draft on the first pass and
      // the corrected revision during a correction), then submit/resubmit at the
      // revision the server just accepted. A clean, already-persisted draft skips
      // the extra save.
      let revision = state.expectedRevision;
      const needSave = state.dirty || !state.context?.submission || correcting;
      if (needSave) {
        const saved = await saveReportDraft(stableCode, revision, state.values, newReportRequestId("save"));
        if (!saved.ok) {
          inFlight.current = false;
          dispatch({ type: "submit_err", error: saved.error });
          return;
        }
        revision = saved.data.resultingWorkflowVersion;
      }

      const res = correcting
        ? await resubmitReport(stableCode, revision, requestId)
        : await submitReport(stableCode, revision, requestId);
      inFlight.current = false;
      if (res.ok) dispatch({ type: "submit_ok", result: res.data });
      else dispatch({ type: "submit_err", error: res.error });
    },
    [stableCode, state.expectedRevision, state.values, state.model, state.correcting, state.dirty, state.context],
  );

  if (state.status === "DEFINITION_LOADING") {
    return (
      <section className="rpt sub-wrap" aria-labelledby="rpt-heading" data-status={state.status}>
        <h2 id="rpt-heading" className="rpt__heading">Отчёт по уровню</h2>
        <p className="rpt__status rpt-bar__state" role="status" aria-live="polite">{statusMessage(state)}</p>
      </section>
    );
  }

  if (state.status === "FLAG_DISABLED") {
    return (
      <section className="rpt sub-wrap" aria-labelledby="rpt-heading" data-status={state.status}>
        <h2 id="rpt-heading" className="rpt__heading">Отчёт по уровню</h2>
        <p className="rpt__notice">Отправка отчёта сейчас недоступна. Материал уровня можно читать выше.</p>
      </section>
    );
  }

  if (state.status === "FATAL_ERROR" || (state.status === "NETWORK_ERROR" && !state.context)) {
    return (
      <section className="rpt sub-wrap" aria-labelledby="rpt-heading" data-status={state.status}>
        <h2 id="rpt-heading" className="rpt__heading">Отчёт по уровню</h2>
        <div className="rpt__notice" role="alert">
          <p>{statusMessage(state)}</p>
          <button type="button" className="rpt__btn btn-2" onClick={() => load()}>Повторить</button>
        </div>
      </section>
    );
  }

  const context = state.context!;
  const model = state.model!;
  const submission = context.submission;
  const editing = EDITING_STATUSES.has(state.status);
  const fieldErrorByKey = new Map(
    state.showErrors ? state.fieldErrors.map((e) => [e.stableKey, e.message] as const) : [],
  );
  const busy = state.status === "DRAFT_SAVING" || state.status === "DRAFT_CREATING"
    || state.status === "NEW_REVISION_CREATING" || state.status === "SUBMITTING" || state.status === "RESUBMITTING";

  return (
    <section className="rpt sub-wrap" aria-labelledby="rpt-heading" data-status={state.status}>
      <header className="rpt__head sub-head">
        <h2 id="rpt-heading" className="rpt__heading sub-head__title" tabIndex={-1}>{context.assignment.title}</h2>
        <p className="rpt__instructions">{context.assignment.instructions}</p>
        {context.assignment.successCriteriaSummary ? (
          <p className="rpt__criteria"><span className="rpt__criteria-label">Критерии:</span> {context.assignment.successCriteriaSummary}</p>
        ) : null}
      </header>

      <p className="rpt__status rpt-bar__state" role="status" aria-live="polite" tabIndex={-1} ref={statusRef} data-status={state.status}>
        {statusMessage(state)}
      </p>

      {state.status === "STALE_REVISION" ? (
        <div className="rpt__notice" role="alert">
          <p>{statusMessage(state)}</p>
          <button type="button" className="rpt__btn btn-2" onClick={() => load()}>Обновить форму</button>
        </div>
      ) : null}

      <ReportStatusPanel submission={submission} />

      {/* Approved / completed */}
      {state.status === "APPROVED" || state.status === "LEVEL_COMPLETED" ? (
        <div className="rpt__done" role="status">
          <p className="rpt__done-title">✓ Отчёт принят — уровень завершён</p>
          {nextLevelCode ? (
            <Link className="rpt__next" href={`/lessons/${encodeURIComponent(nextLevelCode)}`}>Перейти к следующему уровню →</Link>
          ) : (
            <p className="rpt__next-pending">Следующий уровень откроется после обновления.</p>
          )}
        </div>
      ) : null}

      {/* Revision requested: offer a bounded correction action */}
      {state.status === "REVISION_REQUESTED" ? (
        <div className="rpt__revision">
          <button type="button" className="rpt__btn rpt__btn--primary ws-act" onClick={() => dispatch({ type: "begin_correction" })}>
            Создать исправленную версию
          </button>
        </div>
      ) : null}

      {/* Pending review: read-only echo of the submitted answers */}
      {state.status === "PENDING_REVIEW" && submission ? (
        <ReadOnlyReport model={model} values={submission.fieldValues} />
      ) : null}

      {/* Editable form (new draft or correction) */}
      {editing ? (
        <form className="rpt__form sub-body" onSubmit={onSubmit} noValidate>
          {state.status === "VALIDATION_ERROR" ? (
            <ValidationSummary
              errors={state.fieldErrors}
              labelForKey={(key) => model.byKey.get(key)?.label ?? key}
            />
          ) : null}

          {model.unknownTypes.length > 0 ? (
            <p className="rpt__notice" role="alert">
              Некоторые поля не поддерживаются интерфейсом. Отправка недоступна — обратитесь в поддержку.
            </p>
          ) : null}

          {model.groups.map((group) => (
            <fieldset className="rpt-group" key={group.id} data-group={group.id}>
              <legend className="rpt-group__legend rpt-group__head">{group.label}</legend>
              <div className="rpt-group__fields rpt-group__body">
                {group.fields.map((field) => (
                  <ReportField
                    key={field.stableKey}
                    field={field}
                    value={state.values[field.stableKey]}
                    error={fieldErrorByKey.get(field.stableKey) ?? null}
                    disabled={busy}
                    effectivelyRequired={isFieldEffectivelyRequired(field, state.values)}
                    onChange={onEdit}
                  />
                ))}
              </div>
            </fieldset>
          ))}

          <div className="rpt__actions rpt-bar">
            <button
              type="button"
              className="rpt__btn btn-2"
              onClick={onSave}
              disabled={busy || !state.dirty}
              aria-disabled={busy || !state.dirty}
            >
              {state.status === "DRAFT_SAVING" || state.status === "DRAFT_CREATING" || state.status === "NEW_REVISION_CREATING"
                ? "Сохранение…"
                : "Сохранить черновик"}
            </button>
            {/* Submit stays clickable so an invalid attempt surfaces a bounded
                validation error (spec §11/§19-B); the reducer blocks the network
                write. It is only hard-disabled while busy or on unknown types. */}
            <button
              type="submit"
              className="rpt__btn rpt__btn--primary ws-act"
              disabled={busy || model.unknownTypes.length > 0}
              aria-disabled={busy || model.unknownTypes.length > 0}
            >
              {state.correcting
                ? state.status === "RESUBMITTING" ? "Отправка…" : "Отправить исправление"
                : state.status === "SUBMITTING" ? "Отправка…" : context.assignment.submitLabel || "Отправить на проверку"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Pending review refresh: learner polls the server-authoritative state */}
      {state.status === "PENDING_REVIEW" ? (
        <div className="rpt__actions rpt-bar">
          <button type="button" className="rpt__btn btn-2" onClick={() => load()}>Обновить статус</button>
        </div>
      ) : null}
    </section>
  );
}

/** Read-only echo of the submitted values (immutable pending/approved view). */
function ReadOnlyReport({
  model,
  values,
}: {
  model: NonNullable<ReportState["model"]>;
  values: Record<string, unknown>;
}) {
  return (
    <div className="rpt-readonly" aria-label="Отправленный отчёт (только чтение)">
      {model.groups.map((group) => (
        <section className="rpt-readonly__group rpt-group" key={group.id} data-group={group.id}>
          <h3 className="rpt-readonly__legend rpt-group__head">{group.label}</h3>
          <dl className="rpt-group__body">
            {group.fields.map((field) => (
              <div className="rpt-readonly__row rpt-f" key={field.stableKey} data-field={field.stableKey}>
                <dt className="rpt-f__label">{field.label}</dt>
                <dd className="rpt-f__in rpt-f__ro">{formatValue(field.type, values[field.stableKey], field.choices)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function formatValue(type: string, value: unknown, choices: { code: string; label: string }[]): string {
  if (value === undefined || value === null || value === "") return "—";
  if (type === "boolean") return value === true ? "Да" : value === false ? "Нет" : "—";
  // Fall back to the stable code when the definition ships no choice label.
  if (type === "single_choice") {
    const label = choices.find((c) => c.code === value)?.label;
    return label && label.trim() ? label : String(value);
  }
  if (type === "multi_choice" && Array.isArray(value)) {
    return value.map((code) => {
      const label = choices.find((c) => c.code === code)?.label;
      return label && label.trim() ? label : String(code);
    }).join(", ") || "—";
  }
  return String(value);
}

export { restingEditingStatus };
