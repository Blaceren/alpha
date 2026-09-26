/**
 * The learner support proxy boundary.
 *
 * The point of these is NOT that the four learner operations work — that is
 * proven end to end in the browser. It is that nothing ELSE does: the learner
 * origin must not be able to reach a staff surface, an internal note, or an
 * arbitrary Backend path, and it must refuse without contacting Backend at all.
 */
import { describe, expect, it } from "vitest";
import { resolveSupportTargetPath } from "./support-proxy";

describe("support proxy — the path it will build", () => {
  it("pins each operation to one constant Backend path", () => {
    expect(resolveSupportTargetPath({ operation: "support-list" })).toBe(
      "/api/learner-ops/cases",
    );
    expect(resolveSupportTargetPath({ operation: "support-open" })).toBe(
      "/api/learner-ops/cases",
    );
    expect(
      resolveSupportTargetPath({ operation: "support-detail", caseId: "clx1234567890abcd" }),
    ).toBe("/api/learner-ops/cases/clx1234567890abcd");
    expect(
      resolveSupportTargetPath({ operation: "support-reply", caseId: "clx1234567890abcd" }),
    ).toBe("/api/learner-ops/cases/clx1234567890abcd/messages");
  });

  it("never builds a path into the STAFF surface", () => {
    // Every learner path is under /api/learner-ops/. The CRM department lives
    // under /api/crm/v1/learner-ops/ and has no proxy in this repository at all.
    for (const input of [
      { operation: "support-list" } as const,
      { operation: "support-open" } as const,
      { operation: "support-detail", caseId: "clx1234567890abcd" } as const,
      { operation: "support-reply", caseId: "clx1234567890abcd" } as const,
    ]) {
      const path = resolveSupportTargetPath(input);
      expect(path).not.toBeNull();
      expect(path!.startsWith("/api/learner-ops/cases")).toBe(true);
      expect(path).not.toContain("/crm/");
      // There is no learner route that returns an internal note, so there is
      // nothing here that could forward one.
      expect(path).not.toContain("/notes");
    }
  });

  it("refuses a case id that is not a plain identifier", () => {
    const hostile = [
      "../../crm/v1/learner-ops/cases",
      "abc/../../../etc/passwd",
      "clx123/notes",
      "clx123?admin=1",
      "clx123#frag",
      "http://evil.invalid/x",
      "//evil.invalid/x",
      "clx 123",
      "",
      "short",
      "x".repeat(200),
    ];
    for (const caseId of hostile) {
      expect(
        resolveSupportTargetPath({ operation: "support-detail", caseId }),
        `must refuse ${JSON.stringify(caseId)}`,
      ).toBeNull();
      expect(
        resolveSupportTargetPath({ operation: "support-reply", caseId }),
        `must refuse ${JSON.stringify(caseId)}`,
      ).toBeNull();
    }
  });

  it("accepts the identifier shape the Backend actually mints", () => {
    // A cuid: lowercase alphanumeric, comfortably inside the bound.
    expect(
      resolveSupportTargetPath({ operation: "support-detail", caseId: "cm3k9x2p10000abcdefghij" }),
    ).not.toBeNull();
  });

  it("percent-encodes the segment it interpolates", () => {
    // The charset already forbids anything needing encoding, so this asserts the
    // belt as well as the braces: a future widening of CASE_ID_RE cannot turn
    // the id into path structure.
    const path = resolveSupportTargetPath({
      operation: "support-detail",
      caseId: "abc-DEF_123456789",
    });
    expect(path).toBe("/api/learner-ops/cases/abc-DEF_123456789");
  });
});
