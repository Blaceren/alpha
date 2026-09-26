import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Tooltip } from "@/components/ui/tooltip";
import { USERS_COLUMN_LABEL } from "@/config/labels";
import type { UserSortField } from "@/data/contracts/CrmDataProvider";
import type { UserSummary } from "@/domain/users/user";
import { UserCell } from "../components/user-cell";
import { PriorityCell } from "../components/priority-cell";
import {
  CompactStatesCell,
  EngagementBadge,
  FundingBadge,
  LifecycleBadge,
  RegistrationBadge,
} from "../components/state-badges";
import { BlockersCell } from "../components/blockers-cell";
import { FinancialCell } from "../components/financial-cell";
import { LastActivityCell } from "../components/last-activity-cell";
import { OwnerCell, ProgressCell, RecommendationCell, ValueSegmentsCell } from "../components/misc-cells";

/** Column meta: responsive visibility + which provider sort field it maps to. */
export interface UsersColumnMeta {
  sortField?: UserSortField;
  /** Tailwind responsive display classes applied to both <th> and <td>. */
  responsiveClass?: string;
}

// The merged "Состояния" column carries the three single-value axes from tablet
// up to standard desktop (md..2xl); only very wide screens (2xl+) get the axes as
// individual columns. This keeps /users within the viewport beside the sidebar.
const COMPACT_STATES = "hidden md:table-cell 2xl:hidden";
const WIDE_ONLY = "hidden 2xl:table-cell"; // individual state columns (2xl+)
const DESKTOP_ONLY = "hidden xl:table-cell"; // Ответственный (xl+)

const meta = (m: UsersColumnMeta): UsersColumnMeta => m;

export const USERS_COLUMNS: ColumnDef<UserSummary>[] = [
  {
    id: "user",
    header: USERS_COLUMN_LABEL.user,
    meta: meta({ sortField: "name" }),
    cell: ({ row }) => <UserCell user={row.original} />,
  },
  {
    id: "priority",
    header: USERS_COLUMN_LABEL.priority,
    meta: meta({ sortField: "priority" }),
    cell: ({ row }) =>
      row.original.priority ? (
        <PriorityCell priority={row.original.priority} reasonCode={row.original.priorityReasonCode} />
      ) : (
        <span className="text-2xs text-text-muted">—</span>
      ),
  },
  // Tablet-only merged column: Этап + Финансовый статус + Активность in one
  // compact stack (data & filters stay independent — see filter-options).
  {
    id: "states",
    header: USERS_COLUMN_LABEL.states,
    meta: meta({ responsiveClass: COMPACT_STATES }),
    cell: ({ row }) => (
      <CompactStatesCell
        lifecycle={row.original.lifecycleStage}
        funding={row.original.fundingStatus}
        engagement={row.original.engagementStatus}
      />
    ),
  },
  {
    id: "lifecycle",
    header: USERS_COLUMN_LABEL.lifecycle,
    meta: meta({ responsiveClass: WIDE_ONLY }),
    cell: ({ row }) => <LifecycleBadge value={row.original.lifecycleStage} />,
  },
  {
    id: "funding",
    header: USERS_COLUMN_LABEL.funding,
    meta: meta({ responsiveClass: WIDE_ONLY }),
    cell: ({ row }) => <FundingBadge value={row.original.fundingStatus} />,
  },
  {
    id: "engagement",
    header: USERS_COLUMN_LABEL.engagement,
    meta: meta({ responsiveClass: WIDE_ONLY }),
    cell: ({ row }) => <EngagementBadge value={row.original.engagementStatus} />,
  },
  {
    id: "progress",
    header: USERS_COLUMN_LABEL.progress,
    meta: meta({ sortField: "currentLevel" }),
    cell: ({ row }) => (
      <ProgressCell level={row.original.currentLevel} xp={row.original.xp} checkpointStatus={row.original.checkpointStatus} />
    ),
  },
  {
    id: "blockers",
    header: USERS_COLUMN_LABEL.blockers,
    cell: ({ row }) => <BlockersCell blockers={row.original.blockers} />,
  },
  {
    id: "owner",
    header: USERS_COLUMN_LABEL.owner,
    meta: meta({ sortField: "owner", responsiveClass: DESKTOP_ONLY }),
    cell: ({ row }) => <OwnerCell ownerId={row.original.ownerId} />,
  },
  {
    id: "lastActivity",
    header: USERS_COLUMN_LABEL.lastActivity,
    meta: meta({ sortField: "lastMeaningfulActionAt" }),
    cell: ({ row }) => <LastActivityCell at={row.original.lastMeaningfulActionAt} />,
  },

  // ---- Optional columns (hidden by default via column visibility) ----
  {
    id: "valueSegments",
    header: USERS_COLUMN_LABEL.valueSegments,
    cell: ({ row }) => <ValueSegmentsCell segments={row.original.valueSegments} />,
  },
  {
    id: "recommendation",
    header: USERS_COLUMN_LABEL.recommendation,
    cell: ({ row }) => <RecommendationCell code={row.original.topRecommendationCode} />,
  },
  {
    id: "registrationStatus",
    header: USERS_COLUMN_LABEL.registrationStatus,
    cell: ({ row }) => <RegistrationBadge value={row.original.registrationStatus} />,
  },
  {
    id: "campaign",
    header: USERS_COLUMN_LABEL.campaign,
    cell: ({ row }) => (
      <span className="text-2xs text-text-secondary">
        {row.original.acquisitionSource ?? "—"}
        {row.original.campaign && row.original.campaign !== "none" ? ` · ${row.original.campaign}` : ""}
      </span>
    ),
  },
  {
    id: "balance",
    header: USERS_COLUMN_LABEL.balance,
    cell: ({ row }) => <FinancialCell projection={row.original.balance} />,
  },
  {
    id: "netDeposits",
    header: USERS_COLUMN_LABEL.netDeposits,
    cell: ({ row }) => <FinancialCell projection={row.original.netDeposits} />,
  },

  // ---- Row action (always visible) ----
  {
    id: "actions",
    header: "",
    enableHiding: false,
    cell: ({ row }) => {
      const name = row.original.displayName ?? row.original.id;
      return (
        <Tooltip content="Открыть профиль" side="left">
          <Link
            href={`/users/${row.original.id}`}
            aria-label={`Открыть профиль ${name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-row-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            <span className="sr-only">Открыть профиль {name}</span>
          </Link>
        </Tooltip>
      );
    },
  },
];

/** Default column visibility — optional columns start hidden. */
export const DEFAULT_COLUMN_VISIBILITY: Record<string, boolean> = {
  valueSegments: false,
  recommendation: false,
  registrationStatus: false,
  campaign: false,
  balance: false,
  netDeposits: false,
};
