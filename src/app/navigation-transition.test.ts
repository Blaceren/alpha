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
    "src/app/(app)/home/page.tsx",
    "src/app/(app)/lessons/[levelCode]/page.tsx",
    "src/app/(app)/lessons/page.tsx",
    "src/app/(app)/path/page.tsx",
    "src/app/(app)/support/page.tsx",
    "src/app/(app)/tools/[toolCode]/page.tsx",
    "src/app/(app)/tools/page.tsx",
    "src/app/showcase/video-player/page.tsx",
    "src/app/showcase/video-player/video-player-showcase.css",
    "src/app/showcase/video-player/video-player-showcase.tsx",
    "src/components/media/academy-video-player.css",
    /* ATA-COMPLETION-TRUTH-1B: the completion-method label and the XP demotion.
       No data, no progression, no Backend — completion-truth.test.tsx pins it. */
    "src/features/academy-experience/home-screen.tsx",
    "src/features/academy-experience/level-detail-screen.tsx",
    "src/features/curriculum-api/api-level-detail.tsx",
    "src/features/lesson-media/lesson-media.tsx",
    /* HOME BRAND EVOLUTION. The owner authorised this route, and only this
       route, to leave byte-identity with the frozen HomeATA page. The scope
       is `src/features/public-home/**`; the frozen prefixes below are what
       this phase may still not touch, and they are unchanged. */
    /* ATA-AUTHENTICATED-SURFACE-TRUTH-1A: five files, all copy or markup.
       No data, no access decision, no progression, no shell. */
    "src/features/profile-fidelity/profile-state.ts",
    "src/features/public-home/public-home-header.tsx",
    "src/features/public-home/public-home-screen.tsx",
    "src/features/public-home/public-home.css",
    /* ATA-REPORT-EVIDENCE-CONTRACT-1: the review a learner was never shown.
       Presentation and a fail-closed reader only — no route, no navigation, no
       progression and no Backend call; evidence-arc.test.tsx pins what they
       render. */
    "src/features/report/components/report-status-panel.tsx",
    "src/features/report/report.css",
    "src/features/tools-fidelity/tool-fidelity-surface.tsx",
    "src/features/tools-fidelity/tools-fidelity.tsx",
    "src/features/tools/components/tool-surface.tsx",
    "src/features/tools/components/tools-hub.tsx",
    "src/features/tools/model/canonical-progress.ts",
    "src/features/tools/model/tool-access-fixture.ts",
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
    expect(changed.sort()).toEqual(AUTHORISED_VIEWER_IDENTITY);
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
      "src/features/support", "src/features/auth/", "src/components/shell",
      "src/config/feature-visibility.ts", "src/app/layout.tsx",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });
});
