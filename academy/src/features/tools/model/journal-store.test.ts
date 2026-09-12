import { beforeEach, describe, expect, it } from "vitest";
import {
  BrowserLocalJournalStore,
  MemoryJournalStore,
  createTradingJournalStore,
  emptyTradingJournalState,
  nextEntryId,
  parseTradingJournal,
  serializeTradingJournal,
  TRADING_JOURNAL_STORAGE_KEY,
  withEntryAdded,
  withEntryReplaced,
  type TradingJournalStateV1,
} from "@/features/tools/model/journal-store";
import type { JournalEntry } from "@/features/tools/model/journal-entry";

function makeStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
    ...overrides,
  } as Storage;
}

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: "journal-1",
  occurredAt: "2026-07-14T09:00:00.000Z",
  instrument: "XAU/USD",
  direction: "sell",
  setup: "отскок",
  plan: "вход по условию",
  execution: "дождался",
  lesson: "терпение сработало",
  manualResult: 18,
  createdAt: "2026-07-14T09:00:00.000Z",
  updatedAt: "2026-07-14T09:00:00.000Z",
  ...over,
});

function populated(): TradingJournalStateV1 {
  let state = emptyTradingJournalState();
  state = withEntryAdded(state, entry({ id: nextEntryId(state) }));
  state = withEntryAdded(
    state,
    entry({ id: nextEntryId(state), instrument: "EUR/USD", direction: "buy", manualResult: -7 }),
  );
  state = withEntryAdded(
    state,
    entry({
      id: nextEntryId(state),
      instrument: "GBP/USD",
      direction: "observation",
      manualResult: null,
    }),
  );
  return state;
}

describe("parseTradingJournal — fail closed", () => {
  it("empty/absent raw → empty canonical state, not corrupt", () => {
    for (const raw of [null, undefined, ""]) {
      const r = parseTradingJournal(raw);
      expect(r.state).toEqual(emptyTradingJournalState());
      expect(r.corrupt).toBe(false);
    }
  });

  it("round-trips a valid populated payload", () => {
    const state = populated();
    const r = parseTradingJournal(serializeTradingJournal(state));
    expect(r.corrupt).toBe(false);
    expect(r.state.entries).toHaveLength(3);
    expect(r.state.sequence).toBe(3);
  });

  it("invalid JSON → empty AND corrupt", () => {
    expect(parseTradingJournal("@@@not json@@@")).toEqual({
      state: emptyTradingJournalState(),
      corrupt: true,
    });
  });

  it("non-object root → empty AND corrupt", () => {
    expect(parseTradingJournal("[1,2,3]").corrupt).toBe(true);
    expect(parseTradingJournal('"a string"').corrupt).toBe(true);
  });

  it("unknown version → empty, NOT corrupt (unsupported, not damaged)", () => {
    const r = parseTradingJournal(JSON.stringify({ version: 2, sequence: 0, entries: [] }));
    expect(r.state).toEqual(emptyTradingJournalState());
    expect(r.corrupt).toBe(false);
  });

  it("damaged v1 shape (entries not array, bad sequence) → corrupt", () => {
    expect(parseTradingJournal(JSON.stringify({ version: 1, sequence: 0, entries: "x" })).corrupt).toBe(true);
    expect(parseTradingJournal(JSON.stringify({ version: 1, sequence: -1, entries: [] })).corrupt).toBe(true);
    expect(parseTradingJournal(JSON.stringify({ version: 1, sequence: 1.5, entries: [] })).corrupt).toBe(true);
  });

  it("drops a malformed entry but keeps valid siblings (no partial resurrection)", () => {
    const raw = JSON.stringify({
      version: 1,
      sequence: 2,
      entries: [entry({ id: "journal-1" }), { id: "journal-2", instrument: "" }],
    });
    const r = parseTradingJournal(raw);
    expect(r.corrupt).toBe(false);
    expect(r.state.entries.map((e) => e.id)).toEqual(["journal-1"]);
  });

  it("drops entries with invalid ISO, unknown direction, or non-finite result", () => {
    const good = entry({ id: "journal-0" });
    // `1e999` parses to Infinity — the realistic tampered non-finite result.
    const nonFinite = serializeTradingJournal(
      withEntryAdded(emptyTradingJournalState(), entry({ id: "journal-3" })),
    ).replace('"manualResult":18', '"manualResult":1e999');
    expect(parseTradingJournal(nonFinite).state.entries).toHaveLength(0);

    const raw = JSON.stringify({
      version: 1,
      sequence: 3,
      entries: [
        good,
        entry({ id: "journal-1", occurredAt: "nope" }),
        entry({ id: "journal-2", direction: "long" as unknown as JournalEntry["direction"] }),
        entry({ id: "journal-4", manualResult: "18" as unknown as number }),
      ],
    });
    // Only the valid one survives; the three malformed ones are dropped.
    expect(parseTradingJournal(raw).state.entries.map((e) => e.id)).toEqual(["journal-0"]);
  });

  it("keeps the first of duplicate ids", () => {
    const raw = JSON.stringify({
      version: 1,
      sequence: 1,
      entries: [entry({ id: "journal-1", lesson: "first" }), entry({ id: "journal-1", lesson: "second" })],
    });
    const r = parseTradingJournal(raw);
    expect(r.state.entries).toHaveLength(1);
    expect(r.state.entries[0]!.lesson).toBe("first");
  });

  it("advances the sequence past the highest surviving entry id", () => {
    const raw = JSON.stringify({
      version: 1,
      sequence: 0,
      entries: [entry({ id: "journal-5" })],
    });
    expect(parseTradingJournal(raw).state.sequence).toBe(5);
  });
});

describe("pure state transitions", () => {
  it("withEntryAdded advances the sequence and appends", () => {
    const s0 = emptyTradingJournalState();
    const s1 = withEntryAdded(s0, entry({ id: "journal-1" }));
    expect(s1.sequence).toBe(1);
    expect(s0.entries).toHaveLength(0); // input not mutated
  });

  it("withEntryReplaced swaps by id, leaving sequence untouched", () => {
    const s1 = withEntryAdded(emptyTradingJournalState(), entry({ id: "journal-1" }));
    const s2 = withEntryReplaced(s1, entry({ id: "journal-1", lesson: "edited" }));
    expect(s2.sequence).toBe(1);
    expect(s2.entries[0]!.lesson).toBe("edited");
  });

  it("withEntryReplaced is a no-op for an unknown id", () => {
    const s1 = withEntryAdded(emptyTradingJournalState(), entry({ id: "journal-1" }));
    expect(withEntryReplaced(s1, entry({ id: "journal-9" }))).toBe(s1);
  });
});

describe("BrowserLocalJournalStore", () => {
  beforeEach(() => window.localStorage.clear());

  it("writes to the canonical v1 localStorage key and reads back", () => {
    const store = new BrowserLocalJournalStore(window.localStorage);
    const ok = store.write(populated());
    expect(ok).toBe(true);
    expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).toContain("XAU/USD");
    expect(store.read().state.entries).toHaveLength(3);
  });

  it("never writes to lesson-progress or report keys", () => {
    const store = new BrowserLocalJournalStore(window.localStorage);
    store.write(populated());
    expect(window.localStorage.getItem("ata.lesson-progress.v1")).toBeNull();
    expect(window.localStorage.getItem("ata.report-workspace.v3")).toBeNull();
    expect(window.localStorage.getItem("ata.report-workspace.v2")).toBeNull();
    expect(window.localStorage.getItem("ata.report-workspace.v1")).toBeNull();
  });

  it("a failed setItem reports false (never a fake success)", () => {
    const storage = makeStorage({
      setItem: () => {
        throw new Error("quota");
      },
    });
    const store = new BrowserLocalJournalStore(storage);
    expect(store.write(populated())).toBe(false);
  });

  it("a failed getItem degrades to empty, not corrupt (unavailability)", () => {
    const storage = makeStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    const store = new BrowserLocalJournalStore(storage);
    expect(store.read()).toEqual({ state: emptyTradingJournalState(), corrupt: false });
  });

  it("reload persistence: a second store reads the first store's writes", () => {
    new BrowserLocalJournalStore(window.localStorage).write(populated());
    const reopened = new BrowserLocalJournalStore(window.localStorage);
    expect(reopened.read().state.entries).toHaveLength(3);
  });
});

describe("createTradingJournalStore", () => {
  it("returns a durable browser store in jsdom", () => {
    expect(createTradingJournalStore().durable).toBe(true);
  });
});

describe("MemoryJournalStore", () => {
  it("is honest about not being durable", () => {
    expect(new MemoryJournalStore().durable).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Privacy: no financial aggregate ever reaches the schema / payload
 * ------------------------------------------------------------------ */
describe("no financial aggregates in schema or payload (DD-303)", () => {
  const FORBIDDEN = [
    "balance",
    "deposit",
    "withdrawal",
    "accountId",
    "brokerId",
    "pocket",
    "pnl",
    "profit",
    "winRate",
    "winrate",
    "percentage",
    "percent",
    "aggregate",
    "total",
    "equity",
    "roi",
    "profitability",
    "average",
  ];

  it("serialized payload contains none of the forbidden keys", () => {
    const json = serializeTradingJournal(populated()).toLowerCase();
    for (const key of FORBIDDEN) {
      expect(json.includes(`"${key.toLowerCase()}"`)).toBe(false);
    }
  });

  it("an entry exposes exactly the allowed keys — nothing financial-aggregate", () => {
    const state = populated();
    const keys = Object.keys(state.entries[0]!).sort();
    expect(keys).toEqual(
      [
        "createdAt",
        "direction",
        "execution",
        "id",
        "instrument",
        "lesson",
        "manualResult",
        "occurredAt",
        "plan",
        "setup",
        "updatedAt",
      ].sort(),
    );
  });

  it("state root has only version/sequence/entries — no totals", () => {
    expect(Object.keys(populated()).sort()).toEqual(["entries", "sequence", "version"]);
  });
});
