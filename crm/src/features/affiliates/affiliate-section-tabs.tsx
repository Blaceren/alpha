"use client";

/**
 * AFD-5C1 — the two sub-sections of the Аффилейты workspace.
 *
 * Управление is AFD-5A's inventory; Аналитика is this phase's reporting. They
 * are tabs INSIDE the existing section rather than a second top-level nav item
 * (§15): an operator looking for affiliate numbers looks under affiliates, and a
 * separate "Analytics" root would compete with the CRM's existing one.
 *
 * ALL THREE TABS REQUIRE THE SAME READ PERMISSION the section already required,
 * so this component makes no permission decision of its own — it is rendered
 * only inside surfaces that have already established `canRead`, and the backend
 * answers 403 regardless of what is displayed here.
 *
 * AFD-5C2 adds Лиды. It carries NO COUNT: a badge would either need a request
 * this component does not make, or a number invented from a page of results —
 * and a keyset list has no total to show.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type AffiliateSection =
  | "management"
  | "analytics"
  | "atlas"
  | "leads"
  | "commercial"
  | "postbacks";

/**
 * AFD-5D2 adds Curie Atlas, immediately after Аналитика.
 *
 * Its position and its URL both say the same thing: it reads the analytics this
 * section already publishes and adds no data of its own. The route is nested
 * under `/affiliates/analytics/` rather than being a sibling, so the address bar
 * agrees with the information architecture — Аффилейты → Аналитика → Curie
 * Atlas — and a top-level "AI" section, which would compete with the CRM's
 * existing Аналитика root and overstate what this is, never appears.
 *
 * IT CARRIES NO BADGE AND NO COUNT. There is nothing to count: Atlas holds no
 * queue and no unread state, and it runs only when an operator asks.
 */
const TABS: readonly { key: AffiliateSection; label: string; href: string }[] = [
  { key: "management", label: "Управление", href: "/affiliates" },
  { key: "analytics", label: "Аналитика", href: "/affiliates/analytics" },
  { key: "atlas", label: "Curie Atlas", href: "/affiliates/analytics/atlas" },
  { key: "leads", label: "Лиды", href: "/affiliates/leads" },
  // AFFILIATE-PLATFORM-V1. Two tabs, not one: "CPA и комиссии" is the money
  // ledger and "Постбэки" is the delivery ledger. They are different questions
  // with different owners, and an operator debugging a partner's receiver is
  // not reconciling a payout.
  //
  // NEITHER CARRIES A BADGE OR A COUNT, for the same reason Лиды does not: a
  // number here would have to come from a request this component does not make.
  { key: "commercial", label: "CPA и комиссии", href: "/affiliates/commercial" },
  { key: "postbacks", label: "Постбэки", href: "/affiliates/postbacks" },
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
