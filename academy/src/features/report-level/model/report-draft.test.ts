import { describe, expect, it } from "vitest";
import { CURRICULUM } from "@/data/curriculum/fixture";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import {
  REPORT_ENTRY_FIELDS,
  REQUIRED_ENTRY_FIELD,
  isReportLevelNumber,
  reportEntryId,
  reportLevelNumbers,
} from "@/features/report-level/model/report";
import {
  MAX_FIELD_LENGTH,
  REPORT_STORAGE_KEY,
  createEmptyDraft,
  emptyReportWorkspace,
  filledEntryCount,
  getStoredDraft,
  isEntryFilled,
  isReportReady,
  parseReportWorkspace,
  serializeReportWorkspace,
  withDraft,
  withEntryField,
  withSubmitted,
  withSummary,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;
const parse = (raw: string | null) => parseReportWorkspace(raw, getReportDefinition);

/** A ready draft: every entry carries the required field, plus a summary. */
function readyDraft(): ReportDraft {
  let draft = createEmptyDraft(definition);
  for (const entry of draft.entries) {
    draft = withEntryField(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummary(draft, "итог");
}

describe("report level — curriculum consistency", () => {
  it("has exactly one report level in the whole curriculum", () => {
    expect(reportLevelNumbers()).toEqual([3]);
  });

  it("level 3 is the report level and D3-B authored it", () => {
    expect(isReportLevelNumber(3)).toBe(true);
    expect(REPORT_LEVEL_NUMBER).toBe(3);
    expect(definition.level.number).toBe(3);
    expect(definition.level.kind).toBe("report");
  });

  it("takes level title, module and artifact from the curriculum fixture verbatim", () => {
    const level = CURRICULUM.levels[2]!;
    expect(definition.level.title).toBe(level.title);
    expect(definition.level.artifact).toBe(level.artifact);
    expect(definition.level.moduleCode).toBe("module.01");
  });

  it("entry count matches the artifact the curriculum asks for", () => {
    // «Отчёт по 5 demo-сделкам» — the structure comes from the course, not layout.
    expect(definition.level.artifact).toContain("5");
    expect(definition.entryCount).toBe(5);
  });

  it("authors no report for any non-report level", () => {
    expect(getReportDefinition(18)).toBeNull();
    expect(getReportDefinition(19)).toBeNull();
    expect(getReportDefinition(4)).toBeNull();
  });

  it("builds five stable entry ids", () => {
    const draft = createEmptyDraft(definition);
    expect(draft.entries).toHaveLength(5);
    expect(draft.entries.map((e) => e.id)).toEqual([
      "report.003.entry.1",
      "report.003.entry.2",
      "report.003.entry.3",
      "report.003.entry.4",
      "report.003.entry.5",
    ]);
    expect(draft.entries.map((e) => e.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(reportEntryId(3, 2)).toBe("report.003.entry.2");
  });

  it("carries no financial or trading-performance field", () => {
    const keys = REPORT_ENTRY_FIELDS.map((f) => f.key);
    expect(keys).toEqual(["when", "decided", "noticed"]);
    for (const forbidden of [
      "asset",
      "amount",
      "profit",
      "loss",
      "pnl",
      "entryPrice",
      "exitPrice",
      "volume",
      "leverage",
      "result",
      "balance",
      "deposit",
      "xp",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("report draft — readiness rule", () => {
  it("counts an entry as filled only via the single required field", () => {
    expect(REQUIRED_ENTRY_FIELD).toBe("noticed");
    let draft = createEmptyDraft(definition);

    // Optional context alone does NOT fill an entry.
    draft = withEntryField(draft, 1, "when", "среда");
    draft = withEntryField(draft, 1, "decided", "вошёл");
    expect(isEntryFilled(draft.entries[0]!)).toBe(false);
    expect(filledEntryCount(draft)).toBe(0);

    draft = withEntryField(draft, 1, "noticed", "заметил, что решение было быстрым");
    expect(isEntryFilled(draft.entries[0]!)).toBe(true);
    expect(filledEntryCount(draft)).toBe(1);
  });

  it("treats whitespace as empty", () => {
    const draft = withEntryField(createEmptyDraft(definition), 1, "noticed", "   \n  ");
    expect(isEntryFilled(draft.entries[0]!)).toBe(false);
  });

  it("is ready only when all five entries and the summary carry text", () => {
    let draft = createEmptyDraft(definition);
    expect(isReportReady(draft)).toBe(false);

    for (const entry of draft.entries) {
      draft = withEntryField(draft, entry.ordinal, "noticed", "наблюдение");
    }
    // All entries, but no summary yet.
    expect(filledEntryCount(draft)).toBe(5);
    expect(isReportReady(draft)).toBe(false);

    draft = withSummary(draft, "итог");
    expect(isReportReady(draft)).toBe(true);
  });

  it("is not ready when the summary is only whitespace", () => {
    const draft = withSummary(readyDraft(), "   ");
    expect(isReportReady(draft)).toBe(false);
  });
});

describe("report draft — mutation", () => {
  it("is pure: the previous draft is never mutated", () => {
    const draft = createEmptyDraft(definition);
    const next = withEntryField(draft, 1, "noticed", "текст");
    expect(draft.entries[0]!.noticed).toBe("");
    expect(next.entries[0]!.noticed).toBe("текст");
    expect(next).not.toBe(draft);
  });

  it("advances the revision counter on every accepted edit", () => {
    const draft = createEmptyDraft(definition);
    expect(draft.revision).toBe(0);
    expect(withEntryField(draft, 1, "noticed", "a").revision).toBe(1);
    expect(withSummary(draft, "a").revision).toBe(1);
  });

  it("ignores an edit to an entry that does not exist", () => {
    const draft = createEmptyDraft(definition);
    expect(withEntryField(draft, 9, "noticed", "текст")).toBe(draft);
    expect(withEntryField(draft, 0, "noticed", "текст")).toBe(draft);
  });

  it("clamps a runaway value instead of letting it fill the quota", () => {
    const draft = withEntryField(createEmptyDraft(definition), 1, "noticed", "x".repeat(9000));
    expect(draft.entries[0]!.noticed).toHaveLength(MAX_FIELD_LENGTH);
  });
});

describe("report draft — submit", () => {
  it("moves a ready draft to pending-review and records submittedAt", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    expect(submitted.status).toBe("pending-review");
    expect(submitted.submittedAt).toBe("2026-07-17T10:00:00.000Z");
  });

  it("refuses to submit a draft that is not ready", () => {
    const draft = createEmptyDraft(definition);
    const attempted = withSubmitted(draft, "2026-07-17T10:00:00.000Z");
    expect(attempted.status).toBe("draft");
    expect(attempted.submittedAt).toBeNull();
  });

  it("makes a submitted report read-only by construction", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    expect(withEntryField(submitted, 1, "noticed", "правка")).toBe(submitted);
    expect(withSummary(submitted, "правка")).toBe(submitted);
    // A second submit cannot re-stamp the time either.
    expect(withSubmitted(submitted, "2026-07-18T10:00:00.000Z")).toBe(submitted);
  });

  it("never records XP, balance or any financial value", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    const serialized = serializeReportWorkspace(
      withDraft(emptyReportWorkspace(), submitted),
    );
    for (const forbidden of ["xp", "XP", "balance", "deposit", "pocket", "Pocket", "$"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("report draft — workspace access", () => {
  it("stores and reads back one report per level", () => {
    const draft = withEntryField(createEmptyDraft(definition), 1, "noticed", "текст");
    const state = withDraft(emptyReportWorkspace(), draft);
    expect(getStoredDraft(state, 3)?.entries[0]!.noticed).toBe("текст");
    expect(getStoredDraft(state, 18)).toBeNull();
  });

  it("replaces rather than duplicates a report for the same level", () => {
    const first = withEntryField(createEmptyDraft(definition), 1, "noticed", "первый");
    const second = withEntryField(first, 1, "noticed", "второй");
    const state = withDraft(withDraft(emptyReportWorkspace(), first), second);
    expect(state.reports).toHaveLength(1);
    expect(getStoredDraft(state, 3)?.entries[0]!.noticed).toBe("второй");
  });
});

describe("report draft — parsing survives anything", () => {
  it("uses a versioned key", () => {
    expect(REPORT_STORAGE_KEY).toBe("ata.report-workspace.v1");
  });

  it("returns an empty workspace for empty input", () => {
    expect(parse(null).reports).toEqual([]);
    expect(parse("").reports).toEqual([]);
    expect(parse(undefined as unknown as string).reports).toEqual([]);
  });

  it("returns an empty workspace for corrupt JSON", () => {
    expect(parse("{not json").reports).toEqual([]);
    expect(parse("undefined").reports).toEqual([]);
    expect(parse("[1,2,3").reports).toEqual([]);
  });

  it("returns an empty workspace for a non-object payload", () => {
    expect(parse('"a string"').reports).toEqual([]);
    expect(parse("[]").reports).toEqual([]);
    expect(parse("42").reports).toEqual([]);
    expect(parse("null").reports).toEqual([]);
  });

  it("returns an empty workspace for an unknown schema version", () => {
    const raw = JSON.stringify({ version: 2, reports: [{ levelCode: "level.003" }] });
    expect(parse(raw).reports).toEqual([]);
    expect(parse(JSON.stringify({ reports: [] })).reports).toEqual([]);
  });

  it("returns an empty workspace when reports is not an array", () => {
    expect(parse(JSON.stringify({ version: 1, reports: {} })).reports).toEqual([]);
  });

  it("drops a report stored against a level that is not a report level", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [{ levelCode: "level.018", entries: [], summary: "", status: "draft" }],
    });
    expect(parse(raw).reports).toEqual([]);
  });

  it("drops a report with an unparseable level code", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [{ levelCode: "report.003", entries: [], summary: "", status: "draft" }],
    });
    expect(parse(raw).reports).toEqual([]);
  });

  it("drops a report carrying a forged verdict — approved can never be faked", () => {
    for (const status of ["approved", "rejected", "revision-requested", "", null, 7]) {
      const raw = JSON.stringify({
        version: 1,
        reports: [{ levelCode: "level.003", entries: [], summary: "s", status }],
      });
      expect(parse(raw).reports).toEqual([]);
    }
  });

  it("normalises a report with too few entries back to exactly five", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [
        {
          levelCode: "level.003",
          entries: [{ id: "x", ordinal: 1, when: "", decided: "", noticed: "первое" }],
          summary: "",
          status: "draft",
        },
      ],
    });
    const draft = getStoredDraft(parse(raw), 3)!;
    expect(draft.entries).toHaveLength(5);
    expect(draft.entries[0]!.noticed).toBe("первое");
    expect(draft.entries[4]!.noticed).toBe("");
  });

  it("normalises a report with too many entries back to exactly five", () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      id: `forged.${i}`,
      ordinal: i + 1,
      when: "",
      decided: "",
      noticed: `n${i + 1}`,
    }));
    const raw = JSON.stringify({
      version: 1,
      reports: [{ levelCode: "level.003", entries, summary: "s", status: "draft" }],
    });
    const draft = getStoredDraft(parse(raw), 3)!;
    expect(draft.entries).toHaveLength(5);
    expect(draft.entries[4]!.noticed).toBe("n5");
  });

  it("regenerates entry ids instead of trusting stored ones", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [
        {
          levelCode: "level.003",
          entries: [{ id: "../../evil", ordinal: 1, noticed: "a" }],
          summary: "",
          status: "draft",
        },
      ],
    });
    expect(getStoredDraft(parse(raw), 3)!.entries[0]!.id).toBe("report.003.entry.1");
  });

  it("drops unknown fields — the payload cannot grow by echo", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [
        {
          levelCode: "level.003",
          entries: [{ ordinal: 1, noticed: "a", secret: "leak", pnl: 42 }],
          summary: "s",
          status: "draft",
          approved: true,
          xp: 999,
        },
      ],
    });
    const round = serializeReportWorkspace(parse(raw));
    expect(round).not.toContain("secret");
    expect(round).not.toContain("pnl");
    expect(round).not.toContain("xp");
    expect(round).not.toContain("approved");
  });

  it("coerces non-string field values to empty rather than rendering them", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [
        {
          levelCode: "level.003",
          entries: [{ ordinal: 1, when: 42, decided: null, noticed: { a: 1 } }],
          summary: [],
          status: "draft",
        },
      ],
    });
    const draft = getStoredDraft(parse(raw), 3)!;
    expect(draft.entries[0]!.when).toBe("");
    expect(draft.entries[0]!.decided).toBe("");
    expect(draft.entries[0]!.noticed).toBe("");
    expect(draft.summary).toBe("");
  });

  it("downgrades a pending record that could never have been submitted", () => {
    // A pending status on an unfinished report cannot come from withSubmitted.
    // We hand back the editable draft rather than lock the user out of their work.
    const raw = JSON.stringify({
      version: 1,
      reports: [
        {
          levelCode: "level.003",
          entries: [{ ordinal: 1, noticed: "только одна" }],
          summary: "",
          status: "pending-review",
          submittedAt: "2026-07-17T10:00:00.000Z",
        },
      ],
    });
    const draft = getStoredDraft(parse(raw), 3)!;
    expect(draft.status).toBe("draft");
    expect(draft.submittedAt).toBeNull();
  });

  it("keeps a pending record that IS complete", () => {
    const raw = serializeReportWorkspace(
      withDraft(emptyReportWorkspace(), withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z")),
    );
    expect(getStoredDraft(parse(raw), 3)!.status).toBe("pending-review");
  });

  it("deduplicates reports for the same level", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [
        { levelCode: "level.003", entries: [{ ordinal: 1, noticed: "первый" }], summary: "", status: "draft" },
        { levelCode: "level.003", entries: [{ ordinal: 1, noticed: "второй" }], summary: "", status: "draft" },
      ],
    });
    const state = parse(raw);
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]!.entries[0]!.noticed).toBe("первый");
  });

  it("round-trips deterministically", () => {
    const state = withDraft(emptyReportWorkspace(), readyDraft());
    const once = serializeReportWorkspace(state);
    const twice = serializeReportWorkspace(parse(once));
    expect(twice).toBe(once);
  });

  it("normalises a negative or fractional revision to zero", () => {
    const raw = JSON.stringify({
      version: 1,
      reports: [
        { levelCode: "level.003", entries: [], summary: "", status: "draft", revision: -5 },
      ],
    });
    expect(getStoredDraft(parse(raw), 3)!.revision).toBe(0);
  });
});

describe("report draft — fixtures stay immutable", () => {
  it("does not let a draft edit reach the curriculum fixture", () => {
    const before = CURRICULUM.levels[2]!.title;
    const edited = withEntryField(createEmptyDraft(definition), 1, "noticed", "текст");

    expect(edited.entries[0]!.noticed).toBe("текст");
    expect(CURRICULUM.levels[2]!.title).toBe(before);
    expect(definition.level.title).toBe(before);
  });

  it("builds a fresh entry array per draft", () => {
    const a = createEmptyDraft(definition);
    const b = createEmptyDraft(definition);
    expect(a.entries).not.toBe(b.entries);
    expect(a.entries).toEqual(b.entries);
  });
});
