import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  WS_COPY,
  hostsWorkHere,
  whereLineOf,
  whereOf,
} from "@/features/workspace-fidelity/workspace-state";
import { ToolNotFoundPage } from "@/features/tools-fidelity/tools-fidelity";
import { COPY as PROFILE_COPY } from "@/features/profile-fidelity/profile-state";
import type { AcademyLevelSummary } from "@/lib/curriculum/academy-view";

/**
 * ATA-AUTHENTICATED-SURFACE-TRUTH-1A — the three corrections, pinned.
 *
 * Each one closes a place where a surface said something that was not true:
 * a workspace page that promised work and then denied it, a not-found page with
 * no heading at all, and a profile line pointing at a hidden section. What is
 * asserted here is the truth, not the wording's prettiness — and, just as
 * importantly, that nothing next to it moved.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SCREEN = "src/features/workspace-fidelity/workspace-fidelity-screen.tsx";
const STATE = "src/features/workspace-fidelity/workspace-state.ts";
const TOOLS = "src/features/tools-fidelity/tools-fidelity.tsx";
const PROFILE = "src/features/profile-fidelity/profile-state.ts";

/** The release this phase started from; the isolation assertions diff against it. */
const BASE = "e26102ab175e225e26e65b2bceddc19d86c18e50";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function level(type: string, completionMethod: string): AcademyLevelSummary {
  // Only the two fields these helpers read; the rest of the summary is irrelevant
  // to the copy decision and deliberately not faked into existence.
  return {
    typeInfo: { type },
    completionMethod,
  } as unknown as AcademyLevelSummary;
}

describe("F-2 · workspace no longer contradicts itself", () => {
  it("drops the «here» line only where the page also says there is no workspace", () => {
    // A lesson hosts no work on this page — the line would contradict the section
    // immediately below it.
    expect(whereLineOf(level("lesson", "assessment"))).toBeNull();
    expect(whereLineOf(level("financial-checkpoint", "checkpoint"))).not.toBeNull();
  });

  it("keeps «here» where the work really is hosted on this page", () => {
    // A mentor-review level renders its task host right here, so the line is true.
    const mentor = level("mentor-review", "mentor-review");
    expect(hostsWorkHere(mentor)).toBe(true);
    expect(whereLineOf(mentor)).toBe(WS_COPY.whereHere);
  });

  it("leaves every other «where» wording exactly as it was", () => {
    for (const [method, expected] of [
      ["report", WS_COPY.whereSubmission],
      ["external-event", WS_COPY.whereElsewherePocket],
      ["checkpoint", WS_COPY.whereElsewhereCheckpoint],
      ["manual", WS_COPY.whereElsewhereJournal],
    ] as const) {
      const summary = level("lesson", method);
      expect(whereOf(summary)).toBe(expected);
      // None of these is the contradictory case, so the line survives.
      expect(whereLineOf(summary)).toBe(expected);
    }
  });

  it("explains the state truthfully instead of denying a workspace", () => {
    expect(WS_COPY.noWorkspaceTitle).toBe(
      "Для этого уровня отдельная рабочая область не требуется.",
    );
    expect(WS_COPY.noWorkspaceBody).toBe(
      "Вернитесь к уровню, чтобы продолжить материал и выполнить условие завершения.",
    );
    expect(`${WS_COPY.noWorkspaceTitle} ${WS_COPY.noWorkspaceBody}`).not.toContain(
      "нет рабочей области",
    );
  });

  it("gives the state one main action, pointing at the level", () => {
    const s = src(SCREEN);
    const section = s.slice(
      s.indexOf('<section className="ws-req" aria-label={WS_COPY.noWorkspaceTitle}>'),
    );
    // JSX comments are stripped first: this file's own prose mentions <Link>,
    // and counting it would make the assertion pass or fail on documentation.
    const body = section
      .slice(0, section.indexOf("</section>"))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // A Link, not a bare anchor: client navigation, and a modified click stays
    // native because next/link renders a real <a href>.
    // Both halves of the explanation must actually be rendered, not merely
    // defined: a state that only names itself explains nothing.
    expect(body).toContain("{WS_COPY.noWorkspaceTitle}");
    expect(body).toContain("{WS_COPY.noWorkspaceBody}");
    expect(body).toMatch(/<Link className="ws-req__cta" href=\{levelHref\}>/);
    expect(body).toContain("{WS_COPY.exitLevel}");
    expect(body).not.toMatch(/<a\s/);
    // Exactly one action in this state.
    expect((body.match(/<Link/g) ?? []).length).toBe(1);
    // And it goes to Level Detail, never straight into the material.
    expect(body).not.toContain("/material");
  });

  it("routes the action at the canonical level page", () => {
    const s = src(SCREEN);
    expect(s).toContain(
      "const levelHref = `/lessons/${encodeURIComponent(summary.levelCode)}`;",
    );
  });

  it("leaves the real-workspace branch untouched", () => {
    const s = src(SCREEN);
    // The task host, both of its surfaces and the condition that selects it.
    expect(s).toContain("const hasTask = isReport || isMentorReview;");
    expect(s).toContain('<section className="ws-host" id="task" aria-labelledby="host-h">');
    expect(s).toContain("<LevelReport");
    expect(s).toContain("<LevelMentorReview");
    // The exit row still carries both routes.
    expect(s).toContain('<nav className="ws-exit" aria-label="Выход">');
    expect(s).toContain("{WS_COPY.exitPath}");
  });
});

describe("F-8 · the unknown tool has a heading", () => {
  it("renders the truth line as the page h1", () => {
    const { container } = render(<ToolNotFoundPage />);
    const h1 = container.querySelector("h1");
    expect(h1, "the page had no heading at all").not.toBeNull();
    expect(h1?.textContent).toBe("Такого инструмента нет.");
    expect(container.querySelectorAll("h1").length).toBe(1);
    // The class is what carries the appearance, so nothing moves visually.
    expect(h1?.className).toBe("t-state-truth");
  });

  it("keeps the way back", () => {
    render(<ToolNotFoundPage />);
    const back = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(back).toContain("/tools");
    expect(back.length).toBeGreaterThanOrEqual(2);
  });

  it("does not change the shared StateMessage", () => {
    const s = src(TOOLS);
    // Still a <p>, still no configurable tag: the empty, locked and roadmap
    // states sit under a heading their page already has.
    expect(s).toContain('<p className="t-state-truth">{truth}</p>');
    expect(s).toMatch(/export function StateMessage\(\{\s*\n\s*truth,\s*\n\s*meaning,\s*\n\s*action,/);
    expect(s).not.toMatch(/StateMessage[\s\S]{0,400}?as[?]?:\s*(keyof|"h1")/);
  });

  it("leaves the catalogue and the other tool states alone", () => {
    const s = src(TOOLS);
    for (const marker of [
      "TOOLS_COPY.emptyLead",
      "TOOLS_COPY.lockedLead",
      "TOOLS_COPY.roadmapLead",
    ]) {
      expect(s).toContain(marker);
    }
    // Only ToolNotFoundPage stopped using StateMessage.
    expect(s).not.toMatch(/notFoundLead\}\s*\n\s*meaning=/);
  });
});

describe("F-9 · the profile does not point at a hidden section", () => {
  it("no longer mentions Community", () => {
    expect(PROFILE_COPY.consequence).toBe("Это имя отображается в вашем профиле ATA.");
    expect(PROFILE_COPY.consequence).not.toContain("Сообществ");
  });

  it("changes nothing else about the profile copy", () => {
    expect(PROFILE_COPY.edit).toBe("Изменить");
    expect(PROFILE_COPY.save).toBe("Сохранить");
    expect(PROFILE_COPY.constraint).toBe("От 2 до 50 символов");
    expect(PROFILE_COPY.support_link).toBe("Написать в поддержку");
    expect(PROFILE_COPY.identity_label).toBe("Имя");
  });

  it("does not add conditional Community content or touch the flag", () => {
    const s = src(PROFILE);
    // The flag may be NAMED in a comment explaining why the line went away; what
    // must not appear is a dependency on it — an import or a branch.
    expect(s).not.toMatch(/import[^;]*feature-visibility/);
    expect(s).not.toContain("isVisibleSection");
    expect(s).not.toMatch(/COMMUNITY_ENABLED\s*[?&|]/);
    const flag = src("src/config/feature-visibility.ts");
    expect(flag).toContain("export const COMMUNITY_ENABLED = false;");
  });
});

/**
 * The commit 1A shipped as. Its footprint is a closed question, so it is
 * measured over its OWN range and not against the working tree: a diff that
 * ends at HEAD grows with every later phase, and this file then fails for work
 * it was never about. Each later phase is bounded by its own scope test.
 */
const MINE = "7d7946859497b8ffc45b592e5e40abce7fcdf552";

describe("this phase stayed inside its scope", () => {
  const changed = git("diff", "--name-only", BASE, MINE, "--", "src/", "public/")
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  it("moved five product files in the trees this phase owns, and no more", () => {
    /* SCOPED TO 1A's OWN TREES, not to everything changed since BASE. Later
       phases build on this commit, so a bare diff against BASE grows with each
       of them and the assertion stops meaning anything. What it must keep
       proving is that nothing else moved *here*. The completion-truth phase
       that follows is bounded by its own test. */
    const mine = git(
      "diff", "--name-only", BASE, MINE, "--",
      "src/features/workspace-fidelity/",
      "src/features/tools-fidelity/",
      "src/features/profile-fidelity/",
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    expect(mine.sort()).toEqual(
      [PROFILE, TOOLS, SCREEN, "src/features/workspace-fidelity/workspace-fidelity.css", STATE].sort(),
    );
  });

  it("did not touch Public Home, the shell or the audit's other findings", () => {
    for (const prefix of [
      "src/features/public-home/",
      "src/components/shell/",
      "src/components/navigation/",
      "src/config/navigation.ts",
      "src/config/feature-visibility.ts",
      "src/features/report/",
      "src/features/mentor-review/",
      "src/features/auth/",
      "src/app/",
      "public/",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });

  it("leaves the 899.98px boundary exactly as it is", () => {
    // F-10 was retracted: the audit's «98px» was a bad extraction from this value.
    expect(src("src/features/level-detail-fidelity/level-detail-fidelity.css")).toContain(
      "@media (max-width: 899.98px)",
    );
  });

  it("introduces no bare in-app anchor in the files it touched", () => {
    for (const f of [SCREEN, TOOLS]) {
      const s = src(f);
      const bare = [...s.matchAll(/<a\s[^>]*href="\/(?!\/)/g)];
      expect(bare.map((m) => m[0]), `${f} must use next/link`).toEqual([]);
    }
  });
});
