"use client";

/**
 * AFFILIATE-PLATFORM-V1 §19/§27 — outbound delivery and attempt visibility.
 *
 * READ ONLY, AND THERE IS NO RE-SEND BUTTON. §25 makes the conversion ledger
 * the only thing that drives delivery; a manual re-send control would make a
 * partner's conversion count depend on how often somebody clicked.
 *
 * ONE ROW PER LOGICAL DELIVERY, WITH ITS ATTEMPTS NESTED. That shape is the
 * whole point of the ledger: "we told them once and they answered 500 six
 * times" and "we told them six times" are different facts, and a flat list of
 * attempts would collapse them.
 *
 * THE RESPONSE SNIPPET IS THE ONLY REMOTE-CONTROLLED VALUE ON THIS SCREEN. It
 * is rendered as TEXT — React escapes it, and there is no
 * `dangerouslySetInnerHTML` anywhere in this feature — so a partner's server
 * cannot inject markup into a staff console by answering with it.
 */
import * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPostbackDeliveries } from "@/application/api/affiliate-commercial-client";
import type { AffiliatePostbackDeliveryList } from "@/data/contracts/api/affiliate-commercial";
import { AffiliateSectionTabs } from "@/features/affiliates/affiliate-section-tabs";
import { useAffiliateAccess } from "@/features/affiliates/use-affiliate-access";
import {
  ATTEMPT_OUTCOME_LABEL,
  CONVERSION_TYPE_LABEL,
  DELIVERY_STATUS_LABEL,
  formatInstant,
  labelFor,
} from "./commercial-labels";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AffiliatePostbackDeliveryList }
  | { kind: "error"; message: string }
  | { kind: "forbidden" };

const STATUS_FILTERS = [
  { value: "", label: "Все" },
  { value: "pending", label: "Ожидают" },
  { value: "delivered", label: "Доставлены" },
  { value: "failed_retryable", label: "Ошибка · повтор" },
  { value: "failed_terminal", label: "Ошибка · терминальная" },
] as const;

export function PostbackDeliveriesWorkspace() {
  const access = useAffiliateAccess();
  const [status, setStatus] = React.useState<string>("");
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });

  React.useEffect(() => {
    if (!access.canRead) return;
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      const outcome = await fetchPostbackDeliveries({ status, limit: 50 });
      if (cancelled) return;
      if (outcome.status === "success") setState({ kind: "ready", data: outcome.data });
      else if (outcome.status === "forbidden" || outcome.status === "unauthenticated") {
        setState({ kind: "forbidden" });
      } else setState({ kind: "error", message: "Не удалось загрузить журнал доставок." });
    })();
    return () => {
      cancelled = true;
    };
  }, [access.canRead, status]);

  if (!access.canRead || state.kind === "forbidden") {
    return <EmptyState title="Нет доступа" description="Требуется право на чтение аффилейт-данных." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Постбэки партнёрам"
        description="Одна логическая доставка на конверсию и версию назначения. Повторы добавляют попытки, а не доставки."
      />
      <AffiliateSectionTabs active="postbacks" />

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setStatus(filter.value)}
            className={
              status === filter.value
                ? "rounded-full border border-primary px-3 py-1 text-xs font-medium"
                : "rounded-full border px-3 py-1 text-xs text-muted-foreground"
            }
          >
            {filter.label}
          </button>
        ))}
      </div>

      {state.kind === "loading" ? <Skeleton className="h-40 w-full" /> : null}
      {state.kind === "error" ? <EmptyState title="Ошибка" description={state.message} /> : null}

      {state.kind === "ready" ? (
        state.data.items.length === 0 ? (
          <EmptyState
            title="Доставок нет"
            description="Доставка создаётся из канонической конверсии, если партнёр настроил назначение для её типа."
          />
        ) : (
          <div className="space-y-3">
            {state.data.items.map((delivery) => (
              <details key={delivery.deliveryId} className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm">
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {labelFor(CONVERSION_TYPE_LABEL, delivery.eventType)}
                  </span>{" "}
                  <span className="font-medium">
                    {labelFor(DELIVERY_STATUS_LABEL, delivery.status)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {delivery.partner.code} · попыток {delivery.attemptCount}/{delivery.maxAttempts}
                    {delivery.lastHttpStatus !== null ? ` · HTTP ${delivery.lastHttpStatus}` : ""}
                    {delivery.nextAttemptAt !== null
                      ? ` · следующая ${formatInstant(delivery.nextAttemptAt)}`
                      : ""}
                  </span>
                </summary>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted-foreground">Конверсия</dt>
                  <dd className="font-mono">{delivery.conversionId}</dd>
                  <dt className="text-muted-foreground">Версия назначения</dt>
                  <dd>v{delivery.endpointVersion}</dd>
                  <dt className="text-muted-foreground">Создана</dt>
                  <dd className="font-mono">{formatInstant(delivery.createdAt)}</dd>
                  <dt className="text-muted-foreground">Доставлена</dt>
                  <dd className="font-mono">{formatInstant(delivery.deliveredAt)}</dd>
                </dl>

                {delivery.attempts.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">Попыток ещё не было.</p>
                ) : (
                  <table className="mt-3 w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">Начата</th>
                        <th className="p-2 text-left">Результат</th>
                        <th className="p-2 text-right">HTTP</th>
                        <th className="p-2 text-right">мс</th>
                        <th className="p-2 text-left">Ответ получателя</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delivery.attempts.map((attempt) => (
                        <tr key={attempt.attemptNumber} className="border-t">
                          <td className="p-2">{attempt.attemptNumber}</td>
                          <td className="p-2 font-mono">{formatInstant(attempt.startedAt)}</td>
                          <td className="p-2">{labelFor(ATTEMPT_OUTCOME_LABEL, attempt.outcome)}</td>
                          <td className="p-2 text-right tabular-nums">{attempt.httpStatus ?? "—"}</td>
                          <td className="p-2 text-right tabular-nums">{attempt.durationMs}</td>
                          {/* Remote-controlled text. Rendered as text, never as markup. */}
                          <td className="p-2 font-mono text-muted-foreground">
                            {attempt.responseSnippet ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
