/**
 * NAVIGATION TRANSITION — the shell does not blink out between pages.
 *
 * WHAT WAS THERE. `(app)/loading.tsx` was a route-group Suspense boundary that
 * rendered `.ax[aria-label="Загрузка"]` — the legacy navy/cyan field with five
 * skeleton blocks — and rendered NO AppShell. Measured on the release this
 * branch starts from, a `/home → /tools` click showed it from 93ms to 561ms
 * with the shell entirely absent for every one of those frames.
 *
 * WHY IT COULD NOT BE FIXED IN PLACE. The shell is PAGE-LEVEL authority: every
 * page passes its own `userName`, `activeId`, `notificationPresence` and
 * `frozenSurface`, and `(app)/layout.tsx` renders only the session provider. A
 * group-level fallback therefore cannot contain the real shell — it could only
 * contain a second one built from invented values, which is the one thing a
 * loading state must never do.
 *
 * WHAT REPLACES IT. Nothing. Without a boundary the App Router holds the
 * current page — its shell included — until the next segment is ready, then
 * commits in one step. `/home` keeps its OWN loading boundary, which is
 * shell-preserving by construction and stays exactly as accepted.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const GROUP = "src/app/(app)";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}

describe("the authenticated route group", () => {
  it("has no group-level loading boundary to replace the shell with", () => {
    expect(existsSync(join(ROOT, GROUP, "loading.tsx"))).toBe(false);
  });

  it("keeps Home's own boundary, which carries the real shell", () => {
    const home = join(ROOT, GROUP, "home/loading.tsx");
    expect(existsSync(home)).toBe(true);
    const src = readFileSync(home, "utf8");
    // It renders the shell itself, so navigation never disappears on that route.
    expect(src).toContain("AppShell");
    expect(src).toContain('activeId="home"');
    // And it carries no AX field or skeleton.
    expect(src).not.toMatch(/ax-skel|ax-field|className="ax"/);
  });

  it("has no other loading boundary anywhere under the group", () => {
    const found = git("ls-files", "--", `${GROUP}/**/loading.tsx`, `${GROUP}/loading.tsx`)
      .split("\n").filter(Boolean);
    expect(found).toEqual([`${GROUP}/home/loading.tsx`]);
  });

  it("leaves no reachable loading frame carrying the legacy AX field", () => {
    /* `.ax` still belongs to error, not-found and several real screens, so the
       stylesheet is untouched. What must not exist is a LOADING surface built
       from it. */
    const loaders = git("ls-files", "--", "src/app/**/loading.tsx").split("\n").filter(Boolean);
    for (const f of loaders) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/ax-skel/);
      expect(src, f).not.toMatch(/className="ax"/);
      expect(src, f).not.toMatch(/aria-label="Загрузка"/);
    }
  });

  it("adds no artificial delay anywhere in the app shell or routes", () => {
    const files = git("ls-files", "--", "src/app", "src/components/shell").split("\n").filter(Boolean);
    for (const f of files) {
      if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/setTimeout\s*\([^)]*\b(1\d\d|[2-9]\d\d|\d{4,})\b/);
      expect(src, f).not.toMatch(/minimum(Duration|Loading)|artificialDelay/i);
    }
  });

  /**
   * Re-based on the release the boundary removal shipped in.
   *
   * This file was written while that removal was the work in hand and asked
   * "what did THIS pass change?". It is live now, so the question it answers
   * from here is the one every later phase must answer about it: the boundary
   * has not come back, and no surface body has moved except where the owner
   * authorised it.
   */
  /* Re-based again on the release that shipped, which is where the internal-link
     class was closed. From here the question is what SHELL-VIEWER-IDENTITY-2
     moved, and nothing else. */
  const BASE = "c54f5f5358fe2ea9dafc9fa0b74375b117fecb73";

  /* Every file the owner authorised converting from a bare `<a>` to
     `next/link` — the whole confirmed internal-route class.
     AUTHENTICATED-NAVIGATION-FULL-LOAD-1; the anchors themselves are pinned by
     the AST gate in navigation-links.test.tsx. */
  /* Every file this closeout was authorised to move, and nothing else.

     SHELL-VIEWER-IDENTITY-2 — eleven shells that named a fixture learner now
     read the viewer, and the one reachable shell that withheld the unread mark
     now passes it.

     The dead favicon exemption — src/middleware.ts stopped exempting
     `icon.svg` from the auth matcher, for a file-based icon that does not
     exist and a path that answers 404.

     H-7 — the learner session cookie took the `__Host-` prefix, so the five
     server reads that forward it and the middleware that checks for it read
     both names for the length of the cutover window. The Academy verifies
     nothing either way; the Backend is the authority.

     H-STALE-2 — the QA showcase route and its media were removed rather than
     restyled, so the board's stylesheet and its retired palette leave the
     production artifact with it.

     H-8 — next.config.mjs gained the hardening headers the Academy served
     none of. The CSP it ships contains frame-ancestors only, for the reason
     recorded in turnstile-csp.test.ts.

     H-STALE-1 — the video player's retired navy/teal fallbacks now name current
     tokens. Every one of them is unreachable, so no pixel moved.

     SHELL-UNREAD-PRESENCE-SUPPORT-1 — /support was the one live route that
     rendered the bell and never passed the unread mark into it.

     TOOLS-AUTHORITY-DIVERGENCE-1 — the access decision moved to the Backend
     verdict, which touches the projection, its two pages, both surfaces, the
     curriculum DTO and view, and adds a stated fixture verdict. No copy,
     markup or geometry moved with it.

     The link swaps of the previous phase are inside BASE and are pinned by the
     AST gate rather than by this list. */
  const AUTHORISED_VIEWER_IDENTITY = [
  /* TOOLS-V2 slice 1 (owner decision 2026-09-21): the nineteen-tool catalogue
     is replaced by the owner's six, and the Trade Card is the first one built.
     After the owner's review a tool opens in the SAME tab, as an ordinary page
     of the shell at /tools/[slug] with «Все инструменты» as the way back; it
     adds no loading boundary. The old tools and tools-fidelity features are
     deleted whole, so their files appear here as deletions. The curriculum fixture retires the later
     checkpoint tools, and the Home mock names the tools the L18 scenario holds.
     The proxy is a separate bounded module, as Community's is. */
  "src/app/(app)/tools/[slug]/page.tsx",
  "src/app/api/backend/tools/trade-cards/[cardId]/route.ts",
  "src/app/api/backend/tools/trade-cards/route.ts",
  "src/data/curriculum/fixture.ts",
  "src/data/mock/home-scenarios.ts",
  "src/features/tool-windows/components/tool-locked.tsx",
  "src/features/tool-windows/components/tool-page.tsx",
  "src/features/tool-windows/components/tool-soon.tsx",
  "src/features/tool-windows/components/tools-hub.tsx",
  "src/features/tool-windows/model/access.ts",
  "src/features/tool-windows/model/catalog.ts",
  "src/features/tool-windows/tool-windows.css",
  "src/features/tool-windows/trade-card/trade-card-client.ts",
  "src/features/tool-windows/trade-card/trade-card-model.ts",
  "src/features/tool-windows/trade-card/trade-card-parts.tsx",
  "src/features/tool-windows/trade-card/trade-card-workspace.tsx",
  "src/features/tools-fidelity/tools-fidelity-safety.css",
  "src/features/tools-fidelity/tools-fidelity.css",
  "src/features/tools/components/journal-entry-form.tsx",
  "src/features/tools/components/journal-entry-node.tsx",
  "src/features/tools/components/risk-calculator-workspace.tsx",
  "src/features/tools/components/trading-journal-workspace.tsx",
  "src/features/tools/hooks/use-trading-journal.ts",
  "src/features/tools/model/journal-entry.ts",
  "src/features/tools/model/journal-format.ts",
  "src/features/tools/model/journal-store.ts",
  "src/features/tools/model/risk-calculation.ts",
  "src/features/tools/model/risk-format.ts",
  "src/features/tools/model/tool-catalog.ts",
  "src/features/tools/tools.css",
  "src/server/proxy/tools-proxy.ts",
  "src/server/tools/trade-card-read.ts",
  /* TOOLS-V2 slice 2: the Trading Journal. Its window, its two proxy routes and
     its server read, the transport the two tools now share, and the learner's
     calendar date the Trade Card sends when a saved card goes into the journal.
     A page of the shell like the Trade Card's; it adds no loading boundary. */
  "src/app/api/backend/tools/journal/[entryId]/route.ts",
  "src/app/api/backend/tools/journal/route.ts",
  "src/features/tool-windows/journal/journal-client.ts",
  "src/features/tool-windows/journal/journal-model.ts",
  "src/features/tool-windows/journal/journal-parts.tsx",
  "src/features/tool-windows/journal/journal-workspace.tsx",
  "src/features/tool-windows/model/local-date.ts",
  "src/features/tool-windows/tools-client-core.ts",
  "src/server/tools/journal-read.ts",
  /* TOOLS-V2 slice 3: the Risk Calculator. Its window, its proxy route and its
     server read; a page of the shell like the other tools, with no loading
     boundary. */
  "src/app/api/backend/tools/risk-plan/route.ts",
  "src/features/tool-windows/risk/risk-client.ts",
  "src/features/tool-windows/risk/risk-model.ts",
  "src/features/tool-windows/risk/risk-parts.tsx",
  "src/features/tool-windows/risk/risk-workspace.tsx",
  "src/server/tools/risk-read.ts",
  /* TOOLS-V2 slice 4: the Entry Checklist. Its window, its proxy route and its
     server read; a page of the shell like the other tools, with no loading
     boundary. */
  "src/app/api/backend/tools/entry-checks/route.ts",
  "src/features/tool-windows/checklist/checklist-client.ts",
  "src/features/tool-windows/checklist/checklist-model.ts",
  "src/features/tool-windows/checklist/checklist-parts.tsx",
  "src/features/tool-windows/checklist/checklist-workspace.tsx",
  "src/server/tools/checklist-read.ts",
  /* TOOLS-V2 slice 5: Personal Stats. Its window, its proxy route and its
     server read; a page of the shell like the other tools, with no loading
     boundary. */
  "src/app/api/backend/tools/stats/route.ts",
  "src/features/tool-windows/stats/stats-client.ts",
  "src/features/tool-windows/stats/stats-model.ts",
  "src/features/tool-windows/stats/stats-parts.tsx",
  "src/features/tool-windows/stats/stats-workspace.tsx",
  "src/server/tools/stats-read.ts",
  /* TOOLS-V2 slice 6: the News Calendar — its window, its proxy route and its
     server read, a page of the shell like the other tools with no loading
     boundary — and the news it reads: `/news` and `/news/<slug>` outside the
     route group, read without a cookie on the server. SEARCH INDEXING (owner,
     2026-09-21, narrowed 2026-09-22 — DD-326): only Public Home is indexable,
     in production only; the news are product content for signed-in learners
     and never indexed; everything else, PREPROD included, is noindex — so
     Public Home's metadata, robots.txt and the sitemap move with it; the root
     layout does not (the noindex default is the middleware's header on every
     page). */
  "src/app/api/backend/tools/news-calendar/route.ts",
  "src/app/news/[slug]/page.tsx",
  "src/app/news/page.tsx",
  "src/app/page.tsx",
  "src/app/robots.ts",
  "src/app/sitemap.ts",
  "src/config/search-indexing.ts",
  "src/features/public-news/local-release-time.tsx",
  "src/features/public-news/public-news-model.ts",
  "src/features/public-news/public-news-parts.tsx",
  "src/features/public-news/public-news-screens.tsx",
  "src/features/public-news/public-news.css",
  "src/features/tool-windows/news/news-client.ts",
  "src/features/tool-windows/news/news-model.ts",
  "src/features/tool-windows/news/news-parts.tsx",
  "src/features/tool-windows/news/news-workspace.tsx",
  "src/server/news/public-news-read.ts",
  "src/server/tools/news-read.ts",
  /* ATA-PROFILE-FOUNDATION-1: registration asks for a name, the password rule
     is length alone, and Profile gained a security area with a real change-
     password route. The proxy grew exactly one named operation — login-proxy
     .test.ts pins the count — and profile-fidelity.test.tsx governs the
     surface in detail. No session machine, no Turnstile, no CSRF wiring moved. */
  "src/app/api/backend/auth/change-password/route.ts",
  "src/features/auth/register-form.tsx",
  "src/features/profile-fidelity/profile-fidelity.css",
  "src/features/profile-fidelity/profile-fidelity.tsx",
  /* profile-state.ts is already authorised further down by an earlier phase; it
     is listed once, not once per phase that touches it. */
  "src/lib/auth/registration-validation.ts",
  "src/lib/profile/profile-client.ts",
  "src/server/proxy/allow-list.ts",
  /* ATA-AUTH-THRESHOLD-CONTINUITY-1: the threshold surface. The two auth
     pages carry new copy and the shared stage carries the eyebrow and the
     Decision Frame. No form, endpoint, guard or Turnstile wiring moved —
     auth-threshold.test.tsx pins each of those separately. */
  "src/app/(app)/home/page.tsx",
  "src/app/(app)/lessons/[levelCode]/page.tsx",
  "src/app/(app)/lessons/page.tsx",
  "src/app/(app)/path/page.tsx",
  "src/app/(app)/support/page.tsx",
  "src/app/(app)/tools/[toolCode]/page.tsx",
  "src/app/(app)/tools/page.tsx",
  "src/app/login/page.tsx",
  "src/app/register/page.tsx",
  "src/app/showcase/video-player/page.tsx",
  "src/app/showcase/video-player/video-player-showcase.css",
  "src/app/showcase/video-player/video-player-showcase.tsx",
  "src/components/media/academy-video-player.css",
  "src/features/academy-experience/home-screen.tsx",
  "src/features/academy-experience/level-detail-screen.tsx",
  "src/features/auth/auth-stage.css",
  "src/features/auth/auth-stage.tsx",
  "src/features/curriculum-api/api-level-detail.tsx",
  "src/features/lesson-media/lesson-media.tsx",
  "src/features/profile-fidelity/profile-state.ts",
  "src/features/public-home/public-home-header.tsx",
  "src/features/public-home/public-home-screen.tsx",
  "src/features/public-home/public-home.css",
  /* PUBLIC HOME HI-FI (2026-09-22): the FAQ list, and the route with its
     window — all of it the public page, none of it a signed-in surface. */
  "src/features/public-home/public-home-faq.ts",
  "src/features/public-home/product-route-data.ts",
  "src/features/public-home/product-route.tsx",
  "src/features/public-home/product-window-states.tsx",
  "src/features/public-home/cycle-objects.tsx",
  "src/features/public-home/decision-window.tsx",
  "src/features/public-home/review-data.ts",
  "src/features/public-home/review-window.tsx",
  "src/features/report/components/report-status-panel.tsx",
  "src/features/report/report.css",
  "src/features/tools-fidelity/tool-fidelity-surface.tsx",
  "src/features/tools-fidelity/tools-fidelity.tsx",
  "src/features/tools/components/tool-surface.tsx",
  "src/features/tools/components/tools-hub.tsx",
  "src/features/tools/model/canonical-progress.ts",
  "src/features/tools/model/tools-projection.ts",
  "src/features/workspace-fidelity/workspace-fidelity-screen.tsx",
  "src/features/workspace-fidelity/workspace-fidelity.css",
  "src/features/workspace-fidelity/workspace-state.ts",
  "src/lib/auth/constants.ts",
  "src/lib/curriculum/academy-view.ts",
  "src/lib/curriculum/backend-dto.ts",
  "src/lib/curriculum/completion-method.ts",
  "src/lib/curriculum/view-model.ts",
  "src/lib/report/types.ts",
  "src/middleware.ts",
  "src/server/auth/server-session.ts",
  "src/server/curriculum/report-state-read.ts",
  "src/server/curriculum/server-read.ts",
  "src/server/learner-ops/server-read.ts",
  "src/server/notifications/unread-presence.ts",
  /* ACCOUNT RECOVERY (owner, 2026-10-01: «сброс пароля / восстановление пароля,
     подтверждение и смена почты»). The request for a reset link and the three
     pages a link from an email opens — outside the route group, on the auth
     stage; their forms; the browser client, the link-token reader and the
     shapes they share; the server reads of the Backend's capabilities and of
     the learner's own address; eight named proxy operations and their routes;
     the capability-gated «Забыли пароль?» on the login form; and the profile's
     email row, which acts only where the Backend can send mail and is unchanged
     everywhere else (PREPROD among them). */
  "src/app/(app)/profile/page.tsx",
  "src/app/api/backend/auth/email-change/confirm/route.ts",
  "src/app/api/backend/auth/password-reset/confirm/route.ts",
  "src/app/api/backend/auth/password-reset/request/route.ts",
  "src/app/api/backend/auth/resend-verification/route.ts",
  "src/app/api/backend/auth/verify-email/route.ts",
  "src/app/api/backend/profile/account/route.ts",
  "src/app/api/backend/profile/email-change/cancel/route.ts",
  "src/app/api/backend/profile/email-change/route.ts",
  "src/app/confirm-email/page.tsx",
  "src/app/forgot-password/page.tsx",
  "src/app/reset-password/page.tsx",
  "src/app/verify-email/page.tsx",
  "src/features/auth/forgot-password-form.tsx",
  "src/features/auth/link-confirmation.tsx",
  "src/features/auth/login-form.tsx",
  "src/features/auth/reset-password-form.tsx",
  "src/lib/account/account-client.ts",
  "src/lib/account/account-types.ts",
  "src/lib/account/link-token.ts",
  "src/lib/auth/turnstile.ts",
  "src/server/auth/account-read.ts",
  "src/server/proxy/auth-surface.ts",
  /* The owner's review of 2026-10-02. The tools' own date, time and payout
     fields — three components, the panel they share and the three models they
     stand on — in place of the browser's date and time inputs and of a text
     field that took any character. And the check on the sign-in pages: the
     widget now asks Cloudflare to draw its box only when it has something to
     ask, and the test double grew the two callbacks that say when. None of it
     is a page, a route or a loading boundary. */
  "src/features/auth/turnstile-widget.tsx",
  "src/features/tool-windows/components/date-field.tsx",
  "src/features/tool-windows/components/payout-field.tsx",
  "src/features/tool-windows/components/picker-panel.ts",
  "src/features/tool-windows/components/time-field.tsx",
  "src/features/tool-windows/model/calendar.ts",
  "src/features/tool-windows/model/numeric-input.ts",
  "src/features/tool-windows/model/time-input.ts",
  "src/test/turnstile-double.ts",
  /* The owner's bug of 2026-10-02: after an in-page link (`/#review`) and a
     way out («Войти»), Back changed the address and left the screen where it
     was. The browser's entry for an in-page link carries no state and the
     router ignores it. One component that draws nothing hands such entries to
     the router; it stands in the root layout because every page can be the one
     the link is on, or the one Back is pressed from. */
  "src/app/layout.tsx",
  "src/components/navigation/history-entry-sync.tsx",
  /* THE 30-LEVEL PROGRAM (owner, 2026-10-02: «внедряем первые 30 настоящих
     уровней … плеер так же добавляй уже … стилизируй его если надо под наш
     дизайн»). The read model's new facts — chapters, the author's kind of a
     level, levels defined and not open yet, two completion methods, the test's
     разбор — and the surfaces that say them: the level page becomes a lesson
     page (video, the lesson's own text, one task at a time, the tool a level
     opens), the test explains a wrong answer and sends the learner to the
     second of the video, the report is a list of records the platform accepts
     by itself, the registration level settles a registration that came first,
     Path draws chapters and the end of what is open, and the player is in the
     product's language and can be asked for a second. Two routes: the lesson
     media the Academy serves to a learner the Backend would give the lesson to,
     and the registration check. None of it is a loading boundary. */
  "src/app/api/backend/exchange/registration/check/route.ts",
  "src/app/media/[...path]/route.ts",
  "src/components/media/academy-video-player.tsx",
  "src/features/academy-experience/level-completion.tsx",
  "src/features/assessment/assessment-machine.ts",
  "src/features/assessment/level-assessment.tsx",
  "src/features/lesson-media/lesson-playback.ts",
  "src/features/level-detail-fidelity/level-detail-fidelity.css",
  "src/features/level-detail-fidelity/level-lesson-shape.ts",
  "src/features/level-detail-fidelity/level-lesson-text.tsx",
  "src/features/level-detail-fidelity/level-lesson.css",
  "src/features/level-detail-fidelity/level-unlocks.tsx",
  "src/features/level-start/level-start.tsx",
  "src/features/manual-completion/level-manual-completion.tsx",
  "src/features/path-fidelity/path-fidelity-view.tsx",
  "src/features/path-fidelity/path-state.ts",
  "src/features/pocket-registration/pocket-registration-confirmed.tsx",
  "src/features/pocket-registration/pocket-registration.tsx",
  "src/features/report/components/validation-summary.tsx",
  "src/features/report/level-report.tsx",
  "src/features/report/report-definition.ts",
  "src/features/report/report-machine.ts",
  "src/features/report/report-validation.ts",
  "src/lib/assessment/types.ts",
  "src/lib/curriculum/level-kind.ts",
  "src/lib/curriculum/next-action.ts",
  "src/lib/curriculum/progress-state.ts",
  "src/lib/pocket-registration/referral-link-client.ts",
  "src/lib/time/timecode.ts",
  "src/server/media/lesson-media-access.ts",
  "src/server/media/lesson-media-file.ts",
  "src/server/proxy/referral-link-proxy.ts",
  /* THE LESSON HI-FI (owner, 2026-10-02: «доведи экран урока и плеер до хай
     фая … выбери лучшее и реализовывай»; DD-336). The level page's composition
     on one axis — the stage, the reading column, the lesson line down to the
     task — lives in its own stylesheet next to the page's others. The player,
     its wire to the test and the page's markup were already on this list. Not
     a loading boundary. */
  "src/features/level-detail-fidelity/level-hifi.css",
  /* HOME AND PROFILE, FILLED AND HI-FI (owner, 2026-10-03: «наполни внутреннюю
     главную, после сделай ее хай фай, так же сделай с профилем, наполни как
     нормальный профиль на платформе, поддержку тоже сюда переноси, что бы
     написать в поддержку можно было только из профиля, не по ссылке из хеда»;
     DD-337). Home: the greeting, the program line, the module, the tools and
     «Что нового» around the same priority field, which gains the level's
     number; the bell's notifications read is shared with «Что нового». The
     program as points, read by Home and Profile alike. Profile: the passport
     with its ring, the two parts «Аккаунт» and «Поддержка», the support card,
     signing out, the address beside the support handoff, and the profile's
     server read. Support: the desk at /profile/support, /support a redirect to
     it, its status words shared with the card. The shell: support leaves both
     bars, a «Ещё» with one destination becomes that destination's slot, and the
     mobile avatar yields «current» to it. A test-only program fixture. No
     loading boundary moved; the Home's own is untouched. */
  "src/app/(app)/profile/support/page.tsx",
  "src/components/navigation/desktop-route-navigation.tsx",
  "src/components/navigation/mobile-bottom-navigation.tsx",
  "src/components/navigation/mobile-slots.ts",
  "src/components/shell/user-avatar.tsx",
  "src/config/navigation.ts",
  "src/features/auth-home-fidelity/auth-home-field.tsx",
  "src/features/auth-home-fidelity/auth-home-loading.tsx",
  "src/features/auth-home-fidelity/auth-home-screen.tsx",
  "src/features/auth-home-fidelity/auth-home-state.ts",
  "src/features/auth-home-fidelity/home-hifi.css",
  "src/features/auth-home-fidelity/home-news.tsx",
  "src/features/auth-home-fidelity/home-overview-model.ts",
  "src/features/auth-home-fidelity/home-overview.tsx",
  "src/features/auth-home-fidelity/home-program-line.tsx",
  "src/features/profile-fidelity/local-day.tsx",
  "src/features/profile-fidelity/profile-hifi.css",
  "src/features/profile-fidelity/profile-passport.tsx",
  "src/features/profile-fidelity/profile-record.ts",
  "src/features/profile-fidelity/profile-tabs.tsx",
  "src/features/support/components/support-hub.tsx",
  "src/lib/curriculum/program-points.ts",
  "src/lib/support/support-status.ts",
  "src/server/profile/profile-read.ts",
  "src/test/program-fixture.ts",
  /* THE PRODUCT HI-FI, PART 1 (owner, 2026-10-03: «хай фай всего» — the whole
     platform at Public Home's level, the direction delegated, released in
     parts; DD-338). The shared values in the token file (the display face for
     statements and titles, rounded surfaces lit from a corner, pill controls,
     the halo, the arrow), the display face's role widened in the typography
     roles, the shell's bar floating as Public Home's does and its logout a
     pill, and a hi-fi layer over Path, Lessons and Notifications, each mounted
     by its screen. Not a loading boundary. */
  "src/design-system/typography/typography.ts",
  "src/features/home/home.css",
  "src/features/lessons-fidelity/lessons-fidelity-screen.tsx",
  "src/features/lessons-fidelity/lessons-hifi.css",
  "src/features/notifications-fidelity/notifications-fidelity.tsx",
  "src/features/notifications-fidelity/notifications-hifi.css",
  "src/features/path-fidelity/path-hifi.css",
  "src/styles/globals.css",
  "src/styles/tokens.css",
  /* THE PRODUCT HI-FI, PART 2 (DD-338): a hi-fi layer over the tools' hub and
     windows, the reader and the workspace, each mounted by its own page or
     screen; the error and empty states and the top-level 404 in the product's
     language, the states' layer loaded once for the signed-in group by its
     layout. Not a loading boundary. */
  "src/app/(app)/layout.tsx",
  "src/app/not-found.tsx",
  "src/features/reader-fidelity/reader-body.tsx",
  "src/features/reader-fidelity/reader-fidelity-screen.tsx",
  "src/features/reader-fidelity/reader-hifi.css",
  "src/features/reader-fidelity/reader-unavailable.tsx",
  "src/features/tool-windows/tools-hifi.css",
  "src/features/workspace-fidelity/workspace-hifi.css",
  "src/styles/states-hifi.css",
  /* THE NAME (DD-341, owner 2026-10-03: «во всем проекте название должно быть
     alpha а не alfa»): page titles, the brand mark's accessible name and the
     comments that spelled the product «Alfa». Text only — no route, boundary
     or behaviour moved. */
  "src/app/(app)/community/[spaceCode]/page.tsx",
  "src/app/(app)/community/d/[discussionId]/page.tsx",
  "src/app/(app)/community/page.tsx",
  "src/app/(app)/notifications/page.tsx",
  "src/app/(app)/path/[levelCode]/workspace/page.tsx",
  "src/components/shell/app-shell.tsx",
  "src/components/shell/brand-mark.tsx",
  "src/config/not-found-metadata.ts",
  "src/lib/curriculum/provider.ts",
  /* LAUNCH READINESS (2026-10-04, the owner: «продукт должен быть буквально
     готовым к запуску»): «Выйти» always ends the session on this device (the
     logout route clears the cookies when the Backend refuses), and two plain
     sentences — the empty notifications and the material's last line. No
     loading boundary, no route moved. */
  "src/app/api/backend/auth/logout/route.ts",
  "src/features/notifications-fidelity/notifications-state.ts",
  "src/features/reader-fidelity/reader-state.ts",
  /* …the root error page (sign-in, registration, recovery and the news fell
     through to the framework's English default), and the client's one new
     write: marking the notifications read once the learner has seen them. */
  "src/app/error.tsx",
  "src/lib/api/client.ts",
  /* …and the one rule both the register and the bell now read: the broker's
     own events (a Pocket postback, an exchange connection) are never shown to
     a learner — on PREPROD they read «Получен exchange postback:
     first_deposit.». The visibility config itself stays frozen. */
  "src/lib/notifications/learner-facing.ts",
  /* …and the proxy's hop to the Backend for «read»: the Backend routes accept
     PATCH only, the proxy sent POST, and the first real call came back 405. */
  "src/server/proxy/notifications-proxy.ts",
  /* LAUNCH READINESS, WAVE 2 (2026-10-04): no dead ends. A Backend that does
     not answer is «Нет связи с Академией» with a retry, not a sign-out; a 401
     anywhere puts «Сеанс завершён — Войти снова» on screen beside the frozen
     provider; a failed program read says so in the tools instead of drawing
     six closed rows; and a full-length support message fits the proxy. No
     loading boundary, no route moved. */
  "src/features/auth/session-expired-notice.tsx",
  "src/features/auth/session-states.css",
  "src/features/auth/session-unavailable.tsx",
  "src/features/tool-windows/components/tools-read-failed.tsx",
  "src/server/proxy/support-proxy.ts",
  /* …the in-app 404's «На главную» leads to the learner's Home, not the
     marketing page; a reference code and a support-pointing error carry the
     link to support; and the level's tab names the level. */
  "src/app/(app)/not-found.tsx",
  "src/features/curriculum-api/curriculum-states.tsx",
  "src/features/level-start/level-start.css",
  "src/features/manual-completion/level-manual-completion.css",
  "src/lib/curriculum/level-tab-title.ts",
  /* LAUNCH READINESS, WAVE 3 (2026-10-04): a line across the top while the next
     page is on its way — the current page and its shell stay exactly as they
     are, which is the point of this file; the bell's name is text so its
     unread mark is heard; and a support case has an address the profile and
     the notifications can link to. */
  "src/components/shell/navigation-progress.css",
  "src/components/shell/navigation-progress.tsx",
  "src/components/shell/notification-button.tsx",
  "src/components/shell/unread-presence.tsx",
  "src/lib/support/support-links.ts",
  /* PATH, THE OWNER'S REVIEW (2026-10-04): the rail controller draws the
     branch from the current mark straight down to the panel — the stem used to
     hang half a screen below the node it belonged to. Geometry only. */
  "src/features/path-fidelity/path-rail.tsx",
  /* PUBLIC HOME, THE FILM (2026-10-04, owner: «оставляли место для плеера —
     давай его туда поставим уже»): the hero's frame holds the film — its cover
     until a video is on the host — served by one public route of fixed names.
     Nothing of the signed-in group moved. */
  "src/app/film/[name]/route.ts",
  "src/features/public-home/hero-film.tsx",
  "src/server/media/public-film.ts",
  /* The bell's window (DD-349, owner 2026-10-06): the bell opens a small window
     in place, and the learner can clear their list — a named proxy operation. */
  "src/app/api/backend/notifications/clear-all/route.ts",
  "src/components/shell/notifications-bell.tsx",
  "src/components/shell/notifications-popover.tsx",
  "src/components/shell/notifications-popover.css",
  /* Two sessions per account (DD-354, owner 2026-10-07): the profile lists the
     account's live sessions and closes the other one — a named proxy pair with
     one validated id; sign-in operations forward the browser's own description
     so the list can name the device. «Сеанс» (profile-exit.tsx) became
     «Сеансы» (profile-sessions.tsx). */
  "src/app/api/backend/auth/sessions/route.ts",
  "src/app/api/backend/auth/sessions/[id]/close/route.ts",
  "src/features/profile-fidelity/profile-sessions.tsx",
  "src/server/proxy/backend-proxy.ts",
  "src/server/proxy/sessions-proxy.ts",
];

  it("has brought no loading boundary back since the release", () => {
    /* The route group's own boundary is asserted absent above. What this adds is
       that nothing under src/app has moved except the shells the owner
       authorised — a new loading.tsx would show up here as a file that is not on
       the list. */
    const changed = git("diff", "--name-only", BASE, "--", "src/app")
      .split("\n").filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    const unauthorised = changed.filter((f) => !AUTHORISED_VIEWER_IDENTITY.includes(f));
    expect(unauthorised).toEqual([]);
    expect(changed.filter((f) => f.endsWith("loading.tsx"))).toEqual([]);
  });

  it("touches no surface body beyond the authorised viewer-identity change", () => {
    const changed = git("diff", "--name-only", BASE, "--", "src/")
      .split("\n").filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    /* Both sides are sorted. The list is a SET of authorised files; the order
       it happens to be written in is not part of the contract, and making it
       one meant every addition had to be inserted at exactly the right line
       or the failure said only that two 54-item arrays differed. */
    expect(changed.sort()).toEqual([...AUTHORISED_VIEWER_IDENTITY].sort());
    /* The shell's stylesheet lives in the fixture Home's folder. The product
       hi-fi (DD-338) moved the shell — its bar floats — so that one file is
       authorised above, and shell-polish.test.tsx governs its shell section;
       the fixture Home itself stays frozen. */
    const SHELL_STYLESHEET = "src/features/home/home.css";
    for (const prefix of [
      "src/features/home",
      /* Level detail is no longer frozen here: the 30-level program (owner,
         2026-10-02) made the level page a lesson page — the lesson's own text,
         the tool a level opens, the test's разбор, the report as records — and
         took the player's look out of this tree and into the player.
         level-lesson.test.tsx governs the tree in detail: what text may be
         printed on the page and what keeps the reading surface, that the tool
         block is the Backend's verdict and never a link to a closed tool, and
         that every rule of the new sheet stays inside `.ld`, on the page's own
         tokens and breakpoints. Freezing it in two places would mean the looser
         of the two fails first, for the least informative reason. */
      /* Tools is no longer frozen here: TOOLS-AUTHORITY-DIVERGENCE-1
         was authorised to move the access decision, and tools-equivalence.test.ts
         governs that tree in detail — rendered contract, the decision lines, and
         an explicit list of what was allowed to move. Freezing it in two places
         would mean the looser of the two is the one that fails first, for the
         least informative reason. */
      /* Workspace is no longer frozen here: ATA-AUTHENTICATED-SURFACE-TRUTH-1A
         authorised the "no workspace" correction, and surface-truth.test.tsx
         governs that tree in detail — the contradictory line, the explanation,
         the single action and its destination. Freezing it in two places would
         mean the looser of the two fails first, for the least informative
         reason. */
      /* Auth is no longer frozen here: ATA-AUTH-THRESHOLD-CONTINUITY-1
         authorised the threshold composition — an eyebrow, the Decision Frame
         and Public Home's display face on the two headings — and
         auth-threshold.test.tsx governs that tree in detail: every field name,
         label binding, autocomplete value, the CSRF and Turnstile wiring, the
         `next` contract and the submit endpoints are pinned there. Freezing it
         in two places would mean the looser of the two fails first, for the
         least informative reason. */
      /* The root layout is no longer frozen here: the owner's Back-button bug
         of 2026-10-02 is fixed by one component mounted in it, which renders
         nothing (see the list above), and root-layout.test.ts governs the file
         in detail — the document's language, the body's classes, the one thing
         beside the page, the imports, the metadata and the viewport. Freezing
         it in two places would mean the looser of the two fails first, for the
         least informative reason. */
      /* Support and the shell are no longer frozen here: the owner moved
         support into the profile on 2026-10-03, which took it out of both bars
         and touched the avatar's «current». support-hub.test.tsx and
         support-design.test.ts govern the desk in detail (its h1, its regions,
         every status word, its stylesheet), and shell-polish, community-hidden,
         mobile-bottom-navigation, more-menu-disclosure and support-reachable
         govern the shell — every route, every «current», the bar's slots and
         «Ещё» the day it returns. Freezing them in two places would mean the
         looser of the two fails first, for the least informative reason. */
      "src/config/feature-visibility.ts",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix) && f !== SHELL_STYLESHEET), prefix).toEqual([]);
    }
  });
});
