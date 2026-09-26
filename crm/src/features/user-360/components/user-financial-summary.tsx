import * as React from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  FINANCIAL_HIDDEN_LABEL,
  FINANCIAL_HIDDEN_TOOLTIP,
  FINANCIAL_MODE_SUFFIX,
  USER_360_LABEL,
  USERS_COLUMN_LABEL,
} from "@/config/labels";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import type { FinancialProjection } from "@/domain/financial/projection";
import type { User360 } from "@/domain/users/user-360";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { Field, SectionCard } from "./section-card";

/**
 * Financial context, rendered strictly from the provider's projection. An exact
 * amount is absent from the payload for roles without permission, so it cannot
 * appear in the DOM, props, title/aria, or serialized data — nothing here is
 * merely CSS-hidden. Every value carries freshness (ROLE_PERMISSION_MATRIX §4.2).
 *
 * No deposit encouragement and no loss-chasing language (D-21): this block
 * reports state, it never suggests funding.
 */
export function UserFinancialSummary({ view }: { view: User360 }) {
  const f = view.financial;
  const fresh = f.freshness;

  return (
    <SectionCard
      title={USER_360_LABEL.financial}
      aside={
        <Tooltip content={`Актуальность данных: ${formatExactTime(fresh.asOf)}`} side="top">
          <span className={fresh.isStale ? "inline-flex items-center gap-1 text-warning" : ""}>
            {fresh.isStale ? <Clock className="h-3 w-3" aria-hidden /> : null}
            {formatRelativeTime(fresh.asOf, displayNowMs())}
          </span>
        </Tooltip>
      }
    >
      <dl>
        <Field label={USERS_COLUMN_LABEL.balance}>
          <Money projection={f.balance} />
        </Field>
        <Field label={USERS_COLUMN_LABEL.netDeposits}>
          <Money projection={f.netDeposits} />
        </Field>
        <Field label="Повторные депозиты">{f.redepositCount}</Field>
        <Field label="Первый депозит">{f.hasFtd ? "подтверждён" : "нет"}</Field>
      </dl>

      {f.accessSuspended || f.pocketConflict || f.grace?.active ? (
        <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
          {f.accessSuspended ? (
            <li>
              <Badge tone="danger">Финансовый доступ приостановлен</Badge>
            </li>
          ) : null}
          {f.pocketConflict ? (
            <li className="flex items-center gap-1.5 text-2xs text-warning">
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
              Расхождение данных продукт ↔ Pocket
            </li>
          ) : null}
          {f.grace?.active ? (
            <li className="text-2xs text-text-secondary">
              <Badge tone="warning">Grace-период</Badge>
              <span className="ml-1.5">
                {f.grace.endsAt ? `до ${formatExactTime(f.grace.endsAt)}` : "активен"}
                {" · "}
                подтверждений ниже порога: {f.grace.belowThresholdConfirmations}
                {f.grace.hasOpenTrades ? " · есть открытые сделки" : ""}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </SectionCard>
  );
}

/**
 * Renders only what the projection carries — never a raw number. Hidden states
 * use the SAME shared semantics as the Users table cell (D-40), so "no data"
 * and "not permitted" can never diverge between the two screens.
 */
function Money({ projection }: { projection: FinancialProjection }) {
  if (projection.mode === "hidden") {
    const reason = projection.hiddenReason ?? "no_data";
    return (
      <Tooltip content={FINANCIAL_HIDDEN_TOOLTIP[reason]} side="top">
        <span className="text-text-muted">{FINANCIAL_HIDDEN_LABEL[reason]}</span>
      </Tooltip>
    );
  }
  const suffix = FINANCIAL_MODE_SUFFIX[projection.mode] ?? null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono tabular-nums">{projection.label}</span>
      {suffix ? <span className="text-2xs text-text-muted">{suffix}</span> : null}
      {projection.stale ? (
        <Tooltip content="Данные устарели" side="top">
          <span className="inline-flex text-warning" aria-label="устарело">
            <Clock className="h-3 w-3" aria-hidden />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
