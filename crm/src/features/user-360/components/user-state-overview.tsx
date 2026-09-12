import * as React from "react";
import { USER_360_LABEL, USERS_COLUMN_LABEL } from "@/config/labels";
import {
  EngagementBadge,
  FundingBadge,
  LifecycleBadge,
  RegistrationBadge,
} from "@/features/users/components/state-badges";
import type { User360 } from "@/domain/users/user-360";
import { SectionCard } from "./section-card";

/**
 * The state axes, shown as INDEPENDENT tiles (D-01) — never collapsed into one
 * enum and never implying an order between them. Each tile is one axis with its
 * own human label, so the axes cannot be confused with each other.
 */
export function UserStateOverview({ view }: { view: User360 }) {
  const s = view.states;

  return (
    <SectionCard title={USER_360_LABEL.states}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
        <Tile label={USERS_COLUMN_LABEL.lifecycle}>
          <LifecycleBadge value={s.lifecycleStage} />
        </Tile>
        <Tile label={USERS_COLUMN_LABEL.registrationStatus}>
          <RegistrationBadge value={s.registrationStatus} />
        </Tile>
        <Tile label={USERS_COLUMN_LABEL.funding}>
          <FundingBadge value={s.fundingStatus} />
        </Tile>
        <Tile label={USERS_COLUMN_LABEL.engagement}>
          <EngagementBadge value={s.engagementStatus} />
        </Tile>
        <Tile label={USERS_COLUMN_LABEL.progress}>
          <span className="whitespace-nowrap text-xs text-text-primary">
            Уровень {view.learning.currentLevel}
            <span className="text-text-muted"> · {view.learning.xp} XP</span>
          </span>
        </Tile>
      </dl>
    </SectionCard>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-2xs text-text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1">{children}</dd>
    </div>
  );
}
