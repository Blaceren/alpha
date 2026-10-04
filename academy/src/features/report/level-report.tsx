"use client";

/**
 * The learner report workflow (Client Component).
 *
 * The form is driven ENTIRELY by the Backend report definition. Draft/save/
 * submit/resubmit are server-authoritative via the same-origin proxy; this
 * component never computes completion, never writes a level's completion and
 * never awards XP. On a server-confirmed acceptance it re-reads the
 * authoritative curriculum via `router.refresh()` so "this level is completed,
 * the next is available" comes from the Backend, not the client. Attachments
 * are never surfaced.
 *
 * TWO WAYS A REPORT IS ACCEPTED (2026-10-02), one form.
 *
 *   review  a mentor reads it. It is sent «на проверку», waits, and may come
 *           back with corrections.
 *   formal  «Ручной проверки нет. Система проверяет формально.» The platform
 *           accepts it at submission when every required field is filled.
 *           Nothing is sent to anyone and nothing waits, so no sentence here
 *           may say «наставник» or «ожидает проверки» — and none does: every
 *           line that names who decides asks `formal` first.
 *
 * RECORDS, NOT A WALL OF FIELDS. A report is a list of records — trades, and in
 * the 30-level program refusals — and each is a group with its own heading and
 * a count of what is filled. An OPTIONAL record is one button («добавить запись
 * отказа») until the learner wants it; removing it clears what was typed, so a
 * record that is not part of the report leaves nothing behind in it.
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
import {
  isGroupActive,
  qualifiedFieldLabel,
  type ReportFieldGroup,
} from "@/features/report/report-definition";
import { isFieldEffectivelyRequired } from "@/features/report/required-when";
import { isBlank, validateReport } from "@/features/report/report-validation";
import { reportAcceptanceOf, type ReportAcceptance } from "@/lib/report/types";
import { ReportField } from "@/features/report/components/report-field";
import { ReportStatusPanel } from "@/features/report/components/report-status-panel";
import { ValidationSummary } from "@/features/report/components/validation-summary";
import "@/features/report/report.css";

export type LevelReportProps = {
  stableCode: string;
  locale: string;
  /** From server navigation: next level code once route-accessible, else null. */
  nextLevelCode: string | null;
  /**
   * Who accepts this report, from the level's own completion method. Known to
   * the page before the form has loaded, so even the loading line is true. When
   * absent, the loaded report says it itself.
   */
  acceptance?: ReportAcceptance;
  /**
   * Whether the accepted report offers the way onward itself.
   *
   * `here` (default): it does — the surface it sits on has nothing else that
   * says what is next. `elsewhere`: the page around it already states that the
   * level is completed and where to go, so the report keeps to what is its own:
   * the verdict, the history and what the learner wrote.
   */
  nextStep?: "here" | "elsewhere";
};

const EDITING_STATUSES = new Set(["NO_REPORT", "DRAFT_READY", "DRAFT_DIRTY", "DRAFT_SAVED", "VALIDATION_ERROR"]);

function statusMessage(state: ReportState, formal: boolean): string {
  switch (state.status) {
    case "DEFINITION_LOADING": return "Загрузка формы отчёта…";
    case "DRAFT_CREATING": return "Создаём черновик…";
    case "NEW_REVISION_CREATING": return "Готовим новую версию…";
    case "DRAFT_SAVING": return "Сохраняем черновик…";
    case "DRAFT_SAVED": return "Черновик сохранён на сервере.";
    case "DRAFT_DIRTY": return "Есть несохранённые изменения.";
    case "SUBMITTING": return formal ? "Проверяем отчёт…" : "Отправляем отчёт на проверку…";
    case "RESUBMITTING": return "Отправляем исправленную версию…";
    case "PENDING_REVIEW": return "Отчёт отправлен и ожидает проверки наставника.";
    case "REVISION_REQUESTED": return "Наставник запросил доработку отчёта.";
    case "APPROVED":
    case "LEVEL_COMPLETED": return "Отчёт принят. Уровень завершён.";
    case "STALE_REVISION": return "Отчёт был изменён в другом месте. Обновите форму.";
    case "VALIDATION_ERROR":
      /* The server's refusal is not about empty fields — the form checks those
         first. What it refuses is text it will not store: tags such as «<b>»
         (2026-10-04: it used to blame the fields, which were full). */
      return state.serverRefusal ? "Отчёт не принят: в тексте есть то, что нельзя сохранить." : "Проверьте отмеченные поля.";
    case "FLAG_DISABLED": return "Отправка отчёта сейчас недоступна.";
    case "NETWORK_ERROR": return "Не удалось связаться с сервером. Попробуйте ещё раз.";
    case "FATAL_ERROR": return "Не удалось загрузить отчёт.";
    default: return "";
  }
}

/** How much of a record is filled: the fields a learner sees, and those with a value. */
function groupFill(group: ReportFieldGroup, values: Record<string, unknown>): { filled: number; total: number } {
  const filled = group.fields.filter((field) => !isBlank(values[field.stableKey])).length;
  return { filled, total: group.fields.length };
}

/** What an optional record is called on its «добавить» and «убрать» controls. */
const RECORD_ACTION_NOUN: Record<ReportFieldGroup["kind"], string> = {
  trade: "запись сделки",
  refusal: "запись отказа",
  summary: "раздел",
};

export function LevelReport({ stableCode, locale, nextLevelCode, acceptance, nextStep = "here" }: LevelReportProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  /** The status the form was in before the current one. */
  const previousStatus = useRef<ReportState["status"] | null>(null);

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

  // Announce the OUTCOME OF A SUBMISSION by moving focus to the live status.
  //
  // Only that. This used to fire whenever the status was terminal, which
  // includes the moment a page OPENS on a report that was accepted last week:
  // focus was pulled into the middle of the page before the learner had done
  // anything, and a focus ring appeared around a sentence. Focus follows an
  // action the learner just took, never a page load.
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = state.status;
    const submitted = before === "SUBMITTING" || before === "RESUBMITTING";
    if (
      submitted &&
      (state.status === "APPROVED" || state.status === "PENDING_REVIEW" || state.status === "REVISION_REQUESTED")
    ) {
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

  /** Bring an optional record into the report, and put the cursor in it. */
  const onAddRecord = useCallback((group: ReportFieldGroup) => {
    if (!group.switchField) return;
    dispatch({ type: "edit", stableKey: group.switchField.stableKey, value: true });
    const first = group.fields[0];
    if (first) {
      // After the fields have rendered; a focus call before that finds nothing.
      requestAnimationFrame(() => {
        const control =
          document.getElementById(`rf-${first.stableKey}`) ??
          document.querySelector<HTMLElement>(`[data-field="${CSS.escape(first.stableKey)}"] input`);
        control?.focus();
      });
    }
  }, []);

  /**
   * Take an optional record out again. What was typed in it goes with it: a
   * record that is not part of the report must not travel in the report.
   */
  const onRemoveRecord = useCallback((group: ReportFieldGroup) => {
    if (!group.switchField) return;
    for (const field of group.fields) dispatch({ type: "edit", stableKey: field.stableKey, value: undefined });
    dispatch({ type: "edit", stableKey: group.switchField.stableKey, value: false });
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

  /* The page knows who accepts the report before the form has loaded; once it
     has, the report says it itself. Either way it is the Backend's answer. */
  const formal = (acceptance ?? reportAcceptanceOf(state.context)) === "formal";

  if (state.status === "DEFINITION_LOADING") {
    return (
      <section className="rpt sub-wrap" aria-labelledby="rpt-heading" data-status={state.status}>
        <h2 id="rpt-heading" className="rpt__heading">Отчёт по уровню</h2>
        <p className="rpt__status rpt-bar__state" role="status" aria-live="polite">{statusMessage(state, formal)}</p>
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
          <p>{statusMessage(state, formal)}</p>
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
    <section
      className="rpt sub-wrap"
      aria-labelledby="rpt-heading"
      data-status={state.status}
      data-acceptance={formal ? "formal" : "review"}
    >
      <header className="rpt__head sub-head">
        <h2 id="rpt-heading" className="rpt__heading sub-head__title" tabIndex={-1}>{context.assignment.title}</h2>
        <p className="rpt__instructions">{context.assignment.instructions}</p>
        {context.assignment.successCriteriaSummary ? (
          <p className="rpt__criteria"><span className="rpt__criteria-label">Критерии:</span> {context.assignment.successCriteriaSummary}</p>
        ) : null}
      </header>

      <p className="rpt__status rpt-bar__state" role="status" aria-live="polite" tabIndex={-1} ref={statusRef} data-status={state.status}>
        {statusMessage(state, formal)}
      </p>

      {state.status === "STALE_REVISION" ? (
        <div className="rpt__notice" role="alert">
          <p>{statusMessage(state, formal)}</p>
          <button type="button" className="rpt__btn btn-2" onClick={() => load()}>Обновить форму</button>
        </div>
      ) : null}

      <ReportStatusPanel submission={submission} />

      {/* Approved / completed */}
      {(state.status === "APPROVED" || state.status === "LEVEL_COMPLETED") && nextStep === "here" ? (
        <div className="rpt__done" role="status">
          <p className="rpt__done-title">✓ Отчёт принят — уровень завершён</p>
          {nextLevelCode ? (
            <Link className="rpt__next" href={`/lessons/${encodeURIComponent(nextLevelCode)}`}>Перейти к следующему уровню →</Link>
          ) : (
            <p className="rpt__next-pending">Следующий уровень откроется после обновления.</p>
          )}
        </div>
      ) : null}

      {/* The accepted report stays readable. A later lesson sends the learner
          back to these very records («сверка оснований с девятым уроком»), so
          they must not vanish the moment they are accepted. Closed by default:
          the result is what the page is about now. */}
      {(state.status === "APPROVED" || state.status === "LEVEL_COMPLETED") && submission ? (
        <details className="rpt-own">
          <summary className="rpt-own__summary">Ваш отчёт</summary>
          <ReadOnlyReport model={model} values={submission.fieldValues} />
        </details>
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
              serverMessage={
                state.serverRefusal
                  ? "Отчёт не принят: в одной из записей есть то, что нельзя сохранить, — обычно это HTML-теги вроде «<b>» или ссылка «javascript:». Уберите их и отправьте ещё раз."
                  : null
              }
              labelForKey={(key) => qualifiedFieldLabel(model, key)}
            />
          ) : null}

          {model.unknownTypes.length > 0 ? (
            <p className="rpt__notice" role="alert">
              Некоторые поля не поддерживаются интерфейсом. Отправка недоступна — обратитесь в поддержку.
            </p>
          ) : null}

          {model.groups.map((group, index) => {
            const active = isGroupActive(group, state.values);
            /* ONE «ДОБАВИТЬ» AT A TIME. Of the optional records that are off,
               only the first of its kind is offered; the next appears once that
               one is added. Two identical buttons for «отказ 2» and «отказ 3»
               asked the learner to choose between two things that are the same.
               A record that is ON is always shown, whatever came before it, so a
               draft saved in any order still opens whole. */
            const earlierOff = model.groups
              .slice(0, index)
              .some((other) => other.kind === group.kind && other.switchField !== null && !isGroupActive(other, state.values));
            if (!active && earlierOff) return null;
            if (!active) {
              /* An optional record the learner has not asked for: one control,
                 no empty inputs. It is not a fieldset — there are no fields. */
              return (
                <div className="rpt-group rpt-group--off" key={group.id} data-group={group.id} data-active="false">
                  <p className="rpt-group__offlabel">{group.label}</p>
                  <button
                    type="button"
                    className="rpt__btn btn-2 rpt-group__toggle"
                    onClick={() => onAddRecord(group)}
                    disabled={busy}
                  >
                    Добавить {RECORD_ACTION_NOUN[group.kind]}
                  </button>
                </div>
              );
            }
            const fill = groupFill(group, state.values);
            return (
              <fieldset className="rpt-group" key={group.id} data-group={group.id} data-kind={group.kind} data-active="true">
                <legend className="rpt-group__legend rpt-group__head">
                  {group.label}
                  <span className="rpt-group__fill" data-complete={String(fill.filled === fill.total)}>
                    заполнено {fill.filled} из {fill.total}
                  </span>
                </legend>
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
                {group.switchField ? (
                  <button
                    type="button"
                    className="rpt__btn btn-2 rpt-group__toggle rpt-group__toggle--remove"
                    onClick={() => onRemoveRecord(group)}
                    disabled={busy}
                  >
                    Убрать {RECORD_ACTION_NOUN[group.kind]}
                  </button>
                ) : null}
              </fieldset>
            );
          })}

          {formal ? (
            <p className="rpt__formal" data-acceptance="formal">
              Проверка автоматическая: отчёт принимается сразу, когда заполнены все обязательные
              поля. Черновик можно сохранить и вернуться к нему позже.
            </p>
          ) : null}

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
      {model.groups.filter((group) => isGroupActive(group, values)).map((group) => (
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
