/**
 * WORKSPACE — the page frame, and the two questions it exists to answer.
 *
 * "What is required" and "whose move is it" are separate statements on this
 * page, deliberately. A learner reading «на проверке» still needs to know
 * whether they should be doing something, and the frozen design refuses to make
 * them infer it — which is why the owner line is asserted here as its own
 * sentence, and why WAIT and NONE carry no control at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OWNER,
  WS_COPY,
  decisionOf,
  ownerOf,
  whereOf,
} from "@/features/workspace-fidelity/workspace-state";
import type { AcademyLevelSummary } from "@/lib/curriculum/academy-view";

const summary = (over: Partial<AcademyLevelSummary> = {}): AcademyLevelSummary =>
  ({
    levelCode: "v2.l041",
    order: 41,
    title: "Отчёт по demo-сделкам",
    state: "in_progress",
    completionMethod: "report",
    typeInfo: { type: "report", label: "Отчёт", isCheckpoint: false, supported: true },
    routeAccessible: true,
    ...over,
  }) as AcademyLevelSummary;

const SRC = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* --------------------------------------------------------------- decisions */

describe("Workspace — whose move it is, stated rather than inferred", () => {
  it("distinguishes the mentor from the reviewer, because they are different people", () => {
    expect(ownerOf(summary({ state: "pending_review", completionMethod: "mentor-review" }))).toBe(
      OWNER.mentor,
    );
    expect(ownerOf(summary({ state: "pending_review", completionMethod: "report" }))).toBe(
      OWNER.reviewer,
    );
  });

  it("names the external holder where the Academy is not the one deciding", () => {
    expect(ownerOf(summary({ state: "checkpoint_unverified" }))).toBe(OWNER.verification);
    expect(ownerOf(summary({ completionMethod: "external-event" }))).toBe(OWNER.provider);
  });

  it("says the sequence holds a locked level, and that a finished one holds nobody", () => {
    expect(ownerOf(summary({ state: "locked" }))).toBe(OWNER.sequence);
    expect(ownerOf(summary({ state: "completed" }))).toBe(OWNER.nobody);
  });

  it("says the move is the learner's only when it actually is", () => {
    expect(ownerOf(summary({ state: "in_progress" }))).toBe(OWNER.you);
    expect(ownerOf(summary({ state: "available" }))).toBe(OWNER.you);
  });

  it("carries a decision only where there is one to carry", () => {
    expect(decisionOf(summary({ state: "in_progress" }))).toBe("action");
    expect(decisionOf(summary({ state: "pending_review" }))).toBe("wait");
    expect(decisionOf(summary({ state: "checkpoint_unverified" }))).toBe("wait");
    expect(decisionOf(summary({ state: "completed" }))).toBe("none");
    expect(decisionOf(summary({ state: "locked" }))).toBe("none");
  });

  it("says where the work is actually done, per completion method", () => {
    expect(whereOf(summary({ completionMethod: "report" }))).toBe(WS_COPY.whereSubmission);
    expect(whereOf(summary({ completionMethod: "external-event" }))).toBe(
      WS_COPY.whereElsewherePocket,
    );
    expect(whereOf(summary({ completionMethod: "checkpoint" }))).toBe(
      WS_COPY.whereElsewhereCheckpoint,
    );
    expect(whereOf(summary({ completionMethod: "manual" }))).toBe(WS_COPY.whereElsewhereJournal);
    expect(whereOf(summary({ completionMethod: "assessment" }))).toBe(WS_COPY.whereHere);
  });
});

/* ------------------------------------------------------ the surface's shape */

describe("Workspace — the frame, and what the screen may not do", () => {
  const src = codeOnly(SRC("src/features/workspace-fidelity/workspace-fidelity-screen.tsx"));

  it("re-asks the progression gate server-side on every request", () => {
    expect(src).toContain("summary.routeAccessible");
    /* And answers with the level's OWN canonical sentence, not a generic denial. */
    expect(src).toContain("explainLevelState(summary)");
  });

  it("renders the frozen frame in the frozen order", () => {
    const order = ["ws-id", "ws-req", "ws-state", "ws-host", "ws-mat", "ws-exit"];
    let cursor = -1;
    for (const cls of order) {
      const at = src.indexOf(`"${cls}`);
      expect(at, cls).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("mounts the protected task components without wrapping their mutations", () => {
    expect(src).toContain("<LevelReport");
    expect(src).toContain("<LevelMentorReview");
    /* No mutation of its own: no fetch, no action, no form. */
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain('method: "POST"');
    expect(src).not.toContain("<form");
  });

  it("never treats mentor feedback as approval, and never lets it take the page down", () => {
    expect(src).toContain("MentorFeedbackPanel");
    expect(src).not.toContain("approve");
    /* Read only for the two families that can have it, and null is survivable. */
    expect(src).toContain("isReport || isMentorReview ? await readLevelMentorFeedback");
  });

  it("keeps the shell's active item on Уроки in every state", () => {
    const occurrences = src.match(/activeId="lessons"/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
    expect(src).not.toContain('activeId="path"');
  });

  it("introduces no Workspace domain of its own", () => {
    for (const forbidden of ["/api/backend/workspace", "workspaceId", "WorkspaceModel"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ styles */

describe("Workspace — the stylesheet is scoped and local", () => {
  const css = SRC("src/features/workspace-fidelity/workspace-fidelity.css");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes no remote request", () => {
    expect(bare).not.toContain("@import");
    expect(bare).not.toMatch(/https?:\/\//);
  });

  it("binds both families to the product's local faces", () => {
    expect(bare).toContain('"ATA Manrope"');
    expect(bare).toContain('"ATA IBM Plex Mono"');
    expect(bare).not.toMatch(/"Manrope"/);
    expect(bare).not.toMatch(/"IBM Plex Mono"/);
  });

  it("lets no selector escape the .wsp namespace", () => {
    const escapees: string[] = [];
    const walk = (block: string) => {
      let i = 0;
      while (i < block.length) {
        const open = block.indexOf("{", i);
        if (open === -1) break;
        const prelude = block.slice(i, open).trim();
        let depth = 1;
        let k = open + 1;
        while (k < block.length && depth > 0) {
          if (block[k] === "{") depth++;
          else if (block[k] === "}") depth--;
          k++;
        }
        const inner = block.slice(open + 1, k - 1);
        if (prelude.startsWith("@")) {
          if (/^@(media|supports)/.test(prelude)) walk(inner);
        } else {
          for (const part of prelude.split(",")) {
            const s = part.trim();
            if (s && !s.startsWith(".wsp") && !s.startsWith("html.wsp-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("carries the form vocabulary the frame does not yet apply, so the gap is visible", () => {
    /* Recorded, not hidden: the report form keeps the product's markup while
       its mutation guarantees are written against it. */
    expect(bare).toContain(".wsp .rpt-group");
    expect(css).toContain("protected mutation surface");
  });

  it("does not collide with the superseded screen's stylesheet, which is gone", () => {
    expect(() => SRC("src/features/workspace/workspace.css")).toThrow();
  });
});
