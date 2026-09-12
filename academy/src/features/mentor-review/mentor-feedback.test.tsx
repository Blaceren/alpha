/**
 * FEEDBACK IS NOT APPROVAL (§3) — asserted on the rendered surface.
 *
 * The projection tests prove no internal record can reach this component. These
 * prove the other half: that what the component renders can never be read as a
 * decision while the canonical progression state says one is outstanding.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MentorFeedbackPanel, decisionNote } from "@/features/mentor-review/mentor-feedback";
import type { MentorFeedback } from "@/lib/learner-ops/mentor-feedback";

const FEEDBACK: MentorFeedback = {
  kind: "mentor-review",
  levelCode: "v2.l014.lichnyy-risk-plan",
  messages: [
    {
      id: "m1",
      authorName: "Наставник ATA",
      body: "Risk Plan прочитал. Границы заданы честно.\n\nОдно замечание по дневному лимиту.",
      createdAt: "2026-08-14T10:00:00.000Z",
    },
  ],
};

describe("MentorFeedbackPanel", () => {
  it("renders the reviewer's words and byline", () => {
    render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="pending_review" />);
    expect(screen.getByText(/Risk Plan прочитал/)).toBeInTheDocument();
    expect(screen.getByText("Наставник ATA")).toBeInTheDocument();
    // Blank-line separated prose becomes separate paragraphs, not one run-on.
    expect(screen.getByText(/Одно замечание по дневному лимиту/)).toBeInTheDocument();
  });

  it("says plainly that a reply is not a decision while review is pending", () => {
    render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="pending_review" />);
    const note = screen.getByText(/это ответ наставника, а не решение/i);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/уровень пока не засчитан/i);
  });

  it("never wears completion material while the decision is outstanding", () => {
    const { container } = render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="pending_review" />);
    const panel = container.querySelector(".ax-feedback");
    // `waiting`, never `done` and never `act` — a pending panel must not be the
    // lit surface and must not look finished.
    expect(panel?.getAttribute("data-posture")).toBe("waiting");
  });

  it("shows no completion, XP or success language while pending", () => {
    const { container } = render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="pending_review" />);
    const text = container.textContent ?? "";
    for (const forbidden of ["Уровень завершён", "XP", "Уровень пройден", "принята", "Готово"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("records the completion only once the canonical state says so", () => {
    const { container } = render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="completed" />);
    expect(screen.getByText(/Работа принята наставником\. Уровень завершён\./)).toBeInTheDocument();
    expect(container.querySelector(".ax-feedback")?.getAttribute("data-posture")).toBe("done");
  });

  it("uses report language for a report review", () => {
    render(
      <MentorFeedbackPanel feedback={{ ...FEEDBACK, kind: "report-review" }} levelState="pending_review" />,
    );
    expect(screen.getByText(/Ответ по отчёту/)).toBeInTheDocument();
    expect(screen.getByText(/это ответ по отчёту, а не решение/i)).toBeInTheDocument();
  });

  it("offers no control of any kind", () => {
    // Not a second inbox: no reply box, no button, no link out.
    const { container } = render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="pending_review" />);
    expect(container.querySelectorAll("button, input, textarea, a, form")).toHaveLength(0);
  });

  it("renders a hydration-stable date", () => {
    // A locale-dependent or timezone-dependent format would differ between the
    // server render and the browser render.
    render(<MentorFeedbackPanel feedback={FEEDBACK} levelState="completed" />);
    expect(screen.getByText("14.08.2026")).toBeInTheDocument();
  });
});

describe("decisionNote", () => {
  it("is total, and never implies a verdict for an unexpected state", () => {
    for (const state of ["available", "in_progress", "locked", "checkpoint_unverified"] as const) {
      const note = decisionNote(state, "mentor-review");
      expect(note).toMatch(/решение/i);
      expect(note).not.toMatch(/завершён|принята/i);
    }
  });
});
