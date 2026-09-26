/**
 * THE BLOCK RENDERER — a lesson is a document, and it decides nothing.
 *
 * The property that matters most here is §11: the only interactive thing a
 * lesson body can produce is a LINK. A published body is static text written
 * once, so its "Отправить план на проверку" is still in the lesson after the
 * mentor approved the level — and it must not go on looking like the page's one
 * actionable control when the canonical state says otherwise.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LessonBlockView, ctaHref } from "@/features/lesson-reader/lesson-blocks";
import type { LessonBlock } from "@/lib/curriculum/lesson-body";

const LEVEL = "/lessons/v2.l014.lichnyy-risk-plan";
const NEXT = "/lessons/v2.l015.kontrolnaya-tochka-150";

function view(block: LessonBlock, posture: "act" | "waiting" | "blocked" | "done" = "act") {
  return render(
    <LessonBlockView block={block} levelHref={LEVEL} nextLevelHref={NEXT} posture={posture} />,
  );
}

describe("ctaHref — every destination is a route the product already owns", () => {
  it("sends every task action to the level's canonical task surface", () => {
    for (const action of ["start_assessment", "open_report", "request_mentor_review", "pocket_registration"] as const) {
      expect(ctaHref(action, null, LEVEL, NEXT)).toBe(`${LEVEL}#task`);
    }
  });

  it("sends open_tool to the tool, and falls back to the level without one", () => {
    expect(ctaHref("open_tool", "tool.trading_journal", LEVEL, NEXT)).toBe("/tools/tool.trading_journal");
    expect(ctaHref("open_tool", null, LEVEL, NEXT)).toBe(LEVEL);
  });

  it("sends next_level forward, or back to the level when there is nowhere forward", () => {
    expect(ctaHref("next_level", null, LEVEL, NEXT)).toBe(NEXT);
    // The next level may be locked, or this may be the last one. The level page
    // is where the learner finds out — never a dead link.
    expect(ctaHref("next_level", null, LEVEL, null)).toBe(LEVEL);
  });
});

describe("the CTA block follows canonical posture (§11)", () => {
  const cta: LessonBlock = {
    type: "cta",
    action: "request_mentor_review",
    label: "Отправить план на проверку",
    body: "Отправляй запрос, когда все пять частей записаны.",
    toolCode: null,
  };

  it("is the lit control only while the learner can act", () => {
    const { container } = view(cta, "act");
    const link = container.querySelector(".lr-cta__link");
    expect(link?.className).not.toContain("lr-cta__link--quiet");
    expect(container.querySelector(".lr-cta")?.getAttribute("data-posture")).toBe("act");
  });

  it("goes quiet on a level that is finished, waiting or blocked", () => {
    for (const posture of ["done", "waiting", "blocked"] as const) {
      const { container, unmount } = view(cta, posture);
      const link = container.querySelector(".lr-cta__link");
      // The link is KEPT — it goes to the task surface, which is where the real
      // state is — but it is no longer the page's lit control.
      expect(link).not.toBeNull();
      expect(link?.className).toContain("lr-cta__link--quiet");
      unmount();
    }
  });
});

describe("no block can act on the learner's behalf", () => {
  it("renders no button, form or input for any block type", () => {
    const blocks: LessonBlock[] = [
      { type: "heading", level: 3, text: "h" },
      { type: "rich_text", paragraphs: ["p"] },
      { type: "callout", variant: "key_idea", title: null, body: "b" },
      { type: "list", ordered: false, items: ["a"] },
      { type: "table", caption: null, headers: ["h"], rows: [["c"]] },
      { type: "example", title: "t", body: "b" },
      { type: "common_mistake", mistake: "m", correction: "c" },
      { type: "glossary", entries: [{ term: "t", definition: "d" }] },
      { type: "exercise", code: "c", title: "t", instructions: "i", expectedAction: "a", estimatedMinutes: 40 },
      { type: "tool_link", toolCode: "tool.trading_journal", label: "Журнал", context: null },
      { type: "cta", action: "start_assessment", label: "Тест", body: null, toolCode: null },
      { type: "divider" },
    ];
    for (const block of blocks) {
      const { container, unmount } = view(block);
      expect(container.querySelectorAll("button, form, input, textarea, select")).toHaveLength(0);
      unmount();
    }
  });

  it("gives an exercise no completion control — its level has a canonical owner", () => {
    const { container } = view({
      type: "exercise",
      code: "risk-plan",
      title: "Написать личный Risk Plan",
      instructions: "Составь документ.",
      expectedAction: "Сохранить план",
      estimatedMinutes: 40,
    });
    expect(container.querySelectorAll("button, input")).toHaveLength(0);
    // The author's own estimate, shown as written.
    expect(container.textContent).toContain("≈40 мин");
  });

  it("omits the estimate entirely when the author wrote none", () => {
    const { container } = view({
      type: "exercise",
      code: "c",
      title: "t",
      instructions: "i",
      expectedAction: "a",
      estimatedMinutes: null,
    });
    expect(container.textContent).not.toContain("мин");
  });
});

describe("presentation details that carry meaning", () => {
  it("names the callout variant in text, never by colour alone", () => {
    const { container } = view({ type: "callout", variant: "risk", title: null, body: "b" });
    expect(container.textContent).toContain("Риск");
  });

  it("keeps an author's own callout title when there is one", () => {
    const { container } = view({ type: "callout", variant: "info", title: "Своё название", body: "b" });
    expect(container.textContent).toContain("Своё название");
  });

  it("puts a table in its own scroll container so the page never scrolls sideways", () => {
    const { container } = view({
      type: "table",
      caption: "cap",
      headers: ["A", "B"],
      rows: [["1", "2"]],
    });
    expect(container.querySelector(".lr-tablewrap")).not.toBeNull();
    expect(container.querySelector(".lr-tablewrap > table")).not.toBeNull();
    // Column headers are marked up as headers, not as bold cells.
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(2);
  });

  it("renders prose as paragraphs and never as markup", () => {
    const { container } = view({ type: "rich_text", paragraphs: ["<b>жирный</b>", "второй"] });
    expect(container.querySelectorAll("p")).toHaveLength(2);
    // The text is escaped by React, so the tag is content, not an element.
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>жирный</b>");
  });

  it("uses heading levels that keep the document outline correct", () => {
    // h1 is the lesson title and h2 is the section title, so a block heading is
    // h3 or h4 and never anything above them.
    expect(view({ type: "heading", level: 3, text: "x" }).container.querySelector("h3")).not.toBeNull();
    expect(view({ type: "heading", level: 4, text: "x" }).container.querySelector("h4")).not.toBeNull();
  });
});
