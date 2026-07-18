import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import {
  BrowserLocalReportStore,
  MemoryReportStore,
  createReportStore,
} from "@/features/report-level/model/report-store";
import {
  REPORT_STORAGE_KEY,
  createEmptyDraft,
  emptyReportWorkspace,
  withDraft,
  withEntryField,
} from "@/features/report-level/model/report-draft";
import { REPORT_STORAGE_KEY_V2 } from "@/features/report-level/model/report-workspace-v2";
import {
  REPORT_STORAGE_KEY_V3,
  getStoredDraftV3,
} from "@/features/report-level/model/report-workspace-v3";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;

/** Minimal Storage double we can make fail on demand. */
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

describe("report store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses localStorage — a draft must survive closing the tab (DD-266)", () => {
    const store = createReportStore();
    const draft = withEntryField(createEmptyDraft(definition), 1, "noticed", "переживу вкладку");
    store.write(withDraft(emptyReportWorkspace(), draft));

    // Written to localStorage, not sessionStorage: this is the whole divergence
    // from the lesson store, so it is pinned rather than assumed. Since D3-D the
    // store writes the v3 key (DD-296) — and never writes the v1 or v2 keys.
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V3)).toContain("переживу вкладку");
    expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY_V3)).toBeNull();
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY_V2)).toBeNull();
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY)).toBeNull();
  });

  it("does not touch the lesson progress key", () => {
    const store = createReportStore();
    store.write(withDraft(emptyReportWorkspace(), createEmptyDraft(definition)));
    expect(window.localStorage.getItem("ata.lesson-progress.v1")).toBeNull();
    expect(window.sessionStorage.getItem("ata.lesson-progress.v1")).toBeNull();
  });

  it("reads back what it wrote", () => {
    const store = createReportStore();
    const draft = withEntryField(createEmptyDraft(definition), 2, "noticed", "вторая запись");
    store.write(withDraft(emptyReportWorkspace(), draft));

    const reread = getStoredDraftV3(createReportStore().read(), 3);
    expect(reread?.entries[1]!.noticed).toBe("вторая запись");
  });

  it("degrades to an empty workspace when the stored value is corrupt", () => {
    window.localStorage.setItem(REPORT_STORAGE_KEY, "{{{ not json");
    expect(createReportStore().read().reports).toEqual([]);
  });

  it("degrades to an empty workspace when reading throws", () => {
    const store = new BrowserLocalReportStore(
      makeStorage({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    );
    expect(store.read().reports).toEqual([]);
  });

  it("reports a write failure instead of pretending it saved", () => {
    const store = new BrowserLocalReportStore(
      makeStorage({
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
    );
    expect(store.write(emptyReportWorkspace())).toBe(false);
  });

  it("does not throw when clearing fails", () => {
    const store = new BrowserLocalReportStore(
      makeStorage({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    );
    expect(() => store.clear()).not.toThrow();
  });

  it("falls back to memory when localStorage access itself throws", () => {
    const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked by policy");
    });
    const store = createReportStore();
    expect(store).toBeInstanceOf(MemoryReportStore);
    // The honest signal: nothing durable here, so the UI can say so.
    expect(store.durable).toBe(false);
    spy.mockRestore();
  });

  it("memory store is explicitly not durable", () => {
    const store = new MemoryReportStore();
    expect(store.durable).toBe(false);
    expect(store.write(emptyReportWorkspace())).toBe(true);
    expect(store.read().reports).toEqual([]);
  });

  it("browser store is durable", () => {
    expect(createReportStore().durable).toBe(true);
  });
});
