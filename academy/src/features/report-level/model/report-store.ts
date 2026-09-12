/**
 * Report storage (Phase D3-B, v2 in D3-C) — the only module in this feature that
 * touches Web Storage. Rules live in `report-workspace-v2.ts`; this is the port.
 *
 * `localStorage`, deliberately NOT `sessionStorage` (DD-266). This is a
 * considered divergence from the lesson store (DD-255), and the reason is the
 * nature of the data: losing "watched 50%" is an inconvenience — the video can be
 * rewatched — whereas losing a report draft loses the user's WORK. Autosave on
 * top of sessionStorage would be a promise the storage does not keep.
 *
 * D3-D moves the schema to `ata.report-workspace.v3` (DD-296). Reads MIGRATE
 * one-way: a present v3 value is authoritative (corrupt v3 fails closed and never
 * falls back to v2/v1); only when no v3 value exists is the v2 key read (which
 * itself lifts v1 when v2 is absent) through the untouched lower-version parsers
 * and raised into v3 shape with `approvedAt = null`. Writes go to the v3 key
 * only — the v1 and v2 keys are never deleted and never written again.
 *
 * It remains browser-local and the UI says exactly that. Nothing is sent
 * anywhere; no mentor sees it; there is no server.
 *
 * Every operation is defensive. Storage can be unavailable (SSR, private mode,
 * blocked cookies, quota) and its contents can be corrupt or hostile; none of
 * that may break the route. Reads degrade to "no draft"; writes report failure so
 * the UI can tell the user the truth instead of pretending it saved.
 */

import { getReportDefinition } from "@/features/report-level/data/report-fixtures";
import { REPORT_STORAGE_KEY } from "@/features/report-level/model/report-draft";
import { REPORT_STORAGE_KEY_V2 } from "@/features/report-level/model/report-workspace-v2";
import {
  REPORT_STORAGE_KEY_V3,
  emptyReportWorkspaceV3,
  readReportWorkspaceV3,
  serializeReportWorkspaceV3,
  type ReportWorkspaceStateV3,
  type ReportWorkspaceWritableV3,
} from "@/features/report-level/model/report-workspace-v3";

export interface ReportStore {
  read(): ReportWorkspaceStateV3;
  /** True when the write actually landed. False means the UI must say so. */
  write(state: ReportWorkspaceWritableV3): boolean;
  clear(): void;
  /** False when this environment has no usable storage at all. */
  readonly durable: boolean;
}

/** Real store, backed by the origin's localStorage. */
export class BrowserLocalReportStore implements ReportStore {
  readonly durable = true;
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  read(): ReportWorkspaceStateV3 {
    let rawV3: string | null;
    let rawV2: string | null;
    let rawV1: string | null;
    try {
      rawV3 = this.storage.getItem(REPORT_STORAGE_KEY_V3);
      // Each lower key is consulted ONLY when the one above is absent — the
      // migration helper owns that rule, this port just hands the values over.
      rawV2 = rawV3 === null ? this.storage.getItem(REPORT_STORAGE_KEY_V2) : null;
      rawV1 =
        rawV3 === null && rawV2 === null ? this.storage.getItem(REPORT_STORAGE_KEY) : null;
    } catch {
      return emptyReportWorkspaceV3();
    }
    return readReportWorkspaceV3(rawV3, rawV2, rawV1, getReportDefinition);
  }

  write(state: ReportWorkspaceWritableV3): boolean {
    try {
      // v3 only. The v1/v2 keys are deliberately left in place (DD-296): migration
      // is one-way and non-destructive, and once a v3 value exists it wins forever.
      this.storage.setItem(REPORT_STORAGE_KEY_V3, serializeReportWorkspaceV3(state));
      return true;
    } catch {
      // Quota exceeded, blocked storage, private mode. The draft simply does not
      // carry — we never throw into the render tree, and we never claim success.
      return false;
    }
  }

  clear(): void {
    try {
      // Clears only what this store OWNS. The v1/v2 keys survive even a clear:
      // deleting legacy data is not this feature's call to make (DD-296).
      this.storage.removeItem(REPORT_STORAGE_KEY_V3);
    } catch {
      /* nothing to do */
    }
  }
}

/**
 * In-memory store: the server, and any test that wants no browser.
 * `durable: false` is the honest signal — a draft kept here dies with the page,
 * and the UI is expected to say that local saving is unavailable.
 */
export class MemoryReportStore implements ReportStore {
  readonly durable = false;
  private raw: string | null = null;

  read(): ReportWorkspaceStateV3 {
    return readReportWorkspaceV3(this.raw, null, null, getReportDefinition);
  }

  write(state: ReportWorkspaceWritableV3): boolean {
    this.raw = serializeReportWorkspaceV3(state);
    return true;
  }

  clear(): void {
    this.raw = null;
  }
}

/**
 * Whether a value actually implements the Storage API we rely on.
 *
 * Not paranoia: `window.localStorage` is not guaranteed to be a real Storage.
 * Some environments expose a stand-in that answers the property but implements
 * none of the methods (the jsdom/Node combination this project tests on does
 * exactly that). A truthiness check would hand us that object and every call
 * would throw. We ask whether it can do the job instead of whether it exists.
 */
function isUsableStorage(value: unknown): value is Storage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Storage>;
  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  );
}

/**
 * The store for the current environment.
 *
 * On the server there is no localStorage, so this returns an in-memory store:
 * `localStorage` is never read during SSR, and the server therefore always
 * renders the empty-draft default. The client re-resolves after hydration, so
 * there is no mismatch.
 */
export function createReportStore(): ReportStore {
  if (typeof window === "undefined") return new MemoryReportStore();
  try {
    // Touching the property can itself throw when storage is blocked.
    const storage = window.localStorage;
    if (!isUsableStorage(storage)) return new MemoryReportStore();
    return new BrowserLocalReportStore(storage);
  } catch {
    return new MemoryReportStore();
  }
}
