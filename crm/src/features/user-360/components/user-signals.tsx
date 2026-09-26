import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { BadgeProps } from "@/components/ui/badge";
import { SIGNAL_LABEL, SIGNAL_SEVERITY_LABEL, USER_360_LABEL } from "@/config/labels";
import { formatExactTime } from "@/lib/format";
import type { SignalSeverity } from "@/domain/signals/signal";
import type { User360 } from "@/domain/users/user-360";
import { SectionCard } from "./section-card";

const SEVERITY_TONE: Record<SignalSeverity, NonNullable<BadgeProps["tone"]>> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

/**
 * Derived signals: temporary, explainable, expiring (SIGNAL_ENGINE). Rendered as
 * a semantic list with severity + reason, NOT as another row of state badges.
 * The signal the priority was based on is marked, so the priority reason, the
 * blocker and the signal are not read as three unrelated duplicates.
 *
 * Reasons arrive already permission-filtered: for roles without exact financials
 * the provider replaces balance-derived text with the neutral label.
 */
export function UserSignals({ view }: { view: User360 }) {
  const { signals, attention } = view;

  return (
    <SectionCard
      title={USER_360_LABEL.signals}
      aside={signals.length > 0 ? String(signals.length) : undefined}
    >
      {signals.length === 0 ? (
        <p className="text-xs text-text-muted">Активных сигналов нет.</p>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => {
            const drivesPriority = attention.sourceSignalCodes.includes(s.code);
            return (
              <li key={s.code} className="border-b border-border pb-2 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-text-primary">{SIGNAL_LABEL[s.code]}</span>
                  <Tooltip content={`Важность: ${SIGNAL_SEVERITY_LABEL[s.severity]}`} side="top">
                    <span className="inline-flex">
                      <Badge tone={SEVERITY_TONE[s.severity]}>{SIGNAL_SEVERITY_LABEL[s.severity]}</Badge>
                    </span>
                  </Tooltip>
                  {drivesPriority ? (
                    <Badge tone="neutral">{USER_360_LABEL.priorityBasis}</Badge>
                  ) : null}
                </div>
                {/* Omitted when the provider withheld it (balance-derived text). */}
                {s.reason ? <p className="mt-0.5 text-2xs text-text-secondary">{s.reason}</p> : null}
                {s.expiresAt ? (
                  <Tooltip content={`Пересчитан: ${formatExactTime(s.calculatedAt)}`} side="top">
                    <span className="mt-0.5 inline-block text-2xs text-text-muted">
                      действует до {formatExactTime(s.expiresAt)}
                    </span>
                  </Tooltip>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
