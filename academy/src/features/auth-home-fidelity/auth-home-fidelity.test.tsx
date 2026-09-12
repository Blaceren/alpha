/**
 * AUTHENTICATED HOME — the five architectural classes, and the claims the
 * surface may never make.
 *
 * Home carries exactly one current priority. Almost every test below is really
 * one question asked five different ways: does the page ever say more than it
 * knows? A control in a waiting state, a retry over an unrecoverable failure, a
 * guess where the read failed, a greeting where the priority should be — each
 * would be the surface answering a question nobody asked, at the cost of the one
 * it exists to answer.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthHomeField } from "@/features/auth-home-fidelity/auth-home-field";
import { AuthHomeLoadingField } from "@/features/auth-home-fidelity/auth-home-loading";
import { AuthHomeFailure } from "@/features/auth-home-fidelity/auth-home-failure";
import {
  FIELD_NOT_ENROLLED,
  FIELD_NO_CURRICULUM,
  LONG_WAIT_MS,
  NO_LEARNER_ACTION,
  PAGE_FAILURE,
  PENDING_INITIAL,
  PENDING_LONG_WAIT,
  POSTURE_LABEL,
  RETRY_LABEL,
  UNKNOWN_CONSEQUENCE,
  fieldForAction,
  fieldForError,
} from "@/features/auth-home-fidelity/auth-home-state";
import type { AcademyNextAction } from "@/lib/curriculum/next-action";
import type { AcademyLevelSummary } from "@/lib/curriculum/academy-view";
import type { CurriculumReadError } from "@/lib/curriculum/read-errors";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const level = (over: Partial<AcademyLevelSummary> = {}) =>
  ({ levelCode: "v2.l007", order: 7, title: "Поддержка и сопротивление", href: "/lessons/v2.l007", ...over }) as AcademyLevelSummary;

const action = (over: Partial<AcademyNextAction>): AcademyNextAction =>
  ({
    kind: "take-assessment",
    posture: "act",
    title: "Пройдите проверку знаний",
    explanation: "Это текущий шаг вашей программы.",
    ctaLabel: "Открыть уровень",
    href: "/lessons/v2.l007",
    level: level(),
    module: null,
    ...over,
  }) as AcademyNextAction;

const err = (over: Partial<CurriculumReadError> = {}): CurriculumReadError =>
  ({ category: "BACKEND_UNAVAILABLE", retryable: true, requestId: null, ...over }) as CurriculumReadError;

const SRC = (f: string) =>
  readFileSync(join(process.cwd(), "src/features/auth-home-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* --------------------------------------------------------- posture mapping */

describe("Home — the posture is the canonical decision, translated once", () => {
  it("an actionable decision with a control is ACTION", () => {
    const field = fieldForAction(action({}));
    expect(field.posture).toBe("ACTION");
    expect(field).toMatchObject({
      consequence: "Пройдите проверку знаний",
      basis: "Это текущий шаг вашей программы.",
      workIdentity: "Поддержка и сопротивление",
    });
  });

  it("every waiting kind names a role or a system, and never a person", () => {
    const expected: Record<string, string> = {
      "wait-mentor-review": "наставник",
      "wait-report-review": "проверяющий",
      "wait-registration": "внешний партнёр",
      "wait-checkpoint": "система проверки",
      "continue-next-level": "последовательность программы",
    };
    for (const [kind, authority] of Object.entries(expected)) {
      const field = fieldForAction(
        action({ kind: kind as AcademyNextAction["kind"], posture: "waiting", ctaLabel: null, href: null }),
      );
      expect(field.posture, kind).toBe("WAIT");
      expect(field, kind).toMatchObject({ authority });
    }
  });

  it("a locked next level is the programme sequence holding the learner, not an absence", () => {
    const field = fieldForAction(
      action({
        kind: "blocked",
        posture: "blocked",
        title: "Следующий уровень пока закрыт",
        explanation: "Сначала нужно завершить предыдущие уровни.",
        ctaLabel: null,
        href: null,
      }),
    );
    expect(field.posture).toBe("WAIT");
    expect(field).toMatchObject({ authority: "последовательность программы" });
  });

  it("a finished programme asks nothing and offers nothing", () => {
    const field = fieldForAction(action({ kind: "course-complete", posture: "done", ctaLabel: "Открыть путь", href: "/path" }));
    expect(field.posture).toBe("NONE");
    expect(field.consequence).toBe("Программа пройдена");
    expect("control" in field).toBe(false);
  });

  it("offers a retry only where the source classified the failure as recoverable", () => {
    const recoverable = fieldForError(err({ retryable: true }));
    expect(recoverable).toMatchObject({ posture: "UNKNOWN", retry: true });
    expect(recoverable.posture === "UNKNOWN" && recoverable.basis).toContain("временно недоступна");

    const permanent = fieldForError(err({ category: "FORBIDDEN", retryable: false }));
    expect(permanent).toMatchObject({ posture: "UNKNOWN", retry: false });
    /* «временно» is only true where recovery is actually on offer. */
    expect(permanent.posture === "UNKNOWN" && permanent.basis).not.toContain("временно");
  });

  it("never offers a retry that would return the same absence", () => {
    expect(FIELD_NOT_ENROLLED).toMatchObject({ posture: "UNKNOWN", retry: false });
  });

  it("keeps every UNKNOWN row on one consequence, deliberately", () => {
    for (const field of [FIELD_NOT_ENROLLED, fieldForError(err()), fieldForError(err({ retryable: false }))]) {
      expect(field.consequence).toBe(UNKNOWN_CONSEQUENCE);
    }
  });
});

/* ------------------------------------------------------------- composition */

describe("Home — the frozen field", () => {
  const actionField = fieldForAction(action({}));

  it("names itself, states the posture, and carries exactly one h1", () => {
    const { container } = render(<AuthHomeField field={actionField} />);
    expect(container.querySelector(".home-identity")!.tagName).toBe("P");
    expect(container.querySelector(".home-identity__role")!.textContent).toBe("текущий приоритет");
    expect(container.querySelector(".home-posture")!.textContent).toBe(POSTURE_LABEL.ACTION);
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.className).toBe("home-consequence");
  });

  it("declares the posture and the source state on the field itself", () => {
    const { container } = render(<AuthHomeField field={actionField} />);
    const field = container.querySelector(".home-field")!;
    expect(field.getAttribute("data-posture")).toBe("ACTION");
    expect(field.getAttribute("data-state")).toBe("TAKE_ASSESSMENT");
    expect(field.hasAttribute("aria-busy")).toBe(false);
  });

  it("carries at most one handoff, and only the level code crosses it", () => {
    const { container } = render(<AuthHomeField field={actionField} />);
    const handoffs = container.querySelectorAll(".home-handoff");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.getAttribute("href")).toBe("/lessons/v2.l007");
    expect(handoffs[0]!.getAttribute("data-level")).toBe("v2.l007");
    expect(container.querySelector('[data-resolution="handoff"]')).not.toBeNull();
  });

  it("gives a waiting state an authority and NO control of any kind", () => {
    const field = fieldForAction(
      action({ kind: "wait-mentor-review", posture: "waiting", ctaLabel: null, href: null }),
    );
    const { container } = render(<AuthHomeField field={field} />);
    expect(container.querySelector(".home-authority__key")!.textContent).toBe("ожидает");
    expect(container.querySelector(".home-authority__value")!.textContent).toBe("наставник");
    expect(container.querySelector(".home-noaction")!.textContent).toBe(NO_LEARNER_ACTION);
    /* Not a disabled control, not a quiet one — none. */
    expect(container.querySelectorAll("a, button")).toHaveLength(0);
    /* The authority is a role, never a link. */
    expect(container.querySelector(".home-authority")!.querySelector("a")).toBeNull();
  });

  it("gives NONE no control either", () => {
    const { container } = render(<AuthHomeField field={FIELD_NO_CURRICULUM} />);
    expect(container.querySelectorAll("a, button")).toHaveLength(0);
    expect(container.querySelector(".home-resolution")).toBeNull();
    expect(container.querySelector(".home-consequence")!.textContent).toBe(
      "Учебная программа не опубликована",
    );
  });

  it("renders the quiet retry as a button, subordinate and never a handoff", () => {
    const { container } = render(<AuthHomeField field={fieldForError(err())} />);
    const retry = container.querySelector(".home-retry")!;
    expect(retry.tagName).toBe("BUTTON");
    expect(retry.textContent).toBe(RETRY_LABEL);
    expect(container.querySelector('[data-resolution="retry"]')).not.toBeNull();
    expect(container.querySelector(".home-handoff")).toBeNull();
  });

  it("renders no retry where retrying would be a lie", () => {
    const { container } = render(<AuthHomeField field={FIELD_NOT_ENROLLED} />);
    expect(container.querySelector(".home-retry")).toBeNull();
    expect(container.querySelector(".home-resolution")).toBeNull();
  });

  it("removes the retry when pressed and puts focus on the field that survives", async () => {
    refresh.mockClear();
    const { container } = render(<AuthHomeField field={fieldForError(err())} />);
    await userEvent.click(screen.getByRole("button", { name: RETRY_LABEL }));
    expect(container.querySelector(".home-retry")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    const field = container.querySelector(".home-field") as HTMLElement;
    expect(field.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(field);
  });

  it("names the work only where naming it makes the consequence intelligible", () => {
    const withWork = render(<AuthHomeField field={fieldForAction(action({}))} />);
    expect(withWork.container.querySelector(".home-subject")!.textContent).toBe(
      "Поддержка и сопротивление",
    );
    withWork.unmount();
    const withoutWork = render(<AuthHomeField field={FIELD_NO_CURRICULUM} />);
    expect(withoutWork.container.querySelector(".home-subject")).toBeNull();
  });
});

/* ----------------------------------------------------------------- loading */

describe("Home — LOADING is not a focus posture", () => {
  it("gives the heading back to the surface and leaves the consequence ABSENT", () => {
    const { container } = render(<AuthHomeLoadingField />);
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.className).toBe("home-identity");
    /* Absent, not skeletoned: no focus-shaped placeholder where the answer goes. */
    expect(container.querySelector(".home-consequence")).toBeNull();
    expect(container.querySelector(".home-handoff")).toBeNull();
    expect(container.querySelector(".home-retry")).toBeNull();
  });

  it("declares busy honestly and ships the live region already populated", () => {
    const { container } = render(<AuthHomeLoadingField />);
    expect(container.querySelector(".home-field")!.getAttribute("aria-busy")).toBe("true");
    const pending = container.querySelector(".home-pending")!;
    expect(pending.getAttribute("role")).toBe("status");
    expect(pending.getAttribute("aria-live")).toBe("polite");
    /* Populated on arrival, so the initial load announces nothing of its own. */
    expect(pending.textContent).toBe(PENDING_INITIAL);
  });

  it("acknowledges a long wait once, in place, and only once", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<AuthHomeLoadingField />);
      const pending = () => container.querySelector(".home-pending")!.textContent;
      expect(pending()).toBe(PENDING_INITIAL);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_WAIT_MS - 1);
      });
      expect(pending()).toBe(PENDING_INITIAL);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      expect(pending()).toBe(PENDING_LONG_WAIT);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_WAIT_MS * 3);
      });
      expect(pending()).toBe(PENDING_LONG_WAIT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acknowledges early, because nothing on the surface moves", () => {
    expect(LONG_WAIT_MS).toBe(4000);
  });
});

/* ------------------------------------------------------------ page failure */

describe("Home — PAGE_FAILURE is not UNKNOWN", () => {
  it("makes no priority claim of any kind", () => {
    const { container } = render(<AuthHomeFailure reset={() => {}} />);
    expect(container.querySelector(".home-posture")).toBeNull();
    expect(container.querySelector(".home-consequence")).toBeNull();
    expect(container.querySelector(".home-subject")).toBeNull();
    expect(container.querySelector(".home-handoff")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".route-failure")!.getAttribute("data-boundary")).toBe(
      "PAGE_FAILURE",
    );
  });

  it("states the failure as ours, with one neutral retry", async () => {
    const reset = vi.fn();
    const { container } = render(<AuthHomeFailure reset={reset} />);
    expect(container.querySelector(".route-failure__heading")!.textContent).toBe(
      PAGE_FAILURE.heading,
    );
    expect(container.querySelector(".route-failure__explanation")!.textContent).toContain(
      "не в вашем аккаунте и не в ваших действиях",
    );
    await userEvent.click(screen.getByRole("button", { name: PAGE_FAILURE.retry }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows a reference code only when one genuinely exists", () => {
    const without = render(<AuthHomeFailure reset={() => {}} />);
    expect(without.container.querySelector(".route-failure__reference")).toBeNull();
    without.unmount();
    const with_ = render(<AuthHomeFailure reset={() => {}} requestId="7F3K-2M9" />);
    expect(with_.container.querySelector(".route-failure__reference")!.textContent).toBe(
      "Код обращения: 7F3K-2M9",
    );
  });
});

/* --------------------------------------------------- what Home may not say */

describe("Home — what the surface never contains", () => {
  const sources = [
    codeOnly(SRC("auth-home-field.tsx")),
    codeOnly(SRC("auth-home-state.ts")),
    codeOnly(SRC("auth-home-loading.tsx")),
    codeOnly(SRC("auth-home-screen.tsx")),
  ].join("\n");

  /* The FIELD is what may not name the learner. The shell above it legitimately
     shows an avatar built from the session name, and the screen passes it — so
     the screen is deliberately not in this set. */
  const fieldSources = [
    codeOnly(SRC("auth-home-field.tsx")),
    codeOnly(SRC("auth-home-state.ts")),
    codeOnly(SRC("auth-home-loading.tsx")),
  ].join("\n");

  it("never greets, never names the learner, never shows an avatar", () => {
    for (const forbidden of ["Привет", "Здравствуй", "userName", "avatar", "Добро пожаловать", "viewer"]) {
      expect(fieldSources, forbidden).not.toContain(forbidden);
    }
  });

  it("carries no progress, position, streak, XP, rank or amount", () => {
    for (const forbidden of ["progressPercent", "streak", "rankLabel", "xpLabel", "%", "completedLevels"]) {
      expect(sources, forbidden).not.toContain(forbidden);
    }
    expect(sources).not.toMatch(/\$\d/);
    expect(sources).not.toMatch(/\bxp\b/i);
  });

  it("renders no state through a fixture or a scenario", () => {
    expect(sources).not.toContain("scenario");
    expect(sources).not.toContain("searchParams");
  });

  it("does not simulate a read the way the prototype did", () => {
    expect(sources).not.toContain("READ_MS");
    for (const source of [codeOnly(SRC("auth-home-field.tsx")), codeOnly(SRC("auth-home-screen.tsx"))]) {
      expect(source).not.toContain("setTimeout");
    }
  });

  it("adds no second landmark and no skip link", () => {
    expect(sources).not.toContain("<main");
    expect(sources).not.toContain("skip");
  });
});

/* ------------------------------------------------------------------ styles */

describe("Home — the stylesheet is scoped and local", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/auth-home-fidelity/auth-home-fidelity.css"),
    "utf8",
  );
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes no remote request and declares no font face of its own", () => {
    expect(bare).not.toContain("@import");
    expect(bare).not.toContain("@font-face");
    expect(bare).not.toMatch(/https?:\/\//);
  });

  it("keeps the frozen family name, which already pointed at the product's faces", () => {
    expect(bare).toContain("ATA Manrope");
    expect(bare).not.toMatch(/["']Manrope["']/);
  });

  it("lets no selector escape the .ahm namespace", () => {
    const escapees: string[] = [];
    const split = (prelude: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let buf = "";
      for (const ch of prelude) {
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
          parts.push(buf);
          buf = "";
          continue;
        }
        buf += ch;
      }
      parts.push(buf);
      return parts;
    };
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
          for (const part of split(prelude)) {
            const s = part.trim();
            if (s && !s.startsWith(".ahm")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("keeps the :where() focus selector whole", () => {
    expect(bare).toContain(".ahm :where(.home-field a, .home-field button):focus-visible");
  });
});
