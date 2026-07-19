import { describe, expect, it } from "vitest";
import {
  applyJournalEdit,
  buildJournalEntry,
  DIRECTION_LABEL,
  sortJournalEntries,
  validateJournalInput,
  type JournalEntry,
  type JournalEntryInput,
} from "@/features/tools/model/journal-entry";

const base: JournalEntryInput = {
  occurredAt: "2026-07-14T09:00",
  instrument: "XAU/USD",
  direction: "sell",
  setup: "отскок от уровня",
  plan: "вход только после подтверждения",
  execution: "дождался свечи, вошёл",
  lesson: "терпение сработало",
  manualResult: "18",
};

describe("direction labels", () => {
  it("uses the canonical RU wording", () => {
    expect(DIRECTION_LABEL.buy).toBe("Покупка");
    expect(DIRECTION_LABEL.sell).toBe("Продажа");
    expect(DIRECTION_LABEL.observation).toBe("Наблюдение / без входа");
  });
});

describe("validateJournalInput", () => {
  it("accepts a complete entry and normalises the date to ISO", () => {
    const result = validateJournalInput(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manualResult).toBe(18);
      expect(result.value.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.value.instrument).toBe("XAU/USD");
    }
  });

  it("accepts a negative result", () => {
    const result = validateJournalInput({ ...base, manualResult: "-7" });
    expect(result.ok && result.value.manualResult).toBe(-7);
  });

  it("accepts a zero result", () => {
    const result = validateJournalInput({ ...base, manualResult: "0" });
    expect(result.ok && result.value.manualResult).toBe(0);
  });

  it("treats an empty / null result as null (a normal, complete state)", () => {
    expect(validateJournalInput({ ...base, manualResult: "" }).ok).toBe(true);
    const r = validateJournalInput({ ...base, manualResult: null });
    expect(r.ok && r.value.manualResult).toBeNull();
  });

  it("allows an observation with no result", () => {
    const r = validateJournalInput({
      ...base,
      direction: "observation",
      manualResult: null,
    });
    expect(r.ok && r.value.direction).toBe("observation");
  });

  it("rejects a non-finite / non-numeric result rather than storing junk", () => {
    for (const bad of ["abc", "1e999", "12%", "1,5", "Infinity", "NaN"]) {
      const r = validateJournalInput({ ...base, manualResult: bad });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors.manualResult).toBeDefined();
    }
  });

  it("rejects whitespace-only required fields", () => {
    for (const key of ["instrument", "plan", "execution", "lesson"] as const) {
      const r = validateJournalInput({ ...base, [key]: "   " });
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.errors[key]).toBeDefined();
    }
  });

  it("rejects an invalid date and an unknown direction", () => {
    expect(validateJournalInput({ ...base, occurredAt: "not-a-date" }).ok).toBe(false);
    expect(validateJournalInput({ ...base, direction: "long" }).ok).toBe(false);
  });

  it("keeps setup optional", () => {
    const r = validateJournalInput({ ...base, setup: "" });
    expect(r.ok && r.value.setup).toBe("");
  });
});

describe("build / edit", () => {
  it("build stamps id + createdAt/updatedAt", () => {
    const v = validateJournalInput(base);
    if (!v.ok) throw new Error("expected valid");
    const entry = buildJournalEntry(v.value, "journal-1", "2026-07-14T09:05:00.000Z");
    expect(entry.id).toBe("journal-1");
    expect(entry.createdAt).toBe("2026-07-14T09:05:00.000Z");
    expect(entry.updatedAt).toBe("2026-07-14T09:05:00.000Z");
  });

  it("edit bumps updatedAt but preserves id + createdAt", () => {
    const v = validateJournalInput(base);
    if (!v.ok) throw new Error("expected valid");
    const entry = buildJournalEntry(v.value, "journal-1", "2026-07-14T09:05:00.000Z");
    const v2 = validateJournalInput({ ...base, lesson: "новый вывод" });
    if (!v2.ok) throw new Error("expected valid");
    const edited = applyJournalEdit(entry, v2.value, "2026-07-15T10:00:00.000Z");
    expect(edited.id).toBe("journal-1");
    expect(edited.createdAt).toBe("2026-07-14T09:05:00.000Z");
    expect(edited.updatedAt).toBe("2026-07-15T10:00:00.000Z");
    expect(edited.lesson).toBe("новый вывод");
  });
});

describe("sortJournalEntries", () => {
  const mk = (id: string, occurredAt: string): JournalEntry => ({
    id,
    occurredAt,
    instrument: "X",
    direction: "buy",
    setup: "",
    plan: "p",
    execution: "e",
    lesson: "l",
    manualResult: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });

  it("orders newest occurredAt first with a stable id tie-break", () => {
    const a = mk("journal-1", "2026-07-14T09:00:00.000Z");
    const b = mk("journal-2", "2026-07-15T09:00:00.000Z");
    const c = mk("journal-3", "2026-07-15T09:00:00.000Z"); // tie with b
    const sorted = sortJournalEntries([a, b, c]);
    expect(sorted.map((e) => e.id)).toEqual(["journal-2", "journal-3", "journal-1"]);
  });

  it("does not mutate its input", () => {
    const input = [mk("journal-1", "2026-07-14T09:00:00.000Z")];
    const copy = [...input];
    sortJournalEntries(input);
    expect(input).toEqual(copy);
  });
});
