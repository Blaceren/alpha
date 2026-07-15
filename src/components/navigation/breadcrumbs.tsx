"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SECTION_LABEL } from "@/config/navigation";

interface Crumb {
  label: string;
  href: string;
}

/** Build breadcrumb trail from the pathname (e.g. /users/usr_1 → CRM / Пользователи / usr_1). */
export function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "CRM", href: "/today" }];
  let href = "";
  for (const seg of segments) {
    href += `/${seg}`;
    crumbs.push({ label: SECTION_LABEL[seg] ?? seg, href });
  }
  return crumbs;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);

  return (
    <nav aria-label="Хлебные крошки" className="min-w-0">
      <ol className="flex items-center gap-1 text-xs text-text-muted">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${i}-${c.href}`} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3 w-3 shrink-0" aria-hidden /> : null}
              {isLast ? (
                <span aria-current="page" className="truncate font-medium text-text-secondary">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate hover:text-text-secondary hover:underline">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
