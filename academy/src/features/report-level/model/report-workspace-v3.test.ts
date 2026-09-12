import { describe, expect, it } from "vitest";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import {
  createEmptyDraft,
  parseReportWorkspace,
  withDraft,
  emptyReportWorkspace,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";
import {
  parseReportWorkspaceV2,
  migrateV1Workspace,
  serializeReportWorkspaceV2,
} from "@/features/report-level/model/report-workspace-v2";
import {
  entryFieldSectionId,
  summarySectionId,
} from "@/features/report-level/model/report-review";
import {
  REPORT_STORAGE_VERSION_V3,
  canResubmitV3,
  createEmptyDraftV3,
  getStoredDraftV3,
  migrateV2WorkspaceToV3,
  parseReportWorkspaceV3,
  readReportWorkspaceV3,
  serializeReportWorkspaceV3,
  withApproved,
  withDraftV3,
  withEntryFieldV3,
  withResubmittedV3,
  withRevisionRequestedV3,
  withSubmittedV3,
  withSummaryV3,
  type ReportDraftV3,
} from "@/features/report-level/model/report-workspace-v3";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;
const resolve = getReportDefinition;

const SECTION_ENTRY_3 = entryFieldSectionId(REPORT_LEVEL_NUMBER, 3, "noticed");
const SECTION_SUMMARY = summarySectionId(REPORT_LEVEL_NUMBER);
const APPROVED_AT = "2026-07-18T12:00:00.000Z";
const SUBMITTED_AT = "2026-07-17T10:00:00.000Z";

/* ------------------------------------------------------------------ *
 * Builders — through the model's own transitions where possible
 * ------------------------------------------------------------------ */

function readyDraftV3(): ReportDraftV3 {
  let draft = createEmptyDraftV3(definition);
  for (const entry of draft.entries) {
    draft = withEntryFieldV3(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummaryV3(draft, "итог по пяти записям");
}

function pendingDraftV3(): ReportDraftV3 {
  return withSubmittedV3(readyDraftV3(), SUBMITTED_AT);
}

function approvedDraftV3(): ReportDraftV3 {
  return withApproved(pendingDraftV3(), APPROVED_AT);
}

/** A raw stored v3 payload, built from a full valid approved record then patched. */
function rawApproved(overrides: Record<string, unknown> = {}): string {
  const draft = approvedDraftV3();
  return JSON.stringify({
    version: 3,
    reports: [
      {
        levelCode: "level.003",
        entries: draft.entries.map((e) => ({
          id: e.id,
          ordinal: e.ordinal,
          when: e.when,
          decided: e.decided,
          noticed: e.noticed,
        })),
        summary: draft.summary,
        status: "approved",
        submittedAt: SUBMITTED_AT,
        revision: draft.revision,
        meaningfulRevision: draft.meaningfulRevision,
        review: null,
        approvedAt: APPROVED_AT,
        ...overrides,
      },
    ],
  });
}

const readStored = (raw: string) => getStoredDraftV3(parseReportWorkspaceV3(raw, resolve), 3);

/* ================================================================== *
 * The approved lifecycle transition
 * ================================================================== */

describe("withApproved — the terminal verdict (DD-297)", () => {
  it("moves pending-review → approved and stamps approvedAt", () => {
    const approved = withApproved(pendingDraftV3(), APPROVED_AT);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(APPROVED_AT);
  });

  it("refuses to approve a draft or a revision-requested (no-op)", () => {
    const draft = readyDraftV3();
    expect(withApproved(draft, APPROVED_AT)).toBe(draft);

    const revision = withRevisionRequestedV3(pendingDraftV3(), definition, {
      comment: "нужна доработка",
      sections: [SECTION_ENTRY_3],
      receivedAt: "2026-07-18T09:00:00.000Z",
    });
    expect(withApproved(revision, APPROVED_AT)).toBe(revision);
  });

  it("refuses to approve an unfinished report", () => {
    // A pending record can only exist ready; but guard the rule directly.
    const half = withSummaryV3(readyDraftV3(), "");
    expect(withApproved(half, APPROVED_AT)).toBe(half);
  });

  it("preserves an existing review as history when approving", () => {
    // Resubmitted pending-review carries its last review — approval keeps it.
    let revision = withRevisionRequestedV3(pendingDraftV3(), definition, {
      comment: "уточните условие",
      sections: [SECTION_ENTRY_3],
      receivedAt: "2026-07-18T09:00:00.000Z",
    });
    revision = withEntryFieldV3(revision, 3, "noticed", "наблюдение 3 — условие записано");
    const resubmitted = withResubmittedV3(revision, "2026-07-18T11:00:00.000Z");
    expect(resubmitted.status).toBe("pending-review");
    const approved = withApproved(resubmitted, APPROVED_AT);
    expect(approved.status).toBe("approved");
    expect(approved.review?.comment).toBe("уточните условие");
  });
});

describe("approved is terminal / read-only by construction (DD-297)", () => {
  const approved = approvedDraftV3();

  it("withEntryField/withSummary return the SAME object", () => {
    expect(withEntryFieldV3(approved, 1, "noticed", "изменение")).toBe(approved);
    expect(withSummaryV3(approved, "другой итог")).toBe(approved);
  });

  it("cannot be resubmitted, re-approved, or re-verdicted", () => {
    expect(canResubmitV3(approved)).toBe(false);
    expect(withResubmittedV3(approved, "2026-07-19T00:00:00.000Z")).toBe(approved);
    expect(withApproved(approved, "2026-07-19T00:00:00.000Z")).toBe(approved);
    expect(
      withRevisionRequestedV3(approved, definition, {
        comment: "поздно",
        sections: [],
        receivedAt: "2026-07-19T00:00:00.000Z",
      }),
    ).toBe(approved);
  });
});

/* ================================================================== *
 * Approved normalisation — fail closed, keep the work (DD-296, §13)
 * ================================================================== */

describe("approved normalisation — the invalid cases", () => {
  it("15. a fully valid approved v3 record round-trips", () => {
    const draft = readStored(rawApproved())!;
    expect(draft.status).toBe("approved");
    expect(draft.approvedAt).toBe(APPROVED_AT);
    expect(draft.summary).toBe("итог по пяти записям");
  });

  it("1. approved WITHOUT submittedAt → draft, work kept, no approval", () => {
    const draft = readStored(rawApproved({ submittedAt: null }))!;
    expect(draft.status).toBe("draft");
    expect(draft.approvedAt).toBeNull();
    // The user's work survives.
    expect(draft.entries[0]!.noticed).toBe("наблюдение 1");
    expect(draft.summary).toBe("итог по пяти записям");
  });

  it("2. approved with INVALID approvedAt → pending-review, work AND review kept", () => {
    const draft = readStored(
      rawApproved({
        approvedAt: "not-a-timestamp",
        review: {
          comment: "последняя проверка",
          sections: [SECTION_SUMMARY],
          receivedAt: "2026-07-18T09:00:00.000Z",
          atRevision: 6,
        },
      }),
    )!;
    expect(draft.status).toBe("pending-review");
    expect(draft.approvedAt).toBeNull();
    expect(draft.review?.comment).toBe("последняя проверка");
    expect(draft.summary).toBe("итог по пяти записям");
  });

  it("2b. approved with MISSING approvedAt → pending-review", () => {
    const draft = readStored(rawApproved({ approvedAt: undefined }))!;
    expect(draft.status).toBe("pending-review");
  });

  it("3. approved but INCOMPLETE report → draft, no progression", () => {
    // Blank the required field of entry 1.
    const raw = rawApproved();
    const parsed = JSON.parse(raw);
    parsed.reports[0].entries[0].noticed = "";
    const draft = readStored(JSON.stringify(parsed))!;
    expect(draft.status).toBe("draft");
    expect(draft.approvedAt).toBeNull();
  });

  it("4. approved with UNKNOWN review section ids → drops only the unknown ids", () => {
    const draft = readStored(
      rawApproved({
        review: {
          comment: "смешанные секции",
          sections: [SECTION_ENTRY_3, "report.003.entry.99.noticed", "totally.made.up"],
          receivedAt: "2026-07-18T09:00:00.000Z",
          atRevision: 6,
        },
      }),
    )!;
    expect(draft.status).toBe("approved");
    expect(draft.review?.sections).toEqual([SECTION_ENTRY_3]);
  });

  it("11/12/13. an unknown or forged status is refused outright", () => {
    for (const status of ["auto-approved", "mentor-approved", "rejected", "approved-by-ai"]) {
      const draft = readStored(rawApproved({ status }));
      expect(draft).toBeNull();
    }
  });

  it("5. approved on a NON-report level cannot resolve a definition → dropped", () => {
    const raw = JSON.stringify({
      version: 3,
      reports: [
        {
          levelCode: "level.018",
          entries: [],
          summary: "x",
          status: "approved",
          submittedAt: SUBMITTED_AT,
          revision: 1,
          meaningfulRevision: 1,
          review: null,
          approvedAt: APPROVED_AT,
        },
      ],
    });
    expect(getStoredDraftV3(parseReportWorkspaceV3(raw, resolve), 18)).toBeNull();
  });

  it("17. valid user text is preserved even when the approval metadata is broken", () => {
    const draft = readStored(rawApproved({ approvedAt: 42, submittedAt: null }))!;
    // Missing submit dominates → draft; but the five observations survive.
    expect(draft.status).toBe("draft");
    for (let i = 0; i < 5; i += 1) {
      expect(draft.entries[i]!.noticed).toBe(`наблюдение ${i + 1}`);
    }
  });
});

/* ================================================================== *
 * Migration v1/v2 → v3 and read precedence (DD-296, §13)
 * ================================================================== */

describe("v3 read precedence and migration", () => {
  const readyV1: ReportDraft = (() => {
    const d = createEmptyDraft(definition);
    return {
      ...d,
      entries: d.entries.map((e) => ({ ...e, noticed: `v1 наблюдение ${e.ordinal}` })),
      summary: "v1 итог",
    };
  })();

  const rawV1 = JSON.stringify(withDraft(emptyReportWorkspace(), readyV1));
  const rawV2 = serializeReportWorkspaceV2(migrateV1Workspace(withDraft(emptyReportWorkspace(), readyV1)));

  it("14/16. corrupt v3 fails closed and does NOT fall back to valid v2/v1", () => {
    const state = readReportWorkspaceV3("{{{ not json", rawV2, rawV1, resolve);
    expect(state.reports).toEqual([]);
  });

  it("15. a valid v3 wins over an existing v2 and v1", () => {
    const state = readReportWorkspaceV3(rawApproved(), rawV2, rawV1, resolve);
    expect(getStoredDraftV3(state, 3)?.status).toBe("approved");
  });

  it("2. with no v3, a valid v2 is lifted verbatim with approvedAt = null", () => {
    const state = readReportWorkspaceV3(null, rawV2, rawV1, resolve);
    const draft = getStoredDraftV3(state, 3)!;
    expect(draft.summary).toBe("v1 итог");
    expect(draft.approvedAt).toBeNull();
    expect(draft.status).toBe("draft");
  });

  it("3. with no v3 and no v2, a valid v1 is lifted through v1→v2→v3", () => {
    const state = readReportWorkspaceV3(null, null, rawV1, resolve);
    const draft = getStoredDraftV3(state, 3)!;
    expect(draft.entries[0]!.noticed).toBe("v1 наблюдение 1");
    expect(draft.approvedAt).toBeNull();
  });

  it("a forged v2-KEY approved is still refused by the untouched v2 parser", () => {
    // The v2 parser has never known "approved"; migrating it drops the record.
    const forgedV2 = JSON.stringify({
      version: 2,
      reports: [{ ...JSON.parse(rawApproved()).reports[0] }],
    });
    // parse through the real v2 parser then lift.
    const lifted = migrateV2WorkspaceToV3(parseReportWorkspaceV2(forgedV2, resolve));
    expect(lifted.reports).toEqual([]);
  });

  it("migrateV2WorkspaceToV3 sets version 3 and approvedAt null on every record", () => {
    const v2 = parseReportWorkspaceV2(rawV2, resolve);
    const v3 = migrateV2WorkspaceToV3(v2);
    expect(v3.version).toBe(REPORT_STORAGE_VERSION_V3);
    expect(v3.reports.every((r) => r.approvedAt === null)).toBe(true);
  });
});

/* ================================================================== *
 * Serialisation round-trip
 * ================================================================== */

describe("serialisation", () => {
  it("round-trips an approved record through serialize → parse", () => {
    const state = withDraftV3(
      { version: 3, reports: [] },
      approvedDraftV3(),
    );
    const reread = parseReportWorkspaceV3(serializeReportWorkspaceV3(state), resolve);
    const draft = getStoredDraftV3(reread, 3)!;
    expect(draft.status).toBe("approved");
    expect(draft.approvedAt).toBe(APPROVED_AT);
  });

  it("a v1-shaped writable record serialises with v3 defaults", () => {
    const v1Draft = createEmptyDraft(definition);
    const raw = serializeReportWorkspaceV3({ version: 3, reports: [v1Draft] });
    expect(raw).toContain('"approvedAt":null');
    expect(raw).toContain('"version":3');
  });

  it("the v1 parser is untouched — it still refuses an approved status", () => {
    const forged = JSON.stringify({
      version: 1,
      reports: [{ ...JSON.parse(rawApproved()).reports[0] }],
    });
    expect(parseReportWorkspace(forged, resolve).reports).toEqual([]);
  });
});
