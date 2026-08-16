"use client";

import * as React from "react";
import Link from "next/link";
import { CRM_ROLE_LABEL, type Permission } from "@/domain/identity/roles";
import { grants } from "@/domain/identity/access";
import {
  GROWTH_ROOT_PATH,
  GROWTH_SECTION_PERMISSIONS,
} from "@/features/growth/growth-routes";
import { REPORT_REVIEW_PATH } from "@/features/report-review/report-review-workspace";
import { MENTOR_REVIEW_PATH } from "@/features/mentor-review/mentor-review-workspace";
import {
  LEARNER_OPS_PATH,
  LEARNER_OPS_SUPPORT_PATH,
} from "@/features/learner-ops/inbox-workspace";
import type { EmployeeSession } from "@/domain/identity/session";
import { SignOutButton } from "@/features/auth/sign-out-button";

/**
 * Bounded api-mode shell.
 *
 * Deliberately NOT the mock `MockShell`: that one renders the full sidebar with
 * Today, Audit, Financial, Tasks, Cases and Settings, none of which have a
 * backend. Showing them would imply those sections work. This shell exposes
 * exactly the one connected capability — Пользователи — and nothing else.
 *
 * It never renders RoleSwitch (there is no local role to switch), mock counts,
 * fake notifications, the employeeId, the permission list or anything about the
 * backend origin or environment.
 */
export const API_USERS_PATH = "/users";

/**
 * COMMUNITY-V1 — the Community moderation workspace.
 *
 * A constant here, beside the other section paths, because in api mode BOTH the
 * navigation entry and the route composition read it. Two hand-written copies
 * of a pathname is the defect this file's own history is a record of.
 */
export const COMMUNITY_MODERATION_PATH = "/community-moderation";

/**
 * The affiliate section (AFD-5A inventory, AFD-5C1 analytics, AFD-5C2 leads).
 *
 * The first three are exact, terminal paths and each must be matched BEFORE the
 * `/affiliates/{partnerId}` pattern, or "analytics" and "leads" are read as
 * partner ids and those routes silently become 404-shaped detail pages.
 *
 * `AFFILIATE_LEADS_PATH` is additionally the PREFIX of the lead detail route
 * `/affiliates/leads/{leadId}`, which is matched by its own pattern — see
 * `app-shell.tsx`, where the detail is tested before the list so the list's
 * exact match cannot swallow it.
 */
export const AFFILIATES_PATH = "/affiliates";
export const AFFILIATE_ANALYTICS_PATH = "/affiliates/analytics";
/**
 * AFD-5D2 — Curie Atlas, a CHILD of the analytics path.
 *
 * Because it is a child, it must be matched BEFORE `AFFILIATE_ANALYTICS_PATH`
 * would be — they are both exact matches so order between them is not strictly
 * load-bearing, but both must precede the `/affiliates/{partnerId}` pattern for
 * the same reason the other three do.
 */
export const AFFILIATE_ATLAS_PATH = "/affiliates/analytics/atlas";
export const AFFILIATE_LEADS_PATH = "/affiliates/leads";

/**
 * AFFILIATE-PLATFORM-V1 — two more EXACT siblings of `/affiliates/{partnerId}`.
 *
 * THEY MUST BE MATCHED BEFORE THE PARTNER PATTERN, for exactly the reason the
 * three above must be, and this file's header already warned about it. They
 * were added as pages without being registered here, and the shell read
 * "commercial" as a partner id: it fetched `/affiliates/partners/commercial`,
 * the backend answered its canonical `id_invalid`, and the whole screen
 * rendered "Некорректный идентификатор" instead of the workspace. The Next
 * route existed and was correct; the SHELL is what decides what renders.
 */
export const AFFILIATE_COMMERCIAL_PATH = "/affiliates/commercial";
export const AFFILIATE_POSTBACKS_PATH = "/affiliates/postbacks";

/**
 * G4-R1 — the api-mode topbar, as DATA rather than as markup.
 *
 * This nav used to be two hand-written `<li>` blocks, and `ApiModeLanding` used
 * to be a hand-written list of pathnames. Two lists, edited by hand, that had to
 * agree — and when G4 added a section to neither, the workspace existed and was
 * unreachable with no test able to notice.
 *
 * One array now describes what the shell offers. `permissions` is an OR: an
 * empty list means "every authenticated employee", and anything else must be
 * satisfied by the session. The rule for each entry is deliberately the SAME
 * permission the corresponding backend routes enforce, so navigation canon and
 * the real gate cannot drift into showing a section that answers 403.
 */
type ApiNavItem = {
  readonly href: string;
  readonly label: string;
  readonly permissions: readonly Permission[];
};

export const API_NAV_ITEMS: readonly ApiNavItem[] = [
  { href: API_USERS_PATH, label: "Пользователи", permissions: [] },
  {
    href: AFFILIATES_PATH,
    label: "Аффилейты",
    permissions: ["view_affiliate_analytics", "manage_settings"],
  },
  // G4-GROWTH. Beside Аффилейты because an operator looking for traffic sources
  // looks here, but a separate section: that one is configuration and this one
  // is measurement. The href and the permission rule both come from the Growth
  // route registry, which is also what `ApiModeLanding` routes with.
  {
    href: GROWTH_ROOT_PATH,
    label: "Growth",
    permissions: GROWTH_SECTION_PERMISSIONS,
  },
  // OPS-NAV-REVIEW-QUEUES (POCKET-REG-INGRESS-1). The two review queues were
  // routed, authorised and working — and in no menu, reachable only by typing
  // the URL. The third occurrence of exactly the defect `growth-routes.ts`
  // exists to prevent.
  //
  // THE PERMISSION LIST USED TO BE EMPTY, AND LEARNER-OPERATIONS-V1 IS WHY IT
  // IS NOT ANY MORE.
  //
  // The previous note here recorded, correctly at the time, that "no
  // `CrmPermission` expresses reviewer" — the reviewer boundary was a USER-ROLE
  // rule (`admin`/`mentor` on the account) that the CRM session vocabulary could
  // not name. Deriving visibility from the session would then have hidden the
  // queue from real reviewers and shown it to non-reviewers, so an empty list
  // was the honest choice.
  //
  // LO-AUTH-AXIS-1 removed that premise. `learner_ops_report_review` and
  // `learner_ops_mentor_review` now exist, and the canonical Backend gates
  // REQUIRE them in addition to the user-role check. The permission is
  // therefore NECESSARY for reviewership — so hiding the entry from somebody who
  // lacks it hides a queue they genuinely can no longer act on, which is exactly
  // what navigation should do.
  //
  // It is necessary but NOT SUFFICIENT: a staff member holding the permission
  // whose account role is not `admin`/`mentor` still sees the entry and still
  // meets the designed bounded forbidden panel from the Backend queue response.
  // That residual case is the accepted one — a bounded panel, never a dead link
  // and never an authentication loop.
  // `review-queue-navigation.test.tsx` pins navigation and routing together.
  { href: REPORT_REVIEW_PATH, label: "Проверка отчётов", permissions: ["learner_ops_report_review"] },
  { href: MENTOR_REVIEW_PATH, label: "Проверка практики", permissions: ["learner_ops_mentor_review"] },
  // LEARNER-OPERATIONS-V1 — the department itself. `learner_ops_view` is the
  // same permission every read route behind it enforces, so navigation canon
  // and the real gate cannot drift into showing a section that answers 403.
  { href: LEARNER_OPS_PATH, label: "Операции с учениками", permissions: ["learner_ops_view"] },
  { href: LEARNER_OPS_SUPPORT_PATH, label: "Поддержка", permissions: ["learner_ops_view"] },
  // COMMUNITY-V1 — the fourth occurrence of the defect the comment above
  // records, and it was made by the phase that added this line late rather than
  // with the workspace. The CRM has TWO navigation models: `SECTION_VISIBILITY`
  // drives the MOCK shell, and this array drives the API shell PREPROD actually
  // runs. Updating only the first left the moderation workspace routed,
  // authorised, working — and in no menu.
  //
  // `community_moderate` is the same permission `requireCommunityModerator`
  // asserts on every moderation route, so the entry cannot appear for somebody
  // who would only meet a 403 behind it.
  {
    href: COMMUNITY_MODERATION_PATH,
    label: "Сообщество",
    permissions: ["community_moderate"],
  },
];

/** An entry with no permissions is open to every authenticated employee. */
function isNavItemVisible(item: ApiNavItem, session: EmployeeSession): boolean {
  if (item.permissions.length === 0) return true;
  return item.permissions.some((permission) => grants(session.effectivePermissions, permission));
}

export function ApiShell({
  session,
  children,
}: {
  session: EmployeeSession;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {/*
        Every child here is a flex item with the default `min-width: auto`, so the
        header's width floor is the SUM of its children's min-content widths. Once
        that floor exceeds the viewport the header — a block in the full-height
        column — widens the document itself, which is a document-level horizontal
        scroll at 320px and at 200% zoom.

        The floor is therefore made explicit instead of accidental: the badge, the
        section navigation and the sign-out action never shrink (they are the
        things an employee must still be able to reach), the wordmark is dropped
        on narrow viewports because the badge beside it already carries the brand,
        and the identity text is the one element allowed to give — it truncates.
      */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 sm:gap-3 sm:px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-2xs font-bold text-accent-foreground">
          ATA
        </span>
        {/*
          `md` rather than `sm`: at 200% zoom the viewport is still ~640px wide
          (a breakpoint is a CSS pixel query and does not move when the root font
          size doubles), while every box inside it is twice as large. Hiding the
          wordmark only below `sm` therefore still left the identity text with a
          few pixels at 200% zoom and rendered it as a bare ellipsis.
        */}
        <span className="hidden text-sm font-semibold text-text-primary md:inline">ATA CRM</span>

        {/*
          AFD-5C1: the affiliate item appears only when the BACKEND's
          `effectivePermissions` grant `view_affiliate_analytics` or
          `manage_settings`. It is not recomputed from the role, so a session
          reporting `role=crm_admin, effectivePermissions=[]` offers nothing —
          and hiding it is an honesty measure, not the access control, which the
          backend enforces with a 403 regardless of what is rendered here.
        */}
        {/*
          `min-w-0` + `overflow-x-auto`, NOT `shrink-0`.

          The header's width floor is the sum of its children's min-content
          widths, and a `shrink-0` navigation adds its full width to that floor.
          With one item that fitted; AFD-5C1's second item pushed the floor past
          320px, and the sign-out button — the one control an employee must
          always be able to reach — was carried off-screen, taking the whole
          document into horizontal scroll with it. Measured, not guessed: at
          320px the sign-out button ended at x=365 against a 320px document.

          Letting the nav shrink and scroll inside ITSELF keeps both items
          reachable at every width without the document ever scrolling.
        */}
        <nav
          aria-label="Разделы CRM"
          // `flex-1 basis-0`: the nav takes exactly the space the fixed items leave
          // over, rather than claiming its content width and shrinking only
          // proportionally. That is what keeps the sign-out button — the one
          // control an employee must always reach — inside the viewport.
          className="ml-1 min-w-0 flex-1 basis-0 overflow-x-auto sm:ml-4"
        >
          <ul className="flex items-center gap-1 whitespace-nowrap">
            {API_NAV_ITEMS.filter((item) => isNavItemVisible(item, session)).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded px-2 py-1 text-sm font-medium text-text-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          {/*
            `min-w-0` + `truncate`: without both, the name's min-content width is a
            hard floor no amount of available space can reduce. `title` keeps the
            full name reachable when it is visually clipped.
          */}
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium text-text-primary" title={session.displayName}>
              {session.displayName}
            </p>
            <p className="truncate text-2xs text-text-muted">{CRM_ROLE_LABEL[session.role]}</p>
          </div>
          <SignOutButton className="shrink-0" />
        </div>
      </header>

      <main id="crm-content" tabIndex={-1} className="flex-1 overflow-y-auto p-2 focus:outline-none sm:p-4">
        {/*
          `min-w-0` lets this container shrink below its content width. Without it,
          `main`'s default `min-width: auto` as a column flex item allows wide
          content (a data table) to widen the document instead of scrolling inside
          its own container.
        */}
        <div className="mx-auto min-w-0 max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

/**
 * The truthful state for every api-mode route that is not `/users`.
 *
 * `ApiSessionConfirmed` in session-boundary.tsx covers the pre-Users case; this
 * variant adds a way back to the one section that does work, without implying
 * the requested section exists.
 */
export function ApiRouteDeferred({ session }: { session: EmployeeSession }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
          ATA
        </span>
        <h1 className="mt-4 text-base font-semibold text-text-primary">
          Раздел ещё не подключён
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Сессия сотрудника подтверждена. Из данных CRM сейчас доступен только список
          пользователей — остальные разделы будут подключены следующими этапами.
        </p>
        <dl className="mt-4 border-t border-border pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">Сотрудник</dt>
            <dd className="font-medium text-text-primary">{session.displayName}</dd>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <dt className="text-text-muted">Роль</dt>
            <dd className="text-text-secondary">{CRM_ROLE_LABEL[session.role]}</dd>
          </div>
        </dl>
        <Link
          href={API_USERS_PATH}
          className="mt-4 inline-flex h-9 items-center rounded bg-accent px-3.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Перейти к пользователям
        </Link>
      </div>
    </div>
  );
}
