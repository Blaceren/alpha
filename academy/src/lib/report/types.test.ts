import { describe, it, expect } from "vitest";
import { isReportContext, isReportCommandResult, reportContextData } from "@/lib/report/types";
import { buildContext, buildSubmission } from "@/features/report/test-fixtures";

describe("report DTO guards", () => {
  it("accepts a valid available context wrapped in {data}", () => {
    const payload = { data: buildContext("available", null) };
    expect(isReportContext(payload)).toBe(true);
    expect(reportContextData(payload).assignment.fields).toHaveLength(43);
  });

  it("accepts a draft context with a submission", () => {
    expect(isReportContext(buildContext("draft", buildSubmission({ status: "draft" })))).toBe(true);
  });

  it("rejects a stateful kind with no submission", () => {
    const ctx = buildContext("pending_review", null);
    expect(isReportContext(ctx)).toBe(false);
  });

  it("rejects 'available' carrying a submission", () => {
    const ctx = buildContext("available", buildSubmission());
    expect(isReportContext(ctx)).toBe(false);
  });

  it("rejects a field that leaks a reviewer answer key or score", () => {
    const ctx = buildContext("available", null);
    (ctx.assignment.fields[0] as Record<string, unknown>).correctAnswer = { value: true };
    expect(isReportContext(ctx)).toBe(false);
    const ctx2 = buildContext("available", null);
    (ctx2.assignment.fields[0] as Record<string, unknown>).score = 3;
    expect(isReportContext(ctx2)).toBe(false);
  });

  it("accepts an unknown field TYPE at the DTO level (adapter fails it visibly later)", () => {
    const ctx = buildContext("available", null);
    (ctx.assignment.fields[0] as { type: string }).type = "mystery";
    expect(isReportContext(ctx)).toBe(true);
  });

  it("validates a command result", () => {
    const result = {
      data: {
        kind: "saved", created: true, retry: false, acceptedRevision: 1,
        resultingWorkflowVersion: 1, appliedAt: "t", submission: buildSubmission(),
      },
    };
    expect(isReportCommandResult(result)).toBe(true);
    expect(isReportCommandResult({ data: { kind: "nope" } })).toBe(false);
  });
});
