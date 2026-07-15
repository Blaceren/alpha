import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Tooltip } from "@/components/ui/tooltip";
import type { UserSortField } from "@/data/contracts/CrmDataProvider";
import type { UserSummary } from "@/domain/users/user";
import { UserCell } from "../components/user-cell";
import { PriorityCell } from "../components/priority-cell";
import { EngagementBadge, FundingBadge, LifecycleBadge, RegistrationBadge } from "../components/state-badges";
import { BlockersCell } from "../components/blockers-cell";
import { FinancialCell } from "../components/financial-cell";
import { LastActivityCell } from "../components/last-activity-cell";
import { OwnerCell, ProgressCell, RecommendationCell, ValueSegmentsCell } from "../components/misc-cells";

/** Column meta: which provider sort field this column maps to (if sortable). */
export interface UsersColumnMeta {
  sortField?: UserSortField;
  /** Columns hidden at 1024px to keep the table readable. */
  hideOnTablet?: boolean;
}

const meta = (m: UsersColumnMeta): UsersColumnMeta => m;

export const USERS_COLUMNS: ColumnDef<UserSummary>[] = [
  {
    id: "user",
    header: "Пользователь",
    meta: meta({ sortField: "name" }),
    cell: ({ row }) => <UserCell user={row.original} />,
  },
  {
    id: "priority",
    header: "Приоритет",
    meta: meta({ sortField: "priority" }),
    cell: ({ row }) =>
      row.original.priority ? (
        <PriorityCell priority={row.original.priority} reasonCode={row.original.priorityReasonCode} />
      ) : (
        <span className="text-2xs text-text-muted">—</span>
      ),
  },
  {
    id: "lifecycle",
    header: "Lifecycle",
    cell: ({ row }) => <LifecycleBadge value={row.original.lifecycleStage} />,
  },
  {
    id: "funding",
    header: "Финансовый статус",
    cell: ({ row }) => <FundingBadge value={row.original.fundingStatus} />,
  },
  {
    id: "engagement",
    header: "Engagement",
    cell: ({ row }) => <EngagementBadge value={row.original.engagementStatus} />,
  },
  {
    id: "progress",
    header: "Прогресс",
    meta: meta({ sortField: "currentLevel", hideOnTablet: true }),
    cell: ({ row }) => (
      <ProgressCell level={row.original.currentLevel} xp={row.original.xp} checkpointStatus={row.original.checkpointStatus} />
    ),
  },
  {
    id: "blockers",
    header: "Активные блокеры",
    cell: ({ row }) => <BlockersCell blockers={row.original.blockers} />,
  },
  {
    id: "owner",
    header: "Owner",
    meta: meta({ sortField: "owner", hideOnTablet: true }),
    cell: ({ row }) => <OwnerCell ownerId={row.original.ownerId} />,
  },
  {
    id: "lastActivity",
    header: "Последняя активность",
    meta: meta({ sortField: "lastMeaningfulActionAt" }),
    cell: ({ row }) => <LastActivityCell at={row.original.lastMeaningfulActionAt} />,
  },

  // ---- Optional columns (hidden by default via column visibility) ----
  {
    id: "valueSegments",
    header: "Value-сегменты",
    cell: ({ row }) => <ValueSegmentsCell segments={row.original.valueSegments} />,
  },
  {
    id: "recommendation",
    header: "Рекомендация",
    cell: ({ row }) => <RecommendationCell code={row.original.topRecommendationCode} />,
  },
  {
    id: "registrationStatus",
    header: "Регистрация",
    cell: ({ row }) => <RegistrationBadge value={row.original.registrationStatus} />,
  },
  {
    id: "campaign",
    header: "Кампания / источник",
    cell: ({ row }) => (
      <span className="text-2xs text-text-secondary">
        {row.original.acquisitionSource ?? "—"}
        {row.original.campaign && row.original.campaign !== "none" ? ` · ${row.original.campaign}` : ""}
      </span>
    ),
  },
  {
    id: "balance",
    header: "Баланс",
    cell: ({ row }) => <FinancialCell projection={row.original.balance} />,
  },
  {
    id: "netDeposits",
    header: "Net deposits",
    cell: ({ row }) => <FinancialCell projection={row.original.netDeposits} />,
  },

  // ---- Row action (always visible) ----
  {
    id: "actions",
    header: "",
    enableHiding: false,
    cell: ({ row }) => (
      <Tooltip content="Открыть профиль" side="left">
        <Link
          href={`/users/${row.original.id}`}
          aria-label={`Открыть профиль: ${row.original.displayName ?? row.original.id}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-row-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          <span className="sr-only">Открыть профиль</span>
        </Link>
      </Tooltip>
    ),
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
