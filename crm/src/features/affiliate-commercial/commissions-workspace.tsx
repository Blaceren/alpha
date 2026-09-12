"use client";

/**
 * AFFILIATE-PLATFORM-V1 §19/§9 — CPA qualification and commission provenance.
 *
 * THIS SURFACE ANSWERS §14'S QUESTIONS AND NOTHING ELSE. Why did this
 * conversion qualify, for which partner, under which terms VERSION, at what
 * rate, from which source deposit, and when. It is READ ONLY: there is no
 * create, no edit, no reversal and no delete, because §19 forbids staff
 * mutating canonical financial truth through arbitrary form fields and the
 * cheapest way to honour that is not to build the control.
 *
 * THE THREE MONEY FIGURES SIT IN THREE SEPARATE COLUMNS, side by side, named.
 * An operator can read straight across a row and see that a 500.00 deposit
 * under a 120.00 CPA earned 120.00. §51 forbids presenting any of them as
 * another, and a single ambiguous "amount" column is exactly how that happens.
 *
 * THE TERMS VERSION CARRIES ITS CURRENT STATUS. A row reading "v1 · Заменена"
 * is §11 working — the price has since changed and this commission did not.
 * Hiding that would make the immutability invisible on the one screen where an
 * operator would look for it.
 */
import * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchQualifications } from "@/application/api/affiliate-commercial-client";
import type { AffiliateQualificationList } from "@/data/contracts/api/affiliate-commercial";
import { AffiliateSectionTabs } from "@/features/affiliates/affiliate-section-tabs";
import { useAffiliateAccess } from "@/features/affiliates/use-affiliate-access";
import { CONVERSION_TYPE_LABEL, TERMS_STATUS_LABEL, formatInstant, formatMoney, labelFor } from "./commercial-labels";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AffiliateQualificationList }
  | { kind: "error"; message: string }
  | { kind: "forbidden" };

export function CommissionsWorkspace() {
  const access = useAffiliateAccess();
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });

  React.useEffect(() => {
    if (!access.canRead) return;
    let cancelled = false;
    void (async () => {
      const outcome = await fetchQualifications({ limit: 50 });
      if (cancelled) return;
      if (outcome.status === "success") setState({ kind: "ready", data: outcome.data });
      else if (outcome.status === "forbidden" || outcome.status === "unauthenticated") {
        setState({ kind: "forbidden" });
      } else setState({ kind: "error", message: "Не удалось загрузить квалификации CPA." });
    })();
    return () => {
      cancelled = true;
    };
  }, [access.canRead]);

  if (!access.canRead || state.kind === "forbidden") {
    return <EmptyState title="Нет доступа" description="Требуется право на чтение аффилейт-данных." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CPA и комиссии"
        description="Одна квалификация на один засчитанный первый депозит. Реддепозиты не создают вторую комиссию."
      />
      <AffiliateSectionTabs active="commercial" />

      {state.kind === "loading" ? <Skeleton className="h-40 w-full" /> : null}
      {state.kind === "error" ? <EmptyState title="Ошибка" description={state.message} /> : null}

      {state.kind === "ready" ? (
        <>
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-muted-foreground">Итого начислено</h2>
            {state.data.commissionTotals.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {/* NEVER SUMMED ACROSS CURRENCIES. One line per currency, always. */}
                {state.data.commissionTotals.map((total) => (
                  <li key={total.currency ?? "unspecified"} className="tabular-nums">
                    {formatMoney(total.amount, total.currency)}{" "}
                    <span className="text-muted-foreground">({total.count})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {state.data.items.length === 0 ? (
            <EmptyState
              title="Квалификаций пока нет"
              description="Комиссия появляется только после засчитанного первого депозита по атрибутированному переходу."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Квалифицировано</th>
                    <th className="p-3 text-left">Партнёр</th>
                    <th className="p-3 text-left">Кампания</th>
                    <th className="p-3 text-left">Событие-источник</th>
                    <th className="p-3 text-right">Депозит провайдера</th>
                    <th className="p-3 text-right">Ставка CPA</th>
                    <th className="p-3 text-right">Комиссия</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((row) => (
                    <tr key={row.qualificationId} className="border-t">
                      <td className="p-3 font-mono text-xs">{formatInstant(row.qualifiedAt)}</td>
                      <td className="p-3">
                        {row.partner.displayName}
                        <div className="font-mono text-xs text-muted-foreground">
                          {row.partner.codeAtQualification}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs">{row.campaignCodeAtQualification}</td>
                      <td className="p-3">
                        <span className="rounded-full border px-2 py-0.5 text-xs">
                          {labelFor(CONVERSION_TYPE_LABEL, row.sourceConversion.eventType)}
                        </span>
                        <div className="font-mono text-xs text-muted-foreground">
                          {row.sourceConversion.conversionId.slice(0, 12)}…
                        </div>
                      </td>
                      {/* WHAT THE LEARNER PAID POCKET. */}
                      <td className="p-3 text-right tabular-nums">
                        {formatMoney(
                          row.sourceConversion.providerAmount,
                          row.sourceConversion.providerCurrency,
                        )}
                      </td>
                      {/* THE AGREED RATE, WITH ITS VERSION AND CURRENT STATUS. */}
                      <td className="p-3 text-right tabular-nums">
                        {formatMoney(row.terms.cpaAmount, row.terms.cpaCurrency)}
                        <div className="text-xs text-muted-foreground">
                          v{row.terms.version} · {labelFor(TERMS_STATUS_LABEL, row.terms.currentStatus)}
                        </div>
                      </td>
                      {/* WHAT ATA OWES. A THIRD NUMBER. */}
                      <td className="p-3 text-right font-medium tabular-nums">
                        {row.commission === null
                          ? "—"
                          : formatMoney(row.commission.amount, row.commission.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
