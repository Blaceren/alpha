import * as React from "react";
import { Lightbulb, UserRound } from "lucide-react";
import type { TodayQueueItem } from "@/domain/today/today";
import { RECOMMENDATION_LABEL, TODAY_LABEL, ownerLabel } from "@/config/labels";
import { TodayBalance } from "./today-balance";

/**
 * The recommended next step and who owns it.
 *
 * Rendered as TEXT, not a button. Phase 1B3 is read-only, and a clickable
 * "Follow-up поддержки" would promise an action nothing performs — the honest
 * affordance is to read the recommendation here and act in User 360 (§30).
 *
 * `allowedForRole === false` is stated rather than hidden: the recommendation is
 * still the right next step, it just is not yours to take, and knowing that is
 * what lets you hand it over.
 */
export function TodayNextStep({ item }: { item: TodayQueueItem }) {
  const rec = item.recommendation;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs">
      {rec ? (
        // Wraps rather than truncates: at 1024 the recommendation read
        // "Разобрать контрольную т…", and a half-read instruction is not one.
        // The row is allowed to grow; the advice is not allowed to be cut.
        <span className="inline-flex items-center gap-1">
          <Lightbulb aria-hidden className="h-3 w-3 shrink-0 text-accent" />
          <span className="text-text-muted">{TODAY_LABEL.recommendation}:</span>
          <span className="font-medium text-text-secondary">{RECOMMENDATION_LABEL[rec.code]}</span>
          {!rec.allowedForRole ? (
            <span className="whitespace-nowrap text-text-muted">
              ({TODAY_LABEL.recommendationNotAllowed})
            </span>
          ) : null}
        </span>
      ) : null}

      <span className="inline-flex items-center gap-1">
        <UserRound aria-hidden className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="text-text-muted">{TODAY_LABEL.owner}:</span>
        <span className="text-text-secondary">{ownerLabel(item.ownerId)}</span>
      </span>

      {/* Renders nothing unless this row's basis is actually about money. */}
      <TodayBalance projection={item.financial} />
    </div>
  );
}
