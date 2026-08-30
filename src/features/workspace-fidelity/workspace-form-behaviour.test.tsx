/**
 * WORKSPACE FORM — the three behaviours the seam is most likely to be blamed
 * for, pinned at the seam.
 *
 * The form's own suites already cover the double-save guard, the double-submit
 * guard, the no-network invalid submit, the stale-revision mapping and the
 * retryable/fatal split. They were not touched. What was NOT already pinned is
 * what happens after AUTH LOSS — and the rule that matters there is a negative
 * one: nothing resubmits by itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/report/report-client", () => ({
  fetchReportContext: vi.fn(),
  saveReportDraft: vi.fn(),
  submitReport: vi.fn(),
  resubmitReport: vi.fn(),
  newReportRequestId: vi.fn((p = "save") => `ata-rpt-${p}-fixedkey01`),
}));

import * as client from "@/lib/report/report-client";
import { LevelReport } from "@/features/report/level-report";
import { buildContext, buildSubmission, validValues } from "@/features/report/test-fixtures";

const fetchMock = vi.mocked(client.fetchReportContext);
const submitMock = vi.mocked(client.submitReport);
const saveMock = vi.mocked(client.saveReportDraft);
const resubmitMock = vi.mocked(client.resubmitReport);

const props = { stableCode: "v2.l003.x", locale: "ru", nextLevelCode: null };
const ok = <T,>(data: T) => ({ ok: true as const, data, requestId: null });
const authLost = {
  ok: false as const,
  error: { category: "UNAUTHENTICATED", status: 401, code: null, messageKey: "x", requestId: null, retryable: false },
};

/* A server-side draft that is already valid — the same way the form's own suite
   reaches a submittable state, rather than typing 43 fields. */
const validDraft = () =>
  ok(buildContext("draft", buildSubmission({ status: "draft", workflowVersion: 1, fieldValues: validValues() })));

beforeEach(() => {
  refresh.mockClear();
  for (const m of [fetchMock, submitMock, saveMock, resubmitMock]) m.mockReset();
});

describe("Workspace form — auth loss never resubmits by itself", () => {
  it("makes exactly one write, then stops, and never retries on its own", async () => {
    fetchMock.mockResolvedValue(validDraft());
    submitMock.mockResolvedValue(authLost as never);

    render(<LevelReport {...props} />);
    const submit = await screen.findByRole("button", { name: /Отправить на проверку/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const callsAfterLoss = submitMock.mock.calls.length;

    /* Nothing may fire a second write on its own — no timer, no effect, no
       recovery path that re-sends what the server refused. */
    await new Promise((r) => setTimeout(r, 250));
    expect(submitMock).toHaveBeenCalledTimes(callsAfterLoss);
    expect(resubmitMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
    /* And it does not silently reload the page's authority either. */
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers a RE-READ after auth loss, never a resubmit", async () => {
    fetchMock.mockResolvedValue(validDraft());
    submitMock.mockResolvedValue(authLost as never);

    const { container } = render(<LevelReport {...props} />);
    const submit = await screen.findByRole("button", { name: /Отправить на проверку/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await waitFor(() => expect(submitMock).toHaveBeenCalled());

    /* The surface replaces itself with a bounded notice. What matters is what it
       offers next: a way to read the state again, and NO way to send the same
       work a second time without the learner deciding to. */
    await waitFor(() => expect(container.querySelector(".rpt__notice")).not.toBeNull());
    expect(screen.queryByRole("button", { name: /Отправить/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Отправить исправление/ })).toBeNull();
    const recover = screen.getByRole("button", { name: /Повторить|Обновить/ });
    expect(recover).toBeTruthy();

    /* And pressing it re-reads. It does not re-send. */
    const readsBefore = fetchMock.mock.calls.length;
    await userEvent.click(recover);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(resubmitMock).not.toHaveBeenCalled();
  });

  it("never renders a second live region, in any state the seam can reach", async () => {
    /* The seam added a presentation class to the status paragraph. It must not
       have produced a second copy authority anywhere. */
    const cases: Array<() => void> = [
      () => { fetchMock.mockResolvedValue(validDraft()); },
      () => { fetchMock.mockResolvedValue(ok(buildContext("available", null))); },
      () => { fetchMock.mockResolvedValue(ok(buildContext("pending_review", buildSubmission({ status: "pending_review", submittedRevisionNumber: 1 })))); },
      () => { fetchMock.mockResolvedValue(ok(buildContext("approved", buildSubmission({ status: "approved", approvedRevisionNumber: 1 })))); },
    ];
    for (const setUp of cases) {
      fetchMock.mockReset();
      setUp();
      const { container, unmount } = render(<LevelReport {...props} />);
      await waitFor(() => expect(container.querySelector(".rpt")).not.toBeNull());
      const polite = container.querySelectorAll('[role="status"][aria-live="polite"]');
      expect(polite.length).toBeLessThanOrEqual(1);
      for (const el of Array.from(polite)) {
        expect(el.className).toContain("rpt__status");
        expect(el.className).toContain("rpt-bar__state");
      }
      unmount();
    }
  });
});
