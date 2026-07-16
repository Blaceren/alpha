import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { BadgeProps } from "@/components/ui/badge";
import {
  MENTOR_STATE_LABEL,
  SLA_KEY_LABEL,
  SLA_STATE_LABEL,
  SUPPORT_STATE_LABEL,
  USER_360_LABEL,
  humanizeCode,
  ownerLabel,
} from "@/config/labels";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import type { SlaState, User360 } from "@/domain/users/user-360";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { Field, SectionCard } from "./section-card";

const SLA_TONE: Record<SlaState, NonNullable<BadgeProps["tone"]>> = {
  breached: "danger",
  warning: "warning",
  on_track: "success",
  none: "neutral",
};

/**
 * Who owns this user and what work is open. Counts only — the task/case lists
 * and any reassignment are out of scope for read-only Phase 1C, so we show the
 * operational shape without pretending the work can be acted on here.
 */
export function UserOwnerContext({ view }: { view: User360 }) {
  const o = view.owner;

  return (
    <SectionCard title={USER_360_LABEL.ownerContext}>
      <dl>
        <Field label="Ответственный">{ownerLabel(o.ownerId)}</Field>
        <Field label="Открытые задачи">{o.activeTaskCount}</Field>
        <Field label="Открытые кейсы">{o.activeCaseCount}</Field>
        <Field label="Поддержка">{SUPPORT_STATE_LABEL[o.supportState]}</Field>
        <Field label="Ментор">{MENTOR_STATE_LABEL[o.mentorState]}</Field>

        {o.sla ? (
          <Field label="SLA">
            <Tooltip content={`Срок: ${formatExactTime(o.sla.dueAt)}`} side="top">
              {/* Wraps instead of pressing the badge against the card edge in the
                  narrow context column (tablet). */}
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <span className="text-text-secondary">
                  {SLA_KEY_LABEL[o.sla.key] ?? humanizeCode(o.sla.key)}
                </span>
                <Badge tone={SLA_TONE[o.sla.state]}>{SLA_STATE_LABEL[o.sla.state]}</Badge>
              </span>
            </Tooltip>
          </Field>
        ) : null}

        {o.lastEmployeeContactAt ? (
          <Field label="Последний контакт">
            <Tooltip content={formatExactTime(o.lastEmployeeContactAt)} side="top">
              <span>{formatRelativeTime(o.lastEmployeeContactAt, displayNowMs())}</span>
            </Tooltip>
          </Field>
        ) : null}

        {o.nextFollowUpAt ? (
          <Field label="Следующий follow-up">
            <Tooltip content={formatExactTime(o.nextFollowUpAt)} side="top">
              <span>{formatRelativeTime(o.nextFollowUpAt, displayNowMs())}</span>
            </Tooltip>
          </Field>
        ) : null}
      </dl>
    </SectionCard>
  );
}
