import * as React from "react";
import { Lock, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  CHANNEL_LABEL,
  RECOMMENDATION_LABEL,
  SIGNAL_LABEL,
  USER_360_LABEL,
} from "@/config/labels";
import type { ActionPriority } from "@/domain/recommendations/catalog";
import type { User360Recommendation } from "@/domain/users/user-360";

const ACTION_TONE: Record<ActionPriority, "danger" | "warning" | "info" | "neutral"> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

const ACTION_URGENCY_LABEL: Record<ActionPriority, string> = {
  critical: "Срочно",
  high: "Высокая срочность",
  normal: "Обычная срочность",
  low: "Без срочности",
};

/**
 * Recommended actions — READ-ONLY. There is deliberately no button that would
 * look like it performs the action: Phase 1C has no mutations, and a control
 * that pretended to execute would be a fake success (docs/USER_360.md §Non-scope).
 */
export function UserRecommendations({ items }: { items: User360Recommendation[] }) {
  if (items.length === 0) return null;

  const [primary, ...rest] = items;

  return (
    <div className="space-y-2">
      <RecommendationRow rec={primary!} primary />
      {rest.length > 0 ? (
        <ul className="space-y-2">
          {rest.map((r) => (
            <li key={r.code}>
              <RecommendationRow rec={r} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecommendationRow({ rec, primary = false }: { rec: User360Recommendation; primary?: boolean }) {
  return (
    <div
      className={
        primary
          ? "rounded-md border border-accent/30 bg-accent/5 px-3 py-2"
          : "rounded-md border border-border px-3 py-2"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Worded from the code through the shared label map — the same string
            Users and Today print for this action (D-52), not the read model's
            own copy. */}
        <span className="text-sm font-medium text-text-primary">{RECOMMENDATION_LABEL[rec.code]}</span>
        <Badge tone={ACTION_TONE[rec.priority]}>{ACTION_URGENCY_LABEL[rec.priority]}</Badge>
        {/* Honest read-only marker instead of a non-functional action button. */}
        <Tooltip content="Действия из CRM пока не выполняются — экран только для чтения" side="top">
          <span className="inline-flex items-center gap-1 text-2xs text-text-muted">
            <Lock className="h-3 w-3" aria-hidden />
            {USER_360_LABEL.readOnly}
          </span>
        </Tooltip>
      </div>

      <p className="mt-1 text-xs text-text-secondary">{rec.reason}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-muted">
        <span>Кому: {CHANNEL_LABEL[rec.suggestedChannel]}</span>
        {!rec.allowedForRole ? (
          <Tooltip content="Действие адресовано другой роли — вы видите его как контекст" side="top">
            <span className="inline-flex items-center gap-1 text-warning">
              <UserCheck className="h-3 w-3" aria-hidden />
              не для вашей роли
            </span>
          </Tooltip>
        ) : null}
        {rec.humanApprovalRequired ? <span>Требует решения сотрудника</span> : null}
        {rec.sourceSignalCodes.length > 0 ? (
          <span className="min-w-0">
            {USER_360_LABEL.recommendationBasis}:{" "}
            {rec.sourceSignalCodes.map((c) => SIGNAL_LABEL[c]).join(", ")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
