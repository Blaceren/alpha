import { beforeEach, describe, expect, it } from "vitest";
import {
  getReportDefinition,
  REPORT_LEVEL_NUMBER,
} from "@/features/report-level/data/report-fixtures";
import {
  REPORT_STORAGE_KEY,
  createEmptyDraft,
  emptyReportWorkspace,
  serializeReportWorkspace,
  withDraft,
  withEntryField,
  withSubmitted,
  withSummary,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";
import {
  REPORT_STORAGE_KEY_V2,
  canResubmit,
  createEmptyDraftV2,
  emptyReportWorkspaceV2,
  getStoredDraftV2,
  hasChangeSinceReview,
  migrateV1Workspace,
  normalizeFieldValue,
  parseReportWorkspaceV2,
  readReportWorkspaceV2,
  serializeReportWorkspaceV2,
  withDraftV2,
  withEntryFieldV2,
  withResubmitted,
  withRevisionRequested,
  withSubmittedV2,
  withSummaryV2,
  type ReportDraftV2,
} from "@/features/report-level/model/report-workspace-v2";
import {
  REPORT_STORAGE_KEY_V3,
  getStoredDraftV3,
} from "@/features/report-level/model/report-workspace-v3";
import {
  entryFieldSectionId,
  summarySectionId,
} from "@/features/report-level/model/report-review";
import { createReportStore } from "@/features/report-level/model/report-store";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;
const resolve = getReportDefinition;

const SECTION_ENTRY_3 = entryFieldSectionId(3, 3, "noticed");
const SECTION_SUMMARY = summarySectionId(3);

/** A ready v1 draft, built through the real v1 mutators. */
function readyV1Draft(): ReportDraft {
  let draft = createEmptyDraft(definition);
  for (const entry of draft.entries) {
    draft = withEntryField(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummary(draft, "итог по пяти записям");
}

/** A ready v2 draft, built through the real v2 mutators. */
function readyV2Draft(): ReportDraftV2 {
  let draft = createEmptyDraftV2(definition);
  for (const entry of draft.entries) {
    draft = withEntryFieldV2(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummaryV2(draft, "итог по пяти записям");
}

/** A report sitting under a verdict, the way the adapter would leave it. */
function revisionDraft(): ReportDraftV2 {
  const pending = withSubmittedV2(readyV2Draft(), "2026-07-17T10:00:00.000Z");
  return withRevisionRequested(pending, definition, {
    comment: "Уточните условие и свяжите итог со всеми записями.",
    sections: [SECTION_ENTRY_3, SECTION_SUMMARY],
    receivedAt: "2026-07-18T09:00:00.000Z",
  });
}

const rawV1 = (draft: ReportDraft) =>
  serializeReportWorkspace(withDraft(emptyReportWorkspace(), draft));
const rawV2 = (draft: ReportDraftV2) =>
  serializeReportWorkspaceV2(withDraftV2(emptyReportWorkspaceV2(), draft));

/* ================================================================== *
 * Migration v1 → v2 (DD-285)
 * ================================================================== */

describe("v1 → v2 migration", () => {
  it("carries a valid v1 draft into a v2 draft with review = null", () => {
    const v1 = withEntryField(createEmptyDraft(definition), 2, "noticed", "вторая");
    const state = readReportWorkspaceV2(null, rawV1(v1), resolve);
    const migrated = getStoredDraftV2(state, 3)!;

    expect(migrated.status).toBe("draft");
    expect(migrated.review).toBeNull();
  });

  it("carries a valid v1 pending-review into v2 pending-review", () => {
    const v1 = withSubmitted(readyV1Draft(), "2026-07-17T10:00:00.000Z");
    const migrated = getStoredDraftV2(readReportWorkspaceV2(null, rawV1(v1), resolve), 3)!;

    expect(migrated.status).toBe("pending-review");
    expect(migrated.review).toBeNull();
  });

  it("preserves every entry value, the summary, submittedAt and revision verbatim", () => {
    let v1 = readyV1Draft();
    v1 = withEntryField(v1, 2, "when", "среда");
    v1 = withEntryField(v1, 4, "decided", "отказался от входа");
    const submitted = withSubmitted(v1, "2026-07-17T10:00:00.000Z");

    const migrated = getStoredDraftV2(readReportWorkspaceV2(null, rawV1(submitted), resolve), 3)!;

    expect(migrated.entries.map((e) => e.noticed)).toEqual(submitted.entries.map((e) => e.noticed));
    expect(migrated.entries[1]!.when).toBe("среда");
    expect(migrated.entries[3]!.decided).toBe("отказался от входа");
    expect(migrated.summary).toBe(submitted.summary);
    expect(migrated.submittedAt).toBe("2026-07-17T10:00:00.000Z");
    expect(migrated.revision).toBe(submitted.revision);
  });

  it("a present valid v2 wins over v1", () => {
    const v1 = withEntryField(createEmptyDraft(definition), 1, "noticed", "старый v1");
    const v2 = withEntryFieldV2(createEmptyDraftV2(definition), 1, "noticed", "новый v2");

    const state = readReportWorkspaceV2(rawV2(v2), rawV1(v1), resolve);
    expect(getStoredDraftV2(state, 3)!.entries[0]!.noticed).toBe("новый v2");
  });

  it("a corrupt v2 fails closed and does NOT silently fall back to v1", () => {
    const v1 = withEntryField(createEmptyDraft(definition), 1, "noticed", "валидный v1");
    const state = readReportWorkspaceV2("{{{ not json", rawV1(v1), resolve);
    expect(state.reports).toEqual([]);
  });

  it("a corrupt v1 never creates a v2 record", () => {
    expect(readReportWorkspaceV2(null, "{{{ not json", resolve).reports).toEqual([]);
    expect(readReportWorkspaceV2(null, '{"version":1,"reports":"junk"}', resolve).reports).toEqual(
      [],
    );
  });

  it("is idempotent — migrating twice yields the same state", () => {
    const raw = rawV1(withSubmitted(readyV1Draft(), "2026-07-17T10:00:00.000Z"));
    const once = readReportWorkspaceV2(null, raw, resolve);
    const twice = readReportWorkspaceV2(null, raw, resolve);
    expect(serializeReportWorkspaceV2(once)).toBe(serializeReportWorkspaceV2(twice));
  });

  it("migrateV1Workspace defaults meaningfulRevision to the technical revision", () => {
    const v1 = withEntryField(createEmptyDraft(definition), 1, "noticed", "текст");
    const migrated = migrateV1Workspace(withDraft(emptyReportWorkspace(), v1));
    expect(migrated.reports[0]!.meaningfulRevision).toBe(v1.revision);
  });
});

describe("store-level migration behaviour", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads a legacy v1 value when no v2/v3 exists — and leaves v1 on disk", () => {
    window.localStorage.setItem(REPORT_STORAGE_KEY, rawV1(readyV1Draft()));

    // The store now lifts v1 → v2 → v3 on read (DD-296); the v2 record round-trips.
    const read = getStoredDraftV3(createReportStore().read(), 3);
    expect(read?.summary).toBe("итог по пяти записям");
    // The v1 key is NEVER deleted by reading (DD-285/DD-296).
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY)).not.toBeNull();
    // Reading alone writes nothing — no v2 and no v3 key appears.
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V2)).toBeNull();
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V3)).toBeNull();
  });

  it("writing lands in v3 and does not delete v1", () => {
    window.localStorage.setItem(REPORT_STORAGE_KEY, rawV1(readyV1Draft()));
    const store = createReportStore();
    store.write(withDraftV2(emptyReportWorkspaceV2(), readyV2Draft()));

    // Since D3-D writes go to v3 only; the v1 (and any v2) key are left untouched.
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V3)).not.toBeNull();
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V2)).toBeNull();
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY)).not.toBeNull();
  });

  it("clear() removes only the v3 key — deleting legacy data is not our call", () => {
    window.localStorage.setItem(REPORT_STORAGE_KEY, rawV1(readyV1Draft()));
    const store = createReportStore();
    store.write(withDraftV2(emptyReportWorkspaceV2(), readyV2Draft()));
    store.clear();

    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V3)).toBeNull();
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY)).not.toBeNull();
  });

  it("migration never touches ata.lesson-progress.v1", () => {
    window.localStorage.setItem(REPORT_STORAGE_KEY, rawV1(readyV1Draft()));
    createReportStore().read();
    createReportStore().write(withDraftV2(emptyReportWorkspaceV2(), readyV2Draft()));
    expect(window.localStorage.getItem("ata.lesson-progress.v1")).toBeNull();
    expect(window.sessionStorage.getItem("ata.lesson-progress.v1")).toBeNull();
  });
});

/* ================================================================== *
 * v2 schema validation — fail closed
 * ================================================================== */

describe("v2 parsing", () => {
  it("round-trips a revision-requested record with its review intact", () => {
    const draft = revisionDraft();
    const reread = getStoredDraftV2(parseReportWorkspaceV2(rawV2(draft), resolve), 3)!;

    expect(reread.status).toBe("revision-requested");
    expect(reread.review?.comment).toBe("Уточните условие и свяжите итог со всеми записями.");
    expect(reread.review?.sections).toEqual([SECTION_ENTRY_3, SECTION_SUMMARY]);
    expect(reread.review?.atRevision).toBe(draft.review!.atRevision);
  });

  it("drops a record carrying a forged verdict — approved/rejected can never be faked", () => {
    for (const status of ["approved", "rejected", "resubmitted", "", null, 7]) {
      const raw = JSON.stringify({
        version: 2,
        reports: [{ levelCode: "level.003", entries: [], summary: "", status, revision: 1 }],
      });
      expect(parseReportWorkspaceV2(raw, resolve).reports).toEqual([]);
    }
  });

  it("drops an unknown or forged section id ALONE — never the user's work", () => {
    const draft = revisionDraft();
    const tampered = JSON.parse(rawV2(draft)) as {
      reports: Array<{ review: { sections: unknown[] } }>;
    };
    tampered.reports[0]!.review.sections = [
      SECTION_ENTRY_3,
      "report.099.entry.1.noticed", // no such report
      "balance.total", // hostile
      42, // not even a string
      SECTION_SUMMARY,
    ];

    const reread = getStoredDraftV2(
      parseReportWorkspaceV2(JSON.stringify(tampered), resolve),
      3,
    )!;
    expect(reread.status).toBe("revision-requested");
    expect(reread.review?.sections).toEqual([SECTION_ENTRY_3, SECTION_SUMMARY]);
  });

  it("a revision-requested record with an unusable review keeps the WORK, not the verdict", () => {
    const draft = revisionDraft();
    const tampered = JSON.parse(rawV2(draft)) as { reports: Array<{ review: unknown }> };
    tampered.reports[0]!.review = { comment: "", sections: [], receivedAt: null };

    const reread = getStoredDraftV2(
      parseReportWorkspaceV2(JSON.stringify(tampered), resolve),
      3,
    )!;
    // Downgraded to the last trustworthy stored state; entries survive.
    expect(reread.status).toBe("pending-review");
    expect(reread.review).toBeNull();
    expect(reread.entries.every((e) => e.noticed.length > 0)).toBe(true);
  });

  it("a review attached to a draft record is dropped — a verdict cannot precede a submit", () => {
    const raw = JSON.stringify({
      version: 2,
      reports: [
        {
          levelCode: "level.003",
          entries: [],
          summary: "",
          status: "draft",
          revision: 0,
          review: {
            comment: "поддельный вердикт",
            sections: [],
            receivedAt: "2026-01-01",
            atRevision: 0,
          },
        },
      ],
    });
    const reread = getStoredDraftV2(parseReportWorkspaceV2(raw, resolve), 3)!;
    expect(reread.status).toBe("draft");
    expect(reread.review).toBeNull();
  });

  it("keeps the review on a pending record — the resubmitted iteration's history", () => {
    const resubmitted = withResubmitted(
      withSummaryV2(revisionDraft(), "новый связанный итог"),
      "2026-07-19T09:00:00.000Z",
    );
    expect(resubmitted.status).toBe("pending-review");

    const reread = getStoredDraftV2(parseReportWorkspaceV2(rawV2(resubmitted), resolve), 3)!;
    expect(reread.status).toBe("pending-review");
    expect(reread.review?.comment).toContain("Уточните условие");
  });

  it("unknown fields do not survive the round trip", () => {
    const draft = revisionDraft();
    const tampered = JSON.parse(rawV2(draft)) as { reports: Array<Record<string, unknown>> };
    tampered.reports[0]!.balance = 100500;
    tampered.reports[0]!.xp = 9000;

    const round = serializeReportWorkspaceV2(
      parseReportWorkspaceV2(JSON.stringify(tampered), resolve),
    );
    expect(round).not.toContain("balance");
    expect(round).not.toContain("xp");
  });

  it("never stores financial values, scenario keys or verdict fabrications", () => {
    const payload = rawV2(withResubmitted(withSummaryV2(revisionDraft(), "итог 2"), "2026-07-19"));
    for (const forbidden of ["scenario", "verdict=", "approved", "balance", "deposit", "$"]) {
      expect(payload).not.toContain(forbidden);
    }
  });
});

/* ================================================================== *
 * Meaningful change and the resubmit rule (scope §2, DD-287)
 * ================================================================== */

describe("meaningful revision", () => {
  it("normalises whitespace: trim + collapse", () => {
    expect(normalizeFieldValue("  а   б\n\nв  ")).toBe("а б в");
  });

  it("a content edit after the verdict bumps meaningfulRevision and unlocks resubmit", () => {
    const draft = revisionDraft();
    expect(hasChangeSinceReview(draft)).toBe(false);
    expect(canResubmit(draft)).toBe(false);

    const edited = withEntryFieldV2(draft, 3, "noticed", "наблюдение 3 — дополнено условием");
    expect(edited.meaningfulRevision).toBe(draft.meaningfulRevision + 1);
    expect(hasChangeSinceReview(edited)).toBe(true);
    expect(canResubmit(edited)).toBe(true);
  });

  it("a whitespace-only edit autosaves (revision bumps) but does not count as change", () => {
    const draft = revisionDraft();
    const spaced = withEntryFieldV2(draft, 3, "noticed", `${draft.entries[2]!.noticed}   `);

    expect(spaced.revision).toBe(draft.revision + 1); // the autosave key moved
    expect(spaced.meaningfulRevision).toBe(draft.meaningfulRevision); // the rule did not
    expect(canResubmit(spaced)).toBe(false);
  });

  it("ready-to-resubmit requires the readiness rule, not just a change", () => {
    const draft = revisionDraft();
    const emptied = withEntryFieldV2(draft, 3, "noticed", "");
    expect(hasChangeSinceReview(emptied)).toBe(true);
    expect(canResubmit(emptied)).toBe(false); // entry 3 no longer filled
  });

  it("ready-to-resubmit requires a change AFTER review.atRevision", () => {
    const draft = revisionDraft();
    // Ready (all filled + summary) but nothing touched since the verdict.
    expect(canResubmit(draft)).toBe(false);
  });

  it("flagged sections are guidance, not a validator: an UNMARKED field unlocks too", () => {
    const draft = revisionDraft();
    // Entry 1 is not flagged — the change still counts (DD-287).
    const edited = withEntryFieldV2(draft, 1, "noticed", "наблюдение 1 — дополнено");
    expect(canResubmit(edited)).toBe(true);
  });

  it("summary edits count as meaningful change too", () => {
    const edited = withSummaryV2(revisionDraft(), "итог, связанный со всеми пятью записями");
    expect(canResubmit(edited)).toBe(true);
  });
});

/* ================================================================== *
 * Transitions
 * ================================================================== */

describe("verdict and resubmit transitions", () => {
  it("withRevisionRequested only applies to a pending report", () => {
    const draft = readyV2Draft(); // still a draft
    const unchanged = withRevisionRequested(draft, definition, {
      comment: "x",
      sections: [],
      receivedAt: "2026-01-01",
    });
    expect(unchanged).toBe(draft);
  });

  it("withRevisionRequested pins atRevision to the meaningful counter", () => {
    const pending = withSubmittedV2(readyV2Draft(), "2026-07-17T10:00:00.000Z");
    const revised = withRevisionRequested(pending, definition, {
      comment: "к",
      sections: [SECTION_SUMMARY],
      receivedAt: "2026-07-18",
    });
    expect(revised.review?.atRevision).toBe(pending.meaningfulRevision);
  });

  it("withRevisionRequested filters unknown sections and refuses an empty comment", () => {
    const pending = withSubmittedV2(readyV2Draft(), "2026-07-17T10:00:00.000Z");
    const revised = withRevisionRequested(pending, definition, {
      comment: "к",
      sections: [SECTION_ENTRY_3, "report.099.summary", SECTION_ENTRY_3],
      receivedAt: "2026-07-18",
    });
    expect(revised.review?.sections).toEqual([SECTION_ENTRY_3]);

    const refused = withRevisionRequested(pending, definition, {
      comment: "   ",
      sections: [SECTION_ENTRY_3],
      receivedAt: "2026-07-18",
    });
    expect(refused).toBe(pending);
  });

  it("resubmit returns to pending-review, updates submittedAt and PRESERVES the review", () => {
    const edited = withSummaryV2(revisionDraft(), "новый итог, связанный с записями");
    const resubmitted = withResubmitted(edited, "2026-07-19T12:00:00.000Z");

    expect(resubmitted.status).toBe("pending-review");
    expect(resubmitted.submittedAt).toBe("2026-07-19T12:00:00.000Z");
    expect(resubmitted.review).not.toBeNull();
    expect(resubmitted.review!.comment).toContain("Уточните условие");
  });

  it("resubmit is refused while the rule is not satisfied", () => {
    const draft = revisionDraft();
    expect(withResubmitted(draft, "2026-07-19")).toBe(draft); // no change yet

    const notReady = withEntryFieldV2(draft, 3, "noticed", "");
    expect(withResubmitted(notReady, "2026-07-19")).toBe(notReady); // not ready
  });

  it("fields stay editable under revision-requested and lock again after resubmit", () => {
    const draft = revisionDraft();
    const edited = withEntryFieldV2(draft, 2, "noticed", "правка во время доработки");
    expect(edited.entries[1]!.noticed).toBe("правка во время доработки");

    const resubmitted = withResubmitted(
      withSummaryV2(edited, "итог после правок"),
      "2026-07-19T12:00:00.000Z",
    );
    const locked = withEntryFieldV2(resubmitted, 2, "noticed", "поздно");
    expect(locked).toBe(resubmitted);
    expect(withSummaryV2(resubmitted, "поздно")).toBe(resubmitted);
  });

  it("first submit keeps its v1 semantics: draft → pending, readiness required", () => {
    const incomplete = withEntryFieldV2(createEmptyDraftV2(definition), 1, "noticed", "один");
    expect(withSubmittedV2(incomplete, "2026-07-17")).toBe(incomplete);

    const submitted = withSubmittedV2(readyV2Draft(), "2026-07-17T10:00:00.000Z");
    expect(submitted.status).toBe("pending-review");
    expect(submitted.review).toBeNull();
  });
});
