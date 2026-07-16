import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { BLOCKER_LABEL, USER_360_LABEL, USERS_COLUMN_LABEL, VALUE_SEGMENT_LABEL } from "@/config/labels";
import type { User360 } from "@/domain/users/user-360";
import { SectionCard } from "./section-card";

/**
 * Active blockers = the multi-value STATE axis (what currently blocks the user).
 * Distinct from signals, which are temporary derived indicators — this block
 * says what is true now, `UserSignals` says what the engine detected and why.
 */
export function UserBlockers({ view }: { view: User360 }) {
  const { blockers, valueSegments } = view.states;

  return (
    <SectionCard
      title={USER_360_LABEL.blockers}
      aside={blockers.length > 0 ? String(blockers.length) : undefined}
    >
      {blockers.length === 0 ? (
        <p className="text-xs text-text-muted">Активных блокеров нет.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {blockers.map((b) => (
            <li key={b}>
              <Badge tone="danger">{BLOCKER_LABEL[b]}</Badge>
            </li>
          ))}
        </ul>
      )}

      {valueSegments.length > 0 ? (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1.5 text-2xs text-text-muted">{USERS_COLUMN_LABEL.valueSegments}</p>
          <ul className="flex flex-wrap gap-1.5">
            {valueSegments.map((v) => (
              <li key={v}>
                <Badge tone="accent">{VALUE_SEGMENT_LABEL[v]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}
