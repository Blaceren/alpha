import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BadgeProps } from "@/components/ui/badge";
import { PRIORITY_LABEL, PRIORITY_REASON_LABEL, USER_360_LABEL } from "@/config/labels";
import type { PriorityBand } from "@/domain/priority/priority";
import type { User360 } from "@/domain/users/user-360";
import { SectionCard } from "./section-card";
import { UserRecommendations } from "./user-recommendations";

const PRIORITY_TONE: Record<PriorityBand, NonNullable<BadgeProps["tone"]>> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

/**
 * The primary operational block: WHY this user is (or is not) open, and what to
 * do next. Colour is carried by a single badge + a thin accent rule — the panel
 * never floods the screen in red, even for a critical user.
 */
export function UserAttentionPanel({ view }: { view: User360 }) {
  const { attention, recommendations } = view;
  const calm = attention.priority === "low" && view.signals.length === 0;
  const reason = PRIORITY_REASON_LABEL[attention.reasonCode] ?? attention.reasonCode;

  return (
    <SectionCard title={USER_360_LABEL.attention}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <StatusBadge tone={PRIORITY_TONE[attention.priority]} label={PRIORITY_LABEL[attention.priority]} />
          <div className="min-w-0 flex-1">
            {calm ? (
              <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                {USER_360_LABEL.noAttention}
              </p>
            ) : (
              <p className="text-sm font-medium text-text-primary">{reason}</p>
            )}

            {/* The basis is NOT repeated here: the signal that drove this
                priority is marked «Основание приоритета» in the signals block.
                Naming it here too would print the same fact three times (state
                chip + signal + interpretation). The raw StateEvidence likewise
                stays in the read model but is not rendered — its labels are
                English engine internals (docs/USER_360.md §Explainability). */}
          </div>
        </div>

        <div>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {USER_360_LABEL.recommendation}
          </h3>
          <UserRecommendations items={recommendations} />
        </div>
      </div>
    </SectionCard>
  );
}
