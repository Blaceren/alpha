import * as React from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  CHECKPOINT_LABEL,
  RECOMMENDATION_LABEL,
  VALUE_SEGMENT_LABEL,
  ownerLabel,
} from "@/config/labels";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { ValueSegment } from "@/domain/lifecycle/state";
import type { RecommendedActionCode } from "@/domain/recommendations/catalog";

/** Compact progress: level + XP + checkpoint hint (no per-row progress bar). */
export function ProgressCell({
  level,
  xp,
  checkpointStatus,
}: {
  level: number;
  xp?: number;
  checkpointStatus?: CheckpointStatus;
}) {
  const showCp =
    checkpointStatus &&
    checkpointStatus !== "met" &&
    checkpointStatus !== "not_reached";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap text-xs text-text-primary">
        Ур. <span className="font-medium tabular-nums">{level}</span>
        {xp != null ? <span className="text-text-muted"> · {xp} XP</span> : null}
      </span>
      {showCp ? (
        <span className="text-2xs text-text-muted">{CHECKPOINT_LABEL[checkpointStatus!]}</span>
      ) : null}
    </div>
  );
}

export function OwnerCell({ ownerId }: { ownerId?: string | null }) {
  const assigned = Boolean(ownerId);
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        assigned ? "text-xs text-text-secondary" : "text-2xs text-text-muted",
      )}
    >
      {ownerLabel(ownerId)}
    </span>
  );
}

export function ValueSegmentsCell({ segments }: { segments?: ValueSegment[] }) {
  const list = segments ?? [];
  if (list.length === 0) return <span className="text-2xs text-text-muted">—</span>;
  const shown = list.slice(0, 2);
  const rest = list.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((s) => (
        <Badge key={s} tone="accent">
          {VALUE_SEGMENT_LABEL[s]}
        </Badge>
      ))}
      {rest.length > 0 ? (
        <Tooltip content={rest.map((s) => VALUE_SEGMENT_LABEL[s]).join(", ")} side="top">
          <span className="inline-flex">
            <Badge tone="neutral">+{rest.length}</Badge>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function RecommendationCell({ code }: { code?: RecommendedActionCode | null }) {
  if (!code || code === "no_action_required") {
    return <span className="text-2xs text-text-muted">—</span>;
  }
  return <span className="text-xs text-text-secondary">{RECOMMENDATION_LABEL[code]}</span>;
}
