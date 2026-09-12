import * as React from "react";
import { Construction } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";

export interface SectionPlaceholderProps {
  title: string;
  /** One-line purpose of the section. */
  purpose: string;
  /** Future capabilities — described, never faked with data or charts. */
  plannedFeatures: string[];
}

/**
 * Reusable placeholder for not-yet-implemented sections. No fake data, no charts.
 * Used by every route that Phase 1A does not fully build.
 */
export function SectionPlaceholder({ title, purpose, plannedFeatures }: SectionPlaceholderProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={purpose}
        actions={<Badge tone="info">Запланировано</Badge>}
      />
      <div className="rounded-lg border border-dashed border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-2 text-text-secondary">
          <Construction className="h-4 w-4" aria-hidden />
          <span className="text-sm font-medium">Раздел ещё не реализован</span>
        </div>
        <p className="mb-3 text-xs text-text-secondary">
          Этот экран появится на следующих этапах. Ниже — запланированные возможности.
          Здесь намеренно нет демонстрационных данных и графиков.
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {plannedFeatures.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs text-text-primary">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
