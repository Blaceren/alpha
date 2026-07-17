"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getReportDefinition } from "@/features/report-level/data/report-fixtures";
import { createReportStore } from "@/features/report-level/model/report-store";
import {
  createEmptyDraft,
  emptyReportWorkspace,
  getStoredDraft,
  parseReportWorkspace,
  serializeReportWorkspace,
  withDraft,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";
import type { ReportDefinition } from "@/features/report-level/model/report";

/**
 * Local save state, in the user's terms. There are four and no more, because
 * there are only four truths to tell.
 *
 * `saving` is momentary by nature: localStorage is synchronous, so the write
 * completes within the same task. We emit the state honestly rather than faking
 * latency to make a spinner visible — a fabricated delay would be a fake backend
 * loading state, which is exactly what this prototype must not have.
 */
export type ReportSaveState = "saved" | "dirty" | "saving" | "unavailable";

/** Calm, not chatty: we wait for the typing to settle before touching storage. */
export const SAVE_DEBOUNCE_MS = 600;

export const SAVE_STATE_LABEL: Record<ReportSaveState, string> = {
  saved: "Черновик сохранён в этом браузере.",
  dirty: "Есть несохранённые изменения.",
  saving: "Сохраняется в этом браузере.",
  unavailable: "Локальное сохранение недоступно.",
};

export interface ReportDraftController {
  draft: ReportDraft;
  saveState: ReportSaveState;
  /** Apply a pure transition from `report-draft.ts`. Never mutates. */
  update: (next: ReportDraft) => void;
  /** Commit immediately, bypassing the debounce (used by submit). */
  flush: (next: ReportDraft) => boolean;
}

/** Storage does not change under us within this tab, so there is nothing to watch. */
const subscribe = () => () => {};

const EMPTY_SNAPSHOT = serializeReportWorkspace(emptyReportWorkspace());

/**
 * The browser-local report draft (Phase D3-B).
 *
 * Hydration follows the `LessonSessionGate` precedent (DD-256): the persisted
 * draft is read through `useSyncExternalStore`, whose SERVER snapshot is an
 * empty workspace — the only thing the server can honestly know. React uses that
 * same value while hydrating and swaps in the real one after, so the markup
 * matches and there is never a frame showing someone else's answer. Reading it
 * in an effect and calling setState would achieve the same picture by fighting
 * the render model instead of using it.
 *
 * Local edits layer ON TOP of that snapshot: once the user types, `local` is the
 * truth and the snapshot is only a starting point.
 *
 * Autosave writes only when something actually changed — never on every render.
 */
export function useReportDraft(definition: ReportDefinition): ReportDraftController {
  const getSnapshot = useCallback(
    () => serializeReportWorkspace(createReportStore().read()),
    [],
  );
  const getServerSnapshot = useCallback(() => EMPTY_SNAPSHOT, []);
  const rawWorkspace = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Whether this environment can persist at all. Server-side we assume it can,
  // so the first paint does not accuse a browser of something before we know.
  const durable = useSyncExternalStore(
    subscribe,
    useCallback(() => createReportStore().durable, []),
    useCallback(() => true, []),
  );

  const stored = useMemo(() => {
    const workspace = parseReportWorkspace(rawWorkspace, getReportDefinition);
    return getStoredDraft(workspace, definition.level.number);
  }, [rawWorkspace, definition.level.number]);

  const [local, setLocal] = useState<ReportDraft | null>(null);
  const [writeState, setWriteState] = useState<ReportSaveState>("saved");

  const draft = local ?? stored ?? createEmptyDraft(definition);

  // The revision we have already written. Guards against re-saving an unchanged
  // draft when an unrelated re-render happens.
  const savedRevision = useRef<number | null>(null);

  const commit = useCallback(
    (next: ReportDraft): boolean => {
      const store = createReportStore();
      if (!store.durable) return false;
      const ok = store.write(withDraft(store.read(), next));
      savedRevision.current = next.revision;
      // A rejected write (quota, blocked origin) is NOT "unsaved changes" the
      // user can fix by waiting — local saving is simply not working, and the
      // interface says so rather than implying the next keystroke will help.
      setWriteState(ok ? "saved" : "unavailable");
      return ok;
    },
    [],
  );

  const update = useCallback((next: ReportDraft) => {
    setLocal(next);
    setWriteState("dirty");
  }, []);

  const flush = useCallback(
    (next: ReportDraft): boolean => {
      setLocal(next);
      setWriteState("saving");
      return commit(next);
    },
    [commit],
  );

  // Debounced autosave. Keyed on the revision counter rather than on the draft
  // object: an identity-only change must not cost a write.
  const revision = local?.revision ?? null;
  useEffect(() => {
    if (!durable) return;
    if (local === null) return;
    if (revision === savedRevision.current) return;

    const id = window.setTimeout(() => {
      setWriteState("saving");
      commit(local);
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [local, revision, durable, commit]);

  const saveState: ReportSaveState = durable ? writeState : "unavailable";

  return { draft, saveState, update, flush };
}
