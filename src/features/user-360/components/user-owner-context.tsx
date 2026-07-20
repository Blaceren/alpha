"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { BadgeProps } from "@/components/ui/badge";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
import {
  MENTOR_STATE_LABEL,
  OWNER_ASSIGN_LABEL,
  SLA_KEY_LABEL,
  SLA_STATE_LABEL,
  SUPPORT_STATE_LABEL,
  USER_360_LABEL,
  humanizeCode,
  ownerLabel,
} from "@/config/labels";
import { sessionGrants } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import type { SlaState, User360 } from "@/domain/users/user-360";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { Field, SectionCard } from "./section-card";
import { OwnerAssignForm } from "./owner-assign-form";

const SLA_TONE: Record<SlaState, NonNullable<BadgeProps["tone"]>> = {
  breached: "danger",
  warning: "warning",
  on_track: "success",
  none: "neutral",
};

/**
 * Who owns this user and what work is open.
 *
 * Reassignment lives here (Phase 1B4-C) because this block already answers "who owns
 * them" — the answer to "change that" belongs beside the answer it changes, not in a
 * dialog that hides the value it is about. Everything else stays read-only: the
 * counts are still counts, and the task/case lists are still not here.
 *
 * The picker renders for the three roles with Assign and for nobody else — decided by
 * the session's effective permissions, never by a list of roles in React. The other six
 * get a calm sentence instead of a disabled control: a dead control advertises a
 * capability the role will never have and cannot explain itself to a screen reader
 * (D-59). The current owner stays visible to all nine either way.
 */
export function UserOwnerContext({
  view,
  onOwnerAssigned,
  providerOverride,
  mutationsOverride,
}: {
  view: User360;
  onOwnerAssigned: () => void;
  providerOverride?: CrmDataProvider;
  mutationsOverride?: CrmMutations;
}) {
  const o = view.owner;
  const { session } = useSession();
  const canAssign = sessionGrants(session, "assign_owner");

  return (
    <SectionCard title={USER_360_LABEL.ownerContext}>
      <dl>
        <Field label={OWNER_ASSIGN_LABEL.fieldLabel}>{ownerLabel(o.ownerId)}</Field>
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

      {canAssign ? (
        <OwnerAssignForm
          userId={view.identity.userId}
          currentOwnerId={o.ownerId}
          onAssigned={onOwnerAssigned}
          providerOverride={providerOverride}
          mutationsOverride={mutationsOverride}
        />
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-2xs text-text-muted">
          {OWNER_ASSIGN_LABEL.forbidden}
        </p>
      )}
    </SectionCard>
  );
}
