"use client";

/**
 * LEARNER-OPERATIONS-V1 — the unified operational inbox.
 *
 * ONE ENTRY POINT, SIX SURFACES. Support, report review, mentor review,
 * escalations, complaints and follow-ups are TYPES in one queue rather than six
 * screens an operator has to remember to check. The tab strip switches between
 * the queue and the department's other functions — quality, knowledge, VOC and
 * analytics — because they are the same department, not four mini-apps.
 *
 * AFFORDANCES ARE NOT GATES. The tabs an operator cannot use are not rendered,
 * and every route they can reach re-checks the identical permission server-side.
 * Hiding a tab is a convenience; the backend is the gate.
 *
 * THE QUEUE SHOWS LIVE WORK BY DEFAULT. A closed case is not "what needs
 * attention", and defaulting to everything buries the queue under its history.
 */
import * as React from "react";
import Link from "next/link";
import { grants } from "@/domain/identity/access";
import type { Permission } from "@/domain/identity/roles";
import { useSession } from "@/components/crm-shell/session-context";
import {
  fetchAnalytics,
  fetchConfig,
  fetchKnowledge,
  fetchQaReviews,
  fetchQueue,
  fetchVoc,
  type Outcome,
  type QueueFilters,
} from "@/application/api/learner-ops-client";
import type {
  LearnerOpsAnalytics,
  LearnerOpsConfig,
  KnowledgePage,
  QaPage,
  QueuePage,
  VocPage,
} from "@/data/contracts/api/learner-ops";
import {
  duration,
  label,
  outcomeNote,
  QA_RESULT_LABEL,
  since,
  SLA_ORIGIN_LABEL,
  TYPE_LABEL,
  VOC_SEVERITY_LABEL,
  VOC_STATUS_LABEL,
  KNOWLEDGE_STATUS_LABEL,
  ESCALATION_CLASS_LABEL,
} from "./labels";
import {
  EmptyBlock,
  ErrorBlock,
  ForbiddenBlock,
  LoadingBlock,
  PriorityChip,
  Section,
  SlaCell,
  StatusChip,
  TypeChip,
} from "./primitives";
import { CreateCaseForm } from "./create-case-form";

export const LEARNER_OPS_PATH = "/cases";
export const LEARNER_OPS_SUPPORT_PATH = "/support";

type Tab = "queue" | "qa" | "knowledge" | "voc" | "analytics";

const TAB_LABEL: Record<Tab, string> = {
  queue: "Очередь",
  qa: "Качество",
  knowledge: "База знаний",
  voc: "Сигналы (VOC)",
  analytics: "Аналитика",
};

/** Which permission each tab needs. The backend enforces the same. */
const TAB_PERMISSION: Record<Tab, Permission> = {
  queue: "learner_ops_view",
  qa: "learner_ops_qa",
  knowledge: "learner_ops_view",
  voc: "learner_ops_view",
  analytics: "learner_ops_analytics",
};

/** Render an outcome, or the right non-happy state for it. */
function useOutcome<T>(loader: () => Promise<Outcome<T>>, deps: React.DependencyList) {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "ready"; data: T } | { kind: "failed"; status: string; detail?: string }
  >({ kind: "loading" });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void loader().then((outcome) => {
      if (cancelled) return;
      if (outcome.status === "success") setState({ kind: "ready", data: outcome.data });
      else
        setState({
          kind: "failed",
          status: outcome.status,
          detail: "detail" in outcome ? outcome.detail : undefined,
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { state, reload: () => setNonce((n) => n + 1) };
}

/* ------------------------------------------------------------------ queue */

function QueueSurface({ fixedType }: { fixedType?: string }) {
  const { session } = useSession();
  const [filters, setFilters] = React.useState<QueueFilters>({
    assignment: "any",
    breached: "any",
    ...(fixedType ? { type: fixedType } : {}),
  });
  const [creating, setCreating] = React.useState(false);

  const config = useOutcome(() => fetchConfig(), []);
  const queue = useOutcome(() => fetchQueue(filters), [JSON.stringify(filters)]);

  const cfg = config.state.kind === "ready" ? (config.state.data as LearnerOpsConfig) : null;

  // The affordance is offered only to a principal that may actually create.
  // The backend enforces the same permission on POST — hiding the button is a
  // convenience, never the gate.
  const canCreate = grants(session.effectivePermissions, "learner_ops_handle");

  return (
    <div className="space-y-4">
      {canCreate ? (
        creating ? (
          <CreateCaseForm
            config={cfg}
            onCreated={() => {
              setCreating(false);
              queue.reload();
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            Создать кейс
          </button>
        )
      ) : null}

      <Section
        title="Фильтры"
        action={
          <button
            type="button"
            onClick={queue.reload}
            className="text-sm font-medium text-slate-600 underline"
          >
            Обновить
          </button>
        }
      >
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="mr-2 text-slate-600">Назначение</span>
            <select
              className="rounded border border-slate-300 px-2 py-1"
              value={filters.assignment ?? "any"}
              onChange={(e) =>
                setFilters((f) => ({ ...f, assignment: e.target.value as QueueFilters["assignment"] }))
              }
            >
              <option value="any">Любое</option>
              <option value="me">Мои</option>
              <option value="unassigned">Без исполнителя</option>
            </select>
          </label>

          {!fixedType ? (
            <label className="text-sm">
              <span className="mr-2 text-slate-600">Тип</span>
              <select
                className="rounded border border-slate-300 px-2 py-1"
                value={filters.type ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
              >
                <option value="">Все</option>
                {Object.entries(TYPE_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-sm">
            <span className="mr-2 text-slate-600">Очередь</span>
            <select
              className="rounded border border-slate-300 px-2 py-1"
              value={filters.queueKey ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, queueKey: e.target.value || undefined }))}
            >
              <option value="">Все</option>
              {(cfg?.queues ?? []).map((queueRow) => (
                <option key={queueRow.key} value={queueRow.key}>
                  {queueRow.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mr-2 text-slate-600">SLA</span>
            <select
              className="rounded border border-slate-300 px-2 py-1"
              value={filters.breached ?? "any"}
              onChange={(e) =>
                setFilters((f) => ({ ...f, breached: e.target.value as QueueFilters["breached"] }))
              }
            >
              <option value="any">Все</option>
              <option value="only">Только просроченные</option>
            </select>
          </label>
        </div>
      </Section>

      <Section title="Работа">
        {queue.state.kind === "loading" ? <LoadingBlock /> : null}
        {queue.state.kind === "failed" ? (
          queue.state.status === "forbidden" ? (
            <ForbiddenBlock what="Просмотр операционной очереди требует прав Learner Operations." />
          ) : (
            <ErrorBlock
              text={outcomeNote(queue.state.status, queue.state.detail)}
              onRetry={queue.reload}
            />
          )
        ) : null}
        {queue.state.kind === "ready" ? (
          (queue.state.data as QueuePage).items.length === 0 ? (
            <EmptyBlock text="Нет активной работы по выбранным фильтрам." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Обращение</th>
                    <th className="py-2 pr-3">Тип</th>
                    <th className="py-2 pr-3">Ученик</th>
                    <th className="py-2 pr-3">Статус</th>
                    <th className="py-2 pr-3">Приоритет</th>
                    <th className="py-2 pr-3">Исполнитель</th>
                    <th className="py-2 pr-3">Возраст</th>
                    <th className="py-2 pr-3">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {(queue.state.data as QueuePage).items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        <Link
                          href={`${LEARNER_OPS_PATH}/${item.id}`}
                          className="font-medium text-sky-700 underline"
                        >
                          {item.reference}
                        </Link>
                        <div className="text-xs text-slate-500">{item.subject}</div>
                        {item.reopenCount > 0 ? (
                          <div className="text-xs text-amber-700">
                            Переоткрыто: {item.reopenCount}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <TypeChip type={item.type} />
                      </td>
                      <td className="py-2 pr-3">{item.learner.name}</td>
                      <td className="py-2 pr-3">
                        <StatusChip status={item.status} />
                      </td>
                      <td className="py-2 pr-3">
                        <PriorityChip priority={item.priority} />
                      </td>
                      <td className="py-2 pr-3">
                        {item.assignedTo?.displayName ?? (
                          <span className="text-slate-400">— не назначено</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{since(item.openedAt)}</td>
                      <td className="py-2 pr-3">
                        <SlaCell sla={item.sla} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </Section>

      {cfg ? (
        <Section title="Политики SLA">
          <p className="mb-2 text-xs text-slate-500">
            Владелец продукта не предоставил бизнес-целей SLA. Все значения ниже — приёмочные
            фикстуры PREPROD, и это указано у каждой политики.
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Приоритет</th>
                <th className="py-1 pr-3">Первый ответ</th>
                <th className="py-1 pr-3">Решение</th>
                <th className="py-1 pr-3">Пауза</th>
                <th className="py-1 pr-3">Происхождение</th>
              </tr>
            </thead>
            <tbody>
              {cfg.slaPolicies.map((policy) => (
                <tr key={policy.key} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{policy.priority}</td>
                  <td className="py-1 pr-3">
                    {policy.firstResponseTargetMinutes === null
                      ? "не задана"
                      : duration(policy.firstResponseTargetMinutes * 60_000)}
                  </td>
                  <td className="py-1 pr-3">
                    {policy.resolutionTargetMinutes === null
                      ? "не задана"
                      : duration(policy.resolutionTargetMinutes * 60_000)}
                  </td>
                  <td className="py-1 pr-3 text-xs text-slate-600">
                    {[
                      policy.pausesOnWaitingLearner ? "ждём ученика" : null,
                      policy.pausesOnWaitingInternal ? "ждём решения" : null,
                      policy.pausesOnWaitingExternal ? "ждём провайдера" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "не ставится на паузу"}
                  </td>
                  <td className="py-1 pr-3 text-xs text-slate-500">
                    {label(SLA_ORIGIN_LABEL, policy.origin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------- QA */

function QaSurface() {
  const qa = useOutcome(() => fetchQaReviews(), []);
  return (
    <Section title="Оценка качества">
      {qa.state.kind === "loading" ? <LoadingBlock /> : null}
      {qa.state.kind === "failed" ? (
        qa.state.status === "forbidden" ? (
          <ForbiddenBlock what="Оценка качества доступна ролям с правом learner_ops_qa." />
        ) : (
          <ErrorBlock text={outcomeNote(qa.state.status, qa.state.detail)} onRetry={qa.reload} />
        )
      ) : null}
      {qa.state.kind === "ready" ? (
        (qa.state.data as QaPage).items.length === 0 ? (
          <EmptyBlock text="Проверок качества пока нет. Оценивать можно только завершённые обращения." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Обращение</th>
                <th className="py-2 pr-3">Результат</th>
                <th className="py-2 pr-3">Коучинг</th>
                <th className="py-2 pr-3">Проверил</th>
                <th className="py-2 pr-3">Когда</th>
              </tr>
            </thead>
            <tbody>
              {(qa.state.data as QaPage).items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3">
                    <Link href={`${LEARNER_OPS_PATH}/${row.caseId}`} className="text-sky-700 underline">
                      {row.caseReference}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{label(QA_RESULT_LABEL, row.result)}</td>
                  <td className="py-2 pr-3">{row.coachingRequired ? "нужен" : "—"}</td>
                  <td className="py-2 pr-3">{row.reviewer}</td>
                  <td className="py-2 pr-3">{since(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------- knowledge */

function KnowledgeSurface() {
  const [search, setSearch] = React.useState("");
  const kb = useOutcome(() => fetchKnowledge(search ? { search } : {}), [search]);
  return (
    <Section title="База знаний">
      <p className="mb-3 text-xs text-slate-500">
        Внутренний справочник для операторов. Статьи не являются учебной авторитетностью и не
        влияют на прогресс ученика.
      </p>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Поиск по заголовку"
        className="mb-3 w-full max-w-sm rounded border border-slate-300 px-2 py-1 text-sm"
      />
      {kb.state.kind === "loading" ? <LoadingBlock /> : null}
      {kb.state.kind === "failed" ? (
        <ErrorBlock text={outcomeNote(kb.state.status, kb.state.detail)} onRetry={kb.reload} />
      ) : null}
      {kb.state.kind === "ready" ? (
        (kb.state.data as KnowledgePage).items.length === 0 ? (
          <EmptyBlock text="Статей нет. Создание доступно роли с правом learner_ops_admin." />
        ) : (
          <ul className="space-y-2">
            {(kb.state.data as KnowledgePage).items.map((row) => (
              <li key={row.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{row.title}</span>
                  <span className="text-xs text-slate-500">
                    {label(KNOWLEDGE_STATUS_LABEL, row.status)} · v{row.version}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.slug} · владелец {row.owner} · обновлено {since(row.updatedAt)} назад
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------------- VOC */

function VocSurface() {
  const voc = useOutcome(() => fetchVoc(), []);
  return (
    <Section title="Сигналы VOC">
      <p className="mb-3 text-xs text-slate-500">
        Повторяющиеся трудности учеников, превращённые в структурированные свидетельства.
        Количество подтверждений считается по связанным обращениям и нигде не хранится отдельно.
      </p>
      {voc.state.kind === "loading" ? <LoadingBlock /> : null}
      {voc.state.kind === "failed" ? (
        <ErrorBlock text={outcomeNote(voc.state.status, voc.state.detail)} onRetry={voc.reload} />
      ) : null}
      {voc.state.kind === "ready" ? (
        (voc.state.data as VocPage).items.length === 0 ? (
          <EmptyBlock text="Сигналов пока нет." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Тема</th>
                <th className="py-2 pr-3">Категория</th>
                <th className="py-2 pr-3">Важность</th>
                <th className="py-2 pr-3">Статус</th>
                <th className="py-2 pr-3">Подтверждений</th>
                <th className="py-2 pr-3">Владелец</th>
              </tr>
            </thead>
            <tbody>
              {(voc.state.data as VocPage).items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3">{row.theme}</td>
                  <td className="py-2 pr-3">{row.category}</td>
                  <td className="py-2 pr-3">{label(VOC_SEVERITY_LABEL, row.severity)}</td>
                  <td className="py-2 pr-3">{label(VOC_STATUS_LABEL, row.status)}</td>
                  <td className="py-2 pr-3">{row.evidenceCount}</td>
                  <td className="py-2 pr-3">{row.owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------- analytics */

function Metric({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function AnalyticsSurface() {
  const analytics = useOutcome(() => fetchAnalytics(), []);

  if (analytics.state.kind === "loading") return <LoadingBlock />;
  if (analytics.state.kind === "failed") {
    return analytics.state.status === "forbidden" ? (
      <ForbiddenBlock what="Операционная аналитика доступна ролям с правом learner_ops_analytics." />
    ) : (
      <ErrorBlock
        text={outcomeNote(analytics.state.status, analytics.state.detail)}
        onRetry={analytics.reload}
      />
    );
  }

  const data = analytics.state.data as LearnerOpsAnalytics;
  return (
    <div className="space-y-4">
      {data.truncated ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Показаны самые старые активные обращения в пределах лимита выборки. Производные
          показатели описывают эту выборку, а не весь объём.
        </p>
      ) : null}

      <Section title="Бэклог">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric title="Всего" value={String(data.backlog.total)} />
          <Metric title="Активных" value={String(data.backlog.open)} />
          <Metric title="Без исполнителя" value={String(data.backlog.unassigned)} />
          <Metric title="Ждут первого ответа" value={String(data.backlog.awaitingFirstResponse)} />
          <Metric title="Средний возраст" value={duration(data.backlog.averageAgeMs)} />
          <Metric title="Самое старое" value={duration(data.backlog.oldestAgeMs)} />
        </div>
      </Section>

      <Section title="SLA">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric title="Просрочен первый ответ" value={String(data.sla.firstResponseBreached)} />
          <Metric title="Просрочено решение" value={String(data.sla.resolutionBreached)} />
          <Metric
            title="Медиана решения"
            value={duration(data.sla.medianResolutionMs)}
            hint={`выборка: ${data.sla.resolvedSampleSize}`}
          />
        </div>
      </Section>

      <Section title="Разрезы">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">По типу</h3>
            <ul className="text-sm">
              {data.byType.map((row) => (
                <li key={row.type} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{label(TYPE_LABEL, row.type)}</span>
                  <span className="font-medium">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">
              Частые причины
            </h3>
            <ul className="text-sm">
              {data.taxonomy.slice(0, 8).map((row) => (
                <li key={row.code} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{row.label}</span>
                  <span className="font-medium">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Эскалации</h3>
            {data.escalations.length === 0 ? (
              <EmptyBlock text="Эскалаций нет." />
            ) : (
              <ul className="text-sm">
                {data.escalations.map((row) => (
                  <li key={row.class} className="flex justify-between border-b border-slate-100 py-1">
                    <span>{label(ESCALATION_CLASS_LABEL, row.class)}</span>
                    <span className="font-medium">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">
              Покрытие качеством
            </h3>
            <p className="text-sm">
              {data.qa.reviewedCases} из {data.qa.completedCases} завершённых обращений
            </p>
          </div>
        </div>
      </Section>

      <Section title="Наблюдения">
        <p className="mb-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
          {data.observational.note}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric title="Переоткрытых" value={String(data.observational.reopenedCases)} />
          <Metric
            title="Доля переоткрытий"
            value={`${(data.observational.reopenRate * 100).toFixed(1)}%`}
          />
          <Metric title="Жалоб" value={String(data.observational.complaints)} />
          <Metric
            title="Восстановление сервиса"
            value={String(data.observational.serviceRecovery)}
          />
        </div>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- shell */

export function LearnerOpsWorkspace({ surface }: { surface?: "all" | "support" }) {
  const { session } = useSession();
  const [tab, setTab] = React.useState<Tab>("queue");

  const visibleTabs = (Object.keys(TAB_LABEL) as Tab[]).filter((key) =>
    grants(session.effectivePermissions, TAB_PERMISSION[key]),
  );

  // A session with none of the department's permissions sees the honest
  // explanation rather than an empty page that looks broken.
  if (visibleTabs.length === 0) {
    return (
      <div className="p-6">
        <ForbiddenBlock what="Раздел «Операции с учениками» требует прав Learner Operations. Обратитесь к администратору CRM." />
      </div>
    );
  }

  const active = visibleTabs.includes(tab) ? tab : visibleTabs[0]!;

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">
          {surface === "support" ? "Поддержка" : "Операции с учениками"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {surface === "support"
            ? "Обращения учеников — срез единой операционной очереди."
            : "Единая очередь департамента: обращения, проверки, эскалации, жалобы и сопровождение."}
        </p>
      </header>

      {surface === "support" ? null : (
        <nav className="flex flex-wrap gap-2 border-b border-slate-200">
          {visibleTabs.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active === key
                  ? "border-sky-600 font-medium text-sky-700"
                  : "border-transparent text-slate-600"
              }`}
            >
              {TAB_LABEL[key]}
            </button>
          ))}
        </nav>
      )}

      {surface === "support" ? (
        <QueueSurface fixedType="support_request" />
      ) : active === "queue" ? (
        <QueueSurface />
      ) : active === "qa" ? (
        <QaSurface />
      ) : active === "knowledge" ? (
        <KnowledgeSurface />
      ) : active === "voc" ? (
        <VocSurface />
      ) : (
        <AnalyticsSurface />
      )}
    </div>
  );
}
