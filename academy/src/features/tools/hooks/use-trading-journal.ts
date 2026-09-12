"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  applyJournalEdit,
  buildJournalEntry,
  sortJournalEntries,
  validateJournalInput,
  type JournalEntry,
  type JournalEntryInput,
  type JournalFieldErrors,
} from "@/features/tools/model/journal-entry";
import {
  createTradingJournalStore,
  deserializeReadResult,
  emptyTradingJournalState,
  nextEntryId,
  serializeReadResult,
  withEntryAdded,
  withEntryReplaced,
  type JournalReadResult,
  type TradingJournalStateV1,
} from "@/features/tools/model/journal-store";

/**
 * Save state in the user's terms. localStorage is synchronous, so `pending` is
 * momentary and we emit it honestly rather than faking latency. `storage-error`
 * is a real failed write; `idle` is the resting state; `saved` follows a landed
 * write; `editing` is owned by the component (which entry is open), not here.
 */
export type JournalSaveState = "idle" | "pending" | "saved" | "storage-error";

export interface JournalMutationResult {
  ok: boolean;
  entry?: JournalEntry;
  errors?: JournalFieldErrors;
}

export interface TradingJournalController {
  /** Sorted for display: newest occurredAt first, stable by id. */
  entries: JournalEntry[];
  /** A present payload could not be read — the corrupt-storage fallback. */
  corrupt: boolean;
  durable: boolean;
  saveState: JournalSaveState;
  /** Id of the last successfully created entry — for focus management. */
  lastCreatedId: string | null;
  create(input: JournalEntryInput): JournalMutationResult;
  update(id: string, input: JournalEntryInput): JournalMutationResult;
}

/** No cross-tab listener (DD-309): storage does not change under us in-tab. */
const subscribe = () => () => {};

const EMPTY_SNAPSHOT = serializeReadResult({
  state: emptyTradingJournalState(),
  corrupt: false,
});

/**
 * The browser-local Trading Journal (Phase D4-B). Hydration follows the report
 * precedent: the persisted read is taken through `useSyncExternalStore`, whose
 * SERVER snapshot is empty — the only thing the server can honestly know — so the
 * client swaps in the real value after mount with no mismatch.
 *
 * In-memory canonical state layers on top: after a LANDED write we advance
 * `local` to the exact state we persisted. A FAILED write leaves `local`
 * untouched (the list does not gain the entry) and raises `storage-error`, so
 * the form can keep the draft and retry.
 */
export function useTradingJournal(): TradingJournalController {
  const getSnapshot = useCallback(
    () => serializeReadResult(createTradingJournalStore().read()),
    [],
  );
  const getServerSnapshot = useCallback(() => EMPTY_SNAPSHOT, []);
  const rawSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const durable = useSyncExternalStore(
    subscribe,
    useCallback(() => createTradingJournalStore().durable, []),
    useCallback(() => true, []),
  );

  const persisted: JournalReadResult = useMemo(
    () => deserializeReadResult(rawSnapshot),
    [rawSnapshot],
  );

  const [local, setLocal] = useState<TradingJournalStateV1 | null>(null);
  const [saveState, setSaveState] = useState<JournalSaveState>("idle");
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  // A landed write rewrites the store cleanly, so a prior corrupt read no longer
  // applies once we hold our own valid `local` state.
  const state = local ?? persisted.state;
  const corrupt = persisted.corrupt && local === null;

  const submitting = useRef(false);

  const entries = useMemo(() => sortJournalEntries(state.entries), [state.entries]);

  /** Persist `next`, advancing in-memory state ONLY when the write lands. */
  const persist = useCallback((next: TradingJournalStateV1): boolean => {
    const store = createTradingJournalStore();
    if (!store.durable) {
      setSaveState("storage-error");
      return false;
    }
    setSaveState("pending");
    const ok = store.write(next);
    if (!ok) {
      // Canonical in-memory state is unchanged: the entry is not added, the draft
      // survives in the form, and the user can retry.
      setSaveState("storage-error");
      return false;
    }
    setLocal(next);
    setSaveState("saved");
    return true;
  }, []);

  const create = useCallback(
    (input: JournalEntryInput): JournalMutationResult => {
      if (submitting.current) return { ok: false };
      const validation = validateJournalInput(input);
      if (!validation.ok) {
        setSaveState("idle");
        return { ok: false, errors: validation.errors };
      }
      submitting.current = true;
      try {
        // Read the freshest persisted state so a create never drops a concurrent
        // one, then build the whole next state before writing.
        const base = local ?? createTradingJournalStore().read().state;
        const now = new Date().toISOString();
        const entry = buildJournalEntry(validation.value, nextEntryId(base), now);
        const next = withEntryAdded(base, entry);
        const ok = persist(next);
        if (!ok) return { ok: false };
        setLastCreatedId(entry.id);
        return { ok: true, entry };
      } finally {
        submitting.current = false;
      }
    },
    [local, persist],
  );

  const update = useCallback(
    (id: string, input: JournalEntryInput): JournalMutationResult => {
      if (submitting.current) return { ok: false };
      const validation = validateJournalInput(input);
      if (!validation.ok) {
        setSaveState("idle");
        return { ok: false, errors: validation.errors };
      }
      submitting.current = true;
      try {
        const base = local ?? createTradingJournalStore().read().state;
        const existing = base.entries.find((e) => e.id === id);
        if (!existing) return { ok: false };
        const now = new Date().toISOString();
        const edited = applyJournalEdit(existing, validation.value, now);
        const next = withEntryReplaced(base, edited);
        const ok = persist(next);
        if (!ok) return { ok: false };
        return { ok: true, entry: edited };
      } finally {
        submitting.current = false;
      }
    },
    [local, persist],
  );

  return {
    entries,
    corrupt,
    durable,
    saveState,
    lastCreatedId,
    create,
    update,
  };
}
