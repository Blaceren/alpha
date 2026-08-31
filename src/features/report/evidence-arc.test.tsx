import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReportStatusPanel } from "@/features/report/components/report-status-panel";
import { reportReviewEventOf, type ReportSubmission } from "@/lib/report/types";

/**
 * ATA-REPORT-EVIDENCE-CONTRACT-1 — the arc a learner is shown, pinned.
 *
 * The rule under every case: the panel states what the Backend reported and
 * nothing else. A version it was not told about is not drawn; a review it was
 * not told about produces no stage, however obvious the gap looks. A
 * resubmission is evidence that a resubmission happened — not that a review
 * did.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Review = NonNullable<ReturnType<typeof reportReviewEventOf>>;

const rejected = (at: string): Review => ({
  decision: "rejected",
  reviewedAt: at,
  reasonCode: "detail",
  reasonTitle: "Нужна конкретика",
  humanComment: "synthetic comment",
  correctiveAction: "synthetic corrective action",
});
const accepted = (at: string): Review => ({
  decision: "approved",
  reviewedAt: at,
  reasonCode: null,
  reasonTitle: null,
  humanComment: null,
  correctiveAction: null,
});

type Rev = {
  revisionNumber: number;
  kind: ReportSubmission["history"][number]["kind"];
  submittedAt: string | null;
  review?: unknown;
};

function submission(
  status: ReportSubmission["status"],
  history: Rev[],
  extra: Partial<ReportSubmission> = {},
): ReportSubmission {
  return {
    status,
    workflowVersion: history.length,
    activeRevisionNumber: history.at(-1)?.revisionNumber ?? null,
    submittedRevisionNumber: history.filter((r) => r.kind !== "draft_autosave").at(-1)?.revisionNumber ?? null,
    approvedRevisionNumber: null,
    fieldValues: { note: "synthetic value" },
    firstSubmittedAt: null,
    submittedAt: null,
    rejection: null,
    history: history.map((r) => ({ createdAt: "2026-01-01T00:00:00.000Z", ...r })),
    ...extra,
  } as ReportSubmission;
}

const draftRev = (n: number): Rev => ({ revisionNumber: n, kind: "draft_autosave", submittedAt: null });
const sent = (n: number, review?: unknown): Rev => ({
  revisionNumber: n,
  kind: n <= 2 ? "initial_submission" : "resubmission",
  submittedAt: `2026-01-0${n}T10:00:00.000Z`,
  ...(review !== undefined ? { review } : {}),
});

const stagesOf = (container: HTMLElement) =>
  [...container.querySelectorAll(".rpt-arc__item .rpt-arc__label")].map((n) => n.textContent?.trim());

describe("the evidence arc", () => {
  // 1
  it("draws nothing for a draft", () => {
    const { container } = render(<ReportStatusPanel submission={submission("draft", [draftRev(1)])} />);
    expect(container.querySelectorAll(".rpt-arc__item")).toHaveLength(0);
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).not.toContain("Работа принята");
  });

  // 2
  it("shows one sent version while the first review is outstanding", () => {
    const { container } = render(
      <ReportStatusPanel submission={submission("pending_review", [draftRev(1), sent(2)])} />,
    );
    expect(stagesOf(container)).toEqual(["Версия 1 отправлена"]);
    expect(container.textContent).not.toContain("Получен разбор");
    expect(container.textContent).not.toContain("Работа принята");
  });

  // 3 · 14
  it("keeps the request and what to do about it open while a correction is owed", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("rejected", [draftRev(1), sent(2, rejected("2026-01-02T12:00:00.000Z"))], {
          rejection: {
            reasonCode: "detail", reasonTitle: "Нужна конкретика",
            humanComment: "synthetic comment", correctiveAction: "synthetic corrective action",
            reviewedAt: "2026-01-02T12:00:00.000Z",
          },
          submittedRevisionNumber: 2,
        })}
      />,
    );
    // The corrective action is on the page and NOT inside a closed disclosure.
    const action = container.querySelector(".rpt-feedback__action");
    expect(action?.textContent).toContain("synthetic corrective action");
    expect(action?.closest("details")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(stagesOf(container)).toEqual(["Версия 1 отправлена", "Получен разбор"]);
  });

  // 4
  it("shows version, review and the new version while the second review is outstanding", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("pending_review", [
          draftRev(1), sent(2, rejected("2026-01-02T12:00:00.000Z")), draftRev(3), sent(4),
        ])}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор", "Версия 2 отправлена",
    ]);
    expect(container.querySelector("details")).toBeNull();
  });

  // 5
  it("shows a first-pass acceptance without inventing a correction", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [draftRev(1), sent(2, accepted("2026-01-02T12:00:00.000Z"))], {
          approvedRevisionNumber: 2,
        })}
      />,
    );
    expect(stagesOf(container)).toEqual(["Версия 1 отправлена", "Работа принята"]);
    expect(container.textContent).not.toContain("Получен разбор");
  });

  // 6 · 13
  it("shows the full arc after a correction, closed by default", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), sent(2, rejected("2026-01-02T12:00:00.000Z")),
          draftRev(3), sent(4, accepted("2026-01-04T12:00:00.000Z")),
        ], { approvedRevisionNumber: 4 })}
      />,
    );
    const details = container.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("История проверки · 4 этапа");
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор", "Версия 2 отправлена", "Работа принята",
    ]);
    // The result dominates, outside the disclosure.
    const verdict = container.querySelector(".rpt-verdict")!;
    expect(verdict.textContent).toContain("Работа принята");
    expect(verdict.closest("details")).toBeNull();
  });

  // 7
  it("keeps all three versions after two corrections", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), sent(2, rejected("2026-01-02T12:00:00.000Z")),
          draftRev(3), sent(4, rejected("2026-01-04T12:00:00.000Z")),
          draftRev(5), sent(6, accepted("2026-01-06T12:00:00.000Z")),
        ], { approvedRevisionNumber: 6 })}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор",
      "Версия 2 отправлена", "Получен разбор",
      "Версия 3 отправлена", "Работа принята",
    ]);
    expect(container.querySelector("summary")?.textContent).toBe("История проверки · 6 этапов");
  });

  // 8 · 9
  it("draws no stage for a review it was not told about, or told badly", () => {
    for (const bad of [
      undefined, null, {}, { decision: "maybe", reviewedAt: "2026-01-02T12:00:00.000Z" },
      { decision: "approved" }, { decision: "approved", reviewedAt: 5 },
      { decision: "rejected", reviewedAt: "2026-01-02T12:00:00.000Z", humanComment: 7 },
    ]) {
      const { container, unmount } = render(
        <ReportStatusPanel submission={submission("approved", [draftRev(1), sent(2, bad)])} />,
      );
      expect(stagesOf(container), JSON.stringify(bad)).toEqual(["Версия 1 отправлена"]);
      unmount();
    }
    // …and a malformed review never becomes an acceptance stage.
    expect(reportReviewEventOf({ review: { decision: "approved" } })).toBeNull();
  });

  // 10
  it("withholds the arc entirely when two entries claim one revision number", () => {
    /* A repeated storage key cannot be numbered without deciding which of the
       two is the first version, and that decision is not the surface's to make.
       Fail closed: no arc, rather than an arc that says something it does not
       know. Everything else on the panel is untouched. */
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), sent(2, accepted("2026-01-02T12:00:00.000Z")), sent(2, accepted("2026-01-02T12:00:00.000Z")),
        ], { approvedRevisionNumber: 2 })}
      />,
    );
    expect(stagesOf(container)).toEqual([]);
    expect(container.querySelector("details")).toBeNull();
    // The result itself is still stated.
    expect(container.querySelector(".rpt-verdict")?.textContent).toContain("Работа принята");
  });

  // 11
  it("orders by revision number, not by the order the array happened to arrive", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          sent(6, accepted("2026-01-06T12:00:00.000Z")),
          sent(2, rejected("2026-01-02T12:00:00.000Z")),
          sent(4, rejected("2026-01-04T12:00:00.000Z")),
          draftRev(1),
        ], { approvedRevisionNumber: 6 })}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор",
      "Версия 2 отправлена", "Получен разбор",
      "Версия 3 отправлена", "Работа принята",
    ]);
  });

  // 11b — the case that separates "ordered by number" from "ordered by time"
  it("orders by number even when the times disagree with it", () => {
    /* A resubmission can carry an earlier or missing timestamp — a clock skew,
       a backfill, a null. Sorting by time would then reorder the learner's own
       versions. The revision number is the canonical order; time only labels
       an event. */
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          { revisionNumber: 2, kind: "initial_submission", submittedAt: "2026-01-09T10:00:00.000Z",
            review: rejected("2026-01-09T12:00:00.000Z") },
          { revisionNumber: 4, kind: "resubmission", submittedAt: null,
            review: rejected("2026-01-05T12:00:00.000Z") },
          { revisionNumber: 6, kind: "resubmission", submittedAt: "2026-01-01T10:00:00.000Z",
            review: accepted("2026-01-02T12:00:00.000Z") },
        ], { approvedRevisionNumber: 6 })}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор",
      "Версия 2 отправлена", "Получен разбор",
      "Версия 3 отправлена", "Работа принята",
    ]);
  });

  // 12
  it("renders no reviewer identity and no internal field", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1),
          {
            revisionNumber: 2, kind: "initial_submission", submittedAt: "2026-01-02T10:00:00.000Z",
            review: { ...accepted("2026-01-02T12:00:00.000Z"), reviewerId: 42, reviewerRoleSnapshot: "mentor" },
          },
        ], { approvedRevisionNumber: 2 })}
      />,
    );
    const html = container.innerHTML;
    for (const forbidden of ["reviewerId", "reviewerRoleSnapshot", "42", "mentor", "synthetic value"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  // 15
  it("opens and closes from the keyboard, and hides its content until it does", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), sent(2, rejected("2026-01-02T12:00:00.000Z")),
          draftRev(3), sent(4, accepted("2026-01-04T12:00:00.000Z")),
        ], { approvedRevisionNumber: 4 })}
      />,
    );
    const details = container.querySelector("details")!;
    const summary = within(details).getByText(/История проверки/);
    // A real `summary`, so Enter and Space are the browser's job, not ours.
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.getAttribute("tabindex")).toBeNull();
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    // No hand-rolled disclosure anywhere in the panel.
    expect(container.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  // 16
  it("never announces an acceptance for a status it does not know", () => {
    for (const status of ["pending_review", "rejected", "draft", "something_new"]) {
      const { container, unmount } = render(
        <ReportStatusPanel
          submission={submission(status as ReportSubmission["status"], [
            draftRev(1), sent(2, accepted("2026-01-02T12:00:00.000Z")),
          ])}
        />,
      );
      expect(container.querySelector(".rpt-verdict"), status).toBeNull();
      expect(container.querySelector("details"), status).toBeNull();
      unmount();
    }
  });

  // 17 · 18
  it("computes no history from progress, a query string or a fixture", () => {
    const panel = src("src/features/report/components/report-status-panel.tsx");
    /* The forbidden thing is a query string or a fixture acting as authority —
       not the letters. `rpt-verdict` is a class name for the accepted state,
       so the check is on the shapes that would actually read a URL or a
       scenario, and on the words that only make sense as data sources. */
    for (const forbidden of [
      /useSearchParams/, /searchParams/, /\?scenario/, /\?verdict/,
      /scenario\s*[:=]/, /verdict\s*[:=]/, /levelProgressState/, /currentLevel/,
      /from "@\/data\//, /fixture/i,
      /window\.location/, /location\.search/, /URLSearchParams/, /document\.cookie/,
    ]) {
      expect(panel, String(forbidden)).not.toMatch(forbidden);
    }
    expect(panel).not.toContain("progress");
    // The only source of a stage is the revision list the Backend sent.
    expect(panel).toContain("submission.history");
    expect(panel).toContain("reportReviewEventOf(revision)");
    // And the reader is the one place a review is accepted.
    const types = src("src/lib/report/types.ts");
    expect((types.match(/export function reportReviewEventOf/g) ?? []).length).toBe(1);
  });

  it("keeps a visible focus ring on the disclosure", () => {
    /* The summary is the only control this panel adds. A `:focus-visible` rule
       that resolves to `none` would leave a keyboard user unable to see where
       they are, and no rendered assertion can see a stylesheet — so the rule
       itself is pinned. */
    const css = src("src/features/report/report.css");
    const rule = css.slice(css.indexOf(".rpt-arc__summary:focus-visible"));
    const block = rule.slice(0, rule.indexOf("}") + 1);
    expect(block).toMatch(/outline:\s*\d+px\s+solid/);
    expect(block).not.toMatch(/outline:\s*none/);
    expect(block).toMatch(/outline-offset/);
    // …and the target it belongs to is a real one.
    const target = css.slice(css.indexOf(".rpt-arc__summary {"));
    expect(target.slice(0, target.indexOf("}") + 1)).toMatch(/min-height:\s*44px/);
  });

  it("keeps the added field optional, so an older Backend still renders", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [draftRev(1), sent(2)], { approvedRevisionNumber: 2 })}
      />,
    );
    // No review reported anywhere: versions only, and no acceptance stage.
    expect(stagesOf(container)).toEqual(["Версия 1 отправлена"]);
    expect(container.querySelector(".rpt-verdict")?.textContent).toContain("Работа принята");
  });
});

describe("the version number a learner is shown", () => {
  /* Storage numbers count every revision the server ever wrote, autosaves
     included, so a learner who sent two versions can hold numbers 4 and 6.
     Printing those says they sent six. The displayed number is the position
     among the versions actually sent; the storage number stays the key the
     review travels on and never reaches the screen. */
  const stored = (n: number, kind: "initial_submission" | "resubmission", review?: unknown): Rev => ({
    revisionNumber: n, kind, submittedAt: `2026-01-0${(n % 9) + 1}T10:00:00.000Z`,
    ...(review !== undefined ? { review } : {}),
  });

  it("[4] reads as Версия 1", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("pending_review", [draftRev(1), draftRev(2), draftRev(3), stored(4, "initial_submission")])}
      />,
    );
    expect(stagesOf(container)).toEqual(["Версия 1 отправлена"]);
  });

  it("[4, 6] reads as Версия 1 → Версия 2, with the review of 4 between them", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), draftRev(2), draftRev(3),
          stored(4, "initial_submission", rejected("2026-01-04T12:00:00.000Z")),
          draftRev(5),
          stored(6, "resubmission", accepted("2026-01-06T12:00:00.000Z")),
        ], { approvedRevisionNumber: 6 })}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор", "Версия 2 отправлена", "Работа принята",
    ]);
    // The rejection belongs to storage 4 and therefore sits after display V1;
    // the approval belongs to storage 6 and therefore closes display V2.
    const labels = stagesOf(container);
    expect(labels.indexOf("Получен разбор")).toBe(1);
    expect(labels.indexOf("Работа принята")).toBe(3);
  });

  it("[2, 5, 9] reads as Версия 1 → Версия 2 → Версия 3, with no gap drawn", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), stored(2, "initial_submission", rejected("2026-01-03T12:00:00.000Z")),
          draftRev(3), draftRev(4), stored(5, "resubmission", rejected("2026-01-06T12:00:00.000Z")),
          draftRev(6), draftRev(7), draftRev(8),
          stored(9, "resubmission", accepted("2026-01-10T12:00:00.000Z")),
        ], { approvedRevisionNumber: 9 })}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор",
      "Версия 2 отправлена", "Получен разбор",
      "Версия 3 отправлена", "Работа принята",
    ]);
    // Six stages for three versions — the holes at 3, 4, 6, 7, 8 draw nothing.
    expect(container.querySelectorAll(".rpt-arc__item")).toHaveLength(6);
  });

  it("normalises a reordered history before numbering it", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          stored(9, "resubmission", accepted("2026-01-10T12:00:00.000Z")),
          stored(2, "initial_submission", rejected("2026-01-03T12:00:00.000Z")),
          draftRev(1),
          stored(5, "resubmission", rejected("2026-01-06T12:00:00.000Z")),
        ], { approvedRevisionNumber: 9 })}
      />,
    );
    expect(stagesOf(container)).toEqual([
      "Версия 1 отправлена", "Получен разбор",
      "Версия 2 отправлена", "Получен разбор",
      "Версия 3 отправлена", "Работа принята",
    ]);
  });

  it("shows no storage number in the text or the accessibility tree", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("approved", [
          draftRev(1), stored(4, "initial_submission", rejected("2026-01-05T12:00:00.000Z")),
          stored(6, "resubmission", rejected("2026-01-07T12:00:00.000Z")),
          stored(9, "resubmission", accepted("2026-01-10T12:00:00.000Z")),
        ], { approvedRevisionNumber: 9, submittedRevisionNumber: 9 })}
      />,
    );
    const text = container.textContent ?? "";
    const labels = [...container.querySelectorAll("[aria-label]")].map((n) => n.getAttribute("aria-label") ?? "");
    for (const where of [text, ...labels]) {
      for (const raw of ["Версия 4", "Версия 6", "Версия 9", "№4", "№6", "№9", "v4", "v6", "v9"]) {
        expect(where, raw).not.toContain(raw);
      }
    }
    /* A stage row carries no accessible name of its own: its text IS the name,
       so there is no second place a storage number could be smuggled into. */
    expect(container.querySelectorAll(".rpt-arc__item[aria-label]")).toHaveLength(0);
    expect(container.querySelectorAll(".rpt-arc__list [aria-label]")).toHaveLength(0);
    for (const label of labels) {
      expect(label, label).not.toMatch(/\d/);
    }
    expect(stagesOf(container).filter((l) => l?.startsWith("Версия"))).toEqual([
      "Версия 1 отправлена", "Версия 2 отправлена", "Версия 3 отправлена",
    ]);
  });

  it("names the reviewed version the same way the arc does", () => {
    const { container } = render(
      <ReportStatusPanel
        submission={submission("rejected", [
          draftRev(1), draftRev(2), draftRev(3),
          stored(4, "initial_submission", rejected("2026-01-05T12:00:00.000Z")),
        ], {
          submittedRevisionNumber: 4,
          rejection: {
            reasonCode: "detail", reasonTitle: "Нужна конкретика",
            humanComment: "synthetic comment", correctiveAction: "synthetic corrective action",
            reviewedAt: "2026-01-05T12:00:00.000Z",
          },
        })}
      />,
    );
    // One version on screen, one number for it — «Проверялась версия №1».
    expect(container.querySelector(".rpt-feedback__which")?.textContent).toBe("Проверялась версия №1.");
    expect(container.textContent).not.toContain("№4");
  });

  it("leaves the commands and their concurrency guard on the storage number", () => {
    /* The ordinal is presentation and must not have leaked into anything that
       talks to the server: `expectedRevision` and the submit/resubmit wiring
       still carry the server's own revision. */
    const client = src("src/lib/report/report-client.ts");
    const level = src("src/features/report/level-report.tsx");
    /* Counted, not merely present: renaming one of the three command payloads
       would leave the word in the file and change what goes on the wire. */
    expect((client.match(/expectedRevision/g) ?? []).length).toBe(8);
    expect((client.match(/jsonBody: \{ expectedRevision/g) ?? []).length).toBe(3);
    expect(client).not.toMatch(/expectedRevision[A-Za-z]/);
    for (const file of [client, level]) {
      expect(file).not.toContain("displayVersionOf");
      expect(file).not.toContain("sentVersions");
    }
    const panel = src("src/features/report/components/report-status-panel.tsx");
    /* The panel issues no command. Checked by the calls, not by the letters:
       `submittedAt`, `initial_submission` and `resubmission` are field and kind
       names it legitimately reads. */
    expect(panel).not.toContain("expectedRevision");
    for (const call of [/submitReport/, /resubmitReport/, /saveDraft/, /fetch\(/, /\buseState\b/]) {
      expect(panel, String(call)).not.toMatch(call);
    }
  });

  it("gives a draft no version number at all", () => {
    const { container } = render(
      <ReportStatusPanel submission={submission("draft", [draftRev(1), draftRev(2)])} />,
    );
    expect(stagesOf(container)).toEqual([]);
    expect(container.textContent).not.toContain("Версия");
  });
});
