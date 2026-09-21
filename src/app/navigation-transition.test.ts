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
     A tool opens in a tab of its own through the new `(tool)` route group, which
     carries its own session guard and no shell and adds no loading boundary. The
     old tools and tools-fidelity features are deleted whole, so their files
     appear here as deletions. The curriculum fixture retires the later
     checkpoint tools, and the Home mock names the tools the L18 scenario holds.
     The proxy is a separate bounded module, as Community's is. */
  "src/app/(tool)/layout.tsx",
  "src/app/(tool)/tools/[slug]/page.tsx",
  "src/app/api/backend/tools/trade-cards/[cardId]/route.ts",
  "src/app/api/backend/tools/trade-cards/route.ts",
  "src/data/curriculum/fixture.ts",
  "src/data/mock/home-scenarios.ts",
  "src/features/tool-windows/components/tool-close-button.tsx",
  "src/features/tool-windows/components/tool-locked.tsx",
  "src/features/tool-windows/components/tool-preview-toggle.tsx",
  "src/features/tool-windows/components/tool-soon.tsx",
  "src/features/tool-windows/components/tool-window-frame.tsx",
  "src/features/tool-windows/components/tools-hub.tsx",
  "src/features/tool-windows/model/access.ts",
  "src/features/tool-windows/model/catalog.ts",
  "src/features/tool-windows/tool-windows.css",
  "src/features/tool-windows/trade-card/trade-card-client.ts",
  "src/features/tool-windows/trade-card/trade-card-model.ts",
  "src/features/tool-windows/trade-card/trade-card-parts.tsx",
  "src/features/tool-windows/trade-card/trade-card-preview.tsx",
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
    for (const prefix of [
      "src/features/home", "src/features/level-detail-fidelity",
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
      "src/features/support", "src/components/shell",
      "src/config/feature-visibility.ts", "src/app/layout.tsx",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });
});
