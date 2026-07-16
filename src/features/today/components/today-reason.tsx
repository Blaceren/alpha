import * as React from "react";
import type { TodayQueueItem } from "@/domain/today/today";
import { QUEUE_TITLE } from "@/config/queues";
import { TODAY_LABEL, formatEvidence } from "@/config/labels";
import { Badge } from "@/components/ui/badge";

/**
 * Why this user is in the queue — the row's headline.
 *
 * `basis.text` is the domain's own sentence and already carries the figures
 * ("Нет прогресса 80ч…"). The evidence chip beside it is whatever the builder
 * judged to ADD a fact; it withholds anything the sentence already stated, so a
 * row never prints one fact twice (§10).
 *
 * Additional bases are compact chips, never repeated sentences: they say "there
 * is more here" without re-explaining it. The full story is in User 360.
 */
export function TodayReason({ item }: { item: TodayQueueItem }) {
  return (
    <div className="mt-0.5">
      <p className="text-sm leading-snug text-text-primary">
        {/* Named for screen readers: the sentence alone does not say it is the reason. */}
        <span className="sr-only">{TODAY_LABEL.reason}: </span>
        {item.basis.text}
      </p>

      {(item.evidence.length > 0 || item.additionalBasisCodes.length > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {item.evidence.map((e) => {
            const { label, value } = formatEvidence(e);
            return (
              <Badge key={e.code} tone="neutral" className="font-normal">
                <span className="text-text-muted">{label}</span>
                <span className="font-medium text-text-secondary">{value}</span>
              </Badge>
            );
          })}

          {item.additionalBasisCodes.length > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="text-2xs text-text-muted">{TODAY_LABEL.alsoBecause}:</span>
              {item.additionalBasisCodes.map((code) => (
                <Badge key={code} tone="neutral" className="font-normal text-text-secondary">
                  {QUEUE_TITLE[code]}
                </Badge>
              ))}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
