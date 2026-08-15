"use client";

/**
 * LO-UI-CASE-CREATE-1 — creating an operational case from the product.
 *
 * THE GAP THIS CLOSES. `POST /learner-ops/cases` shipped and worked, and the CRM
 * offered no way to reach it. Four of the seven case types are staff-originated
 * — a complaint, a service recovery, an educational escalation, an operational
 * follow-up all begin with an operator, not a learner — so §6's unified queue
 * could not actually be populated through the product. The acceptance cases had
 * to be created with fetch, which is precisely the evidence that the feature was
 * missing rather than merely awkward.
 *
 * IT CALLS THE CANONICAL OWNER AND NOTHING ELSE. One endpoint, the one that
 * already existed. No second creation route, no client-side draft case, no
 * complaints mini-app, no separate escalation tracker.
 *
 * WHICH TYPES IT OFFERS, AND WHY NOT ALL SEVEN. `report_review` and
 * `mentor_review` REQUIRE a canonical anchor — a `ReportSubmission` or a
 * `UserLevelProgress` row — enforced by the domain and by a CHECK constraint in
 * migration 51. They originate from the educational object, so a blank staff
 * form is the wrong door and offering them would present a control that can
 * only fail. The five that carry no anchor are offered.
 *
 * THE LEARNER PICKER IS A SEARCH, NOT A DUMP. It calls the existing Users v1
 * read with a search term and a small limit. There is no "load every learner"
 * path: the backend caps the page, masks the email according to the caller's own
 * permissions, and remains the authority regardless of what this component
 * renders.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { fetchUsers } from "@/application/api/users-client";
import { createCase, type Outcome } from "@/application/api/learner-ops-client";
import type { LearnerOpsConfig } from "@/data/contracts/api/learner-ops";
import { outcomeNote, PRIORITY_LABEL, TYPE_LABEL } from "./labels";
import { ErrorBlock } from "./primitives";

/**
 * The staff-originatable types, derived from the domain's anchor rule rather
 * than from a hand-kept list: a type that requires a canonical anchor cannot be
 * created from a blank form.
 */
export const STAFF_ORIGINATABLE_TYPES = [
  "support_request",
  "educational_escalation",
  "complaint",
  "service_recovery",
  "operational_followup",
] as const;

/** Types the domain refuses without an anchor. Never offered here. */
export const ANCHOR_REQUIRED_TYPES = ["report_review", "mentor_review"] as const;

/**
 * What the picker shows. `email.visibility` is carried through rather than
 * flattened: the Users v1 read masks the address unless the caller holds
 * `view_identity_full_email`, and the operator should see that the value they
 * are looking at is masked rather than assume it is the whole address.
 */
type LearnerHit = {
  id: string;
  name: string;
  email: string;
  emailMasked: boolean;
};

export function CreateCaseForm({
  config,
  onCreated,
  onCancel,
}: {
  config: LearnerOpsConfig | null;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();

  const [search, setSearch] = React.useState("");
  const [hits, setHits] = React.useState<LearnerHit[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [learner, setLearner] = React.useState<LearnerHit | null>(null);

  const [type, setType] = React.useState<string>("complaint");
  const [queueKey, setQueueKey] = React.useState<string>("support");
  const [priority, setPriority] = React.useState<string>("normal");
  const [reasonCode, setReasonCode] = React.useState<string>("");
  const [subject, setSubject] = React.useState("");
  const [details, setDetails] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Debounced search. The request is superseded rather than raced: a stale
   * response is discarded by the token check, so a slow early query can never
   * overwrite the results of a later one.
   */
  const token = React.useRef(0);
  React.useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setHits(null);
      setSearchError(null);
      return;
    }
    const mine = ++token.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void fetchUsers({ search: term, limit: 10 }).then((outcome) => {
        if (mine !== token.current) return;
        setSearching(false);
        if (outcome.status === "success") {
          setHits(
            outcome.page.items.map((row) => ({
              id: String(row.userId),
              name: row.displayName,
              email: row.email.value,
              emailMasked: row.email.visibility === "masked",
            })),
          );
          setSearchError(null);
        } else {
          setHits([]);
          setSearchError(outcomeNote(outcome.status));
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const canSubmit =
    learner !== null && subject.trim().length > 0 && details.trim().length > 0 && !busy;

  return (
    <form
      className="rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        // Double-submit protection: the guard is the `busy` flag AND the
        // disabled button, so a double click or an Enter-key repeat cannot
        // produce two cases.
        if (!canSubmit || learner === null) return;
        setBusy(true);
        setError(null);

        const outcome: Outcome<unknown> = await createCase({
          userId: Number(learner.id),
          type,
          queueKey,
          subject: subject.trim(),
          details: details.trim(),
          priority,
          ...(reasonCode ? { reasonCode } : {}),
        });
        setBusy(false);

        if (outcome.status === "success") {
          const created = outcome.data as { id?: string } | null;
          onCreated();
          // Open the canonical case-detail workspace, the same route the queue
          // links to. Nothing is rendered from the create response beyond the id.
          if (created?.id) router.push(`/cases/${created.id}`);
          return;
        }
        setError(outcomeNote(outcome.status, "detail" in outcome ? outcome.detail : undefined));
      }}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Новый кейс</h2>
        <button type="button" onClick={onCancel} className="text-sm text-slate-600 underline">
          Отмена
        </button>
      </header>

      {error ? <ErrorBlock text={error} /> : null}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {/* ----------------------------------------------------- learner */}
        <div className="md:col-span-2">
          <label htmlFor="lo-learner-search" className="block text-sm text-slate-600">
            Ученик
          </label>
          {learner ? (
            <div className="mt-1 flex items-center justify-between rounded border border-slate-300 px-2 py-1 text-sm">
              <span>
                {learner.name}{" "}
                <span className="text-slate-500">
                  · {learner.email}
                  {learner.emailMasked ? " (скрыт)" : ""}
                </span>
              </span>
              <button
                type="button"
                className="text-xs text-slate-600 underline"
                onClick={() => {
                  setLearner(null);
                  setSearch("");
                }}
              >
                Изменить
              </button>
            </div>
          ) : (
            <>
              <input
                id="lo-learner-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по имени (минимум 2 символа)"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
              {searching ? (
                <p className="mt-1 text-xs text-slate-500" role="status">
                  Поиск…
                </p>
              ) : null}
              {searchError ? <p className="mt-1 text-xs text-red-700">{searchError}</p> : null}
              {hits !== null && !searching ? (
                hits.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">Ничего не найдено.</p>
                ) : (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200">
                    {hits.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => setLearner(hit)}
                          className="w-full px-2 py-1 text-left text-sm hover:bg-slate-50"
                        >
                          {hit.name}{" "}
                          <span className="text-slate-500">
                            · {hit.email}
                            {hit.emailMasked ? " (скрыт)" : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}
        </div>

        {/* -------------------------------------------------------- type */}
        <label className="text-sm">
          <span className="text-slate-600">Тип</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          >
            {STAFF_ORIGINATABLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate-600">Очередь</span>
          <select
            value={queueKey}
            onChange={(e) => setQueueKey(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          >
            {(config?.queues ?? []).map((queue) => (
              <option key={queue.key} value={queue.key}>
                {queue.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate-600">Приоритет</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          >
            {Object.entries(PRIORITY_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-slate-600">Причина</span>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="">— не указана —</option>
            {(config?.reasonCodes ?? []).map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm md:col-span-2">
          <span className="text-slate-600">Тема</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            placeholder="Коротко: суть кейса"
          />
        </label>

        <label className="text-sm md:col-span-2">
          <span className="text-slate-600">Описание</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            maxLength={8000}
            className="mt-1 w-full rounded border border-slate-300 p-2"
            placeholder="Контекст: что произошло, что уже сделано"
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Проверка отчёта и проверка практики создаются от канонического учебного объекта, а
        не здесь: им обязательно нужен отчёт или строка прогресса.
      </p>

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-3 rounded bg-sky-700 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Создание…" : "Создать кейс"}
      </button>
    </form>
  );
}
