"use client";

import { useCallback, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { getReportDefinition } from "@/features/report-level/data/report-fixtures";
import { createReportStore } from "@/features/report-level/model/report-store";
import {
  emptyReportWorkspaceV3,
  parseReportWorkspaceV3,
  serializeReportWorkspaceV3,
  type ReportWorkspaceStateV3,
} from "@/features/report-level/model/report-workspace-v3";

/**
 * Read-only view of the browser-local report workspace, safe for SSR (D3-B;
 * v2 storage since D3-C — the store's read() performs the v1→v2 migration read,
 * so legacy drafts surface here without any extra step).
 *
 * Used by the surfaces that only DISPLAY a report status — the lessons library
 * and the path — so they never own a copy of the storage logic.
 *
 * The snapshot is the SERIALISED string, not the parsed object: the store builds
 * a fresh object on every `read()`, and `useSyncExternalStore` compares snapshots
 * by identity, so returning the object directly would re-render forever. A string
 * is stable by value. (`useSessionProgress` solves the same problem the same way.)
 *
 * Hydration: the server snapshot is an empty workspace — the only thing the
 * server can honestly know — so the server renders the no-report default and the
 * client swaps in the real one after mount, with no mismatch.
 */
const subscribe = () => () => {};

const EMPTY_SNAPSHOT = serializeReportWorkspaceV3(emptyReportWorkspaceV3());

export function useReportWorkspace(): ReportWorkspaceStateV3 {
  const getSnapshot = useCallback(
    () => serializeReportWorkspaceV3(createReportStore().read()),
    [],
  );
  const getServerSnapshot = useCallback(() => EMPTY_SNAPSHOT, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => parseReportWorkspaceV3(raw, getReportDefinition), [raw]);
}
