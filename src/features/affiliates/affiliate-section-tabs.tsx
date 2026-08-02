"use client";

/**
 * AFD-5C1 — the two sub-sections of the Аффилейты workspace.
 *
 * Управление is AFD-5A's inventory; Аналитика is this phase's reporting. They
 * are tabs INSIDE the existing section rather than a second top-level nav item
 * (§15): an operator looking for affiliate numbers looks under affiliates, and a
 * separate "Analytics" root would compete with the CRM's existing one.
 *
 * BOTH TABS REQUIRE THE SAME READ PERMISSION the section already required, so
 * this component makes no permission decision of its own — it is rendered only
 * inside surfaces that have already established `canRead`, and the backend
 * answers 403 regardless of what is displayed here.
 *
 * NO LEAD TAB EXISTS. AFD-5C2 will add one; until it does, there is nothing here
 * that hints at a surface that cannot be opened.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type AffiliateSection = "management" | "analytics";

const TABS: readonly { key: AffiliateSection; label: string; href: string }[] = [
  { key: "management", label: "Управление", href: "/affiliates" },
  { key: "analytics", label: "Аналитика", href: "/affiliates/analytics" },
];

export function AffiliateSectionTabs({ active }: { active: AffiliateSection }) {
  return (
    <nav aria-label="Разделы аффилейтов" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                // `aria-current` carries the selection for assistive tech; the
                // underline and weight carry it visually. Never colour alone.
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  current
                    ? "border-accent font-medium text-text-primary"
                    : "border-transparent text-text-secondary hover:border-border hover:text-text-primary",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
