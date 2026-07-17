/**
 * Report storage (Phase D3-B) — the only module in this feature that touches Web
 * Storage. Rules live in `report-draft.ts`; this is the port.
 *
 * `localStorage`, deliberately NOT `sessionStorage` (DD-266). This is a
 * considered divergence from the lesson store (DD-255), and the reason is the
 * nature of the data: losing "watched 50%" is an inconvenience — the video can be
 * rewatched — whereas losing a report draft loses the user's WORK. Autosave on
 * top of sessionStorage would be a promise the storage does not keep.
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
import {
  REPORT_STORAGE_KEY,
  emptyReportWorkspace,
  parseReportWorkspace,
  serializeReportWorkspace,
  type ReportWorkspaceState,
} from "@/features/report-level/model/report-draft";

export interface ReportStore {
  read(): ReportWorkspaceState;
  /** True when the write actually landed. False means the UI must say so. */
  write(state: ReportWorkspaceState): boolean;
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

  read(): ReportWorkspaceState {
    let raw: string | null;
    try {
      raw = this.storage.getItem(REPORT_STORAGE_KEY);
    } catch {
      return emptyReportWorkspace();
    }
    return parseReportWorkspace(raw, getReportDefinition);
  }

  write(state: ReportWorkspaceState): boolean {
    try {
      this.storage.setItem(REPORT_STORAGE_KEY, serializeReportWorkspace(state));
      return true;
    } catch {
      // Quota exceeded, blocked storage, private mode. The draft simply does not
      // carry — we never throw into the render tree, and we never claim success.
      return false;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(REPORT_STORAGE_KEY);
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
  private state: ReportWorkspaceState = emptyReportWorkspace();

  read(): ReportWorkspaceState {
    return this.state;
  }

  write(state: ReportWorkspaceState): boolean {
    this.state = state;
    return true;
  }

  clear(): void {
    this.state = emptyReportWorkspace();
  }
}

/**
 * The store for the current environment.
 *
 * On the server there is no localStorage, so this returns an in-memory store:
 * `localStorage` is never read during SSR, and the server therefore always
 * renders the empty-draft default. The client re-resolves after hydration, so
 * there is no mismatch.
 */
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
