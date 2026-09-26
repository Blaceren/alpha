"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getLevel, getModuleForLevel } from "@/data/curriculum/fixture";
import {
  getPathProgress,
  type PathScenario,
} from "@/features/path/model/path-state";
import { effectiveProgress } from "@/features/lessons-library/model/lessons-library-model";
import { useSessionProgress } from "@/features/lessons-library/hooks/use-session-progress";
import { useReportWorkspace } from "@/features/report-level/hooks/use-report-workspace";
import { sessionWithApprovedReports } from "@/features/report-level/model/report-progression";
import { computeVisibleWindow } from "@/features/path/model/visible-window";
import { usePathKeyboard } from "@/features/path/hooks/use-path-keyboard";
import { PathHeader } from "@/features/path/components/path-header";
import { ModuleNavigator } from "@/features/path/components/module-navigator";
import { PathViewport } from "@/features/path/components/path-viewport";
import { PathDetailLayer } from "@/features/path/components/path-detail-layer";
import { PathAccessibleOutline } from "@/features/path/components/path-accessible-outline";

/**
 * The Path workspace (Phase D2A). Client component: selection, module window,
 * detail layer, keyboard navigation. All data comes from the typed curriculum
 * fixture through the scenario adapter — no backend, no stored progress.
 */
export function PathWorkspace({ scenario }: { scenario: PathScenario }) {
  const marker = getPathProgress(scenario);
  // Session completions and APPROVED reports (D3-D) advance the marker through the
  // SAME shared helpers the library uses — no special "after approved open L4"
  // rule. Under the canonical profile (Артём on L18) both are no-ops, so the path
  // is unchanged; under the report scenario an approved L3 moves the current step
  // to the L4 checkpoint via the real resolver.
  const session = useSessionProgress();
  const reports = useReportWorkspace();
  const progress = useMemo(
    () => effectiveProgress(marker, sessionWithApprovedReports(session, reports)),
    [marker, session, reports],
  );
  const currentModuleIndex = getModuleForLevel(progress.currentLevel).index;

  const [moduleIndex, setModuleIndex] = useState(currentModuleIndex);
  const [selectedLevel, setSelectedLevel] = useState(progress.currentLevel);
  const [detailOpen, setDetailOpen] = useState(false);
  /** Set when the selection changed via keyboard → focus follows the node. */
  const focusPending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const win = computeVisibleWindow(moduleIndex, progress);

  // Handlers are plain functions — the React Compiler memoizes them; manual
  // useCallback here conflicts with react-hooks/preserve-manual-memoization.
  const selectModule = (index: number) => {
    setModuleIndex(index);
    // Selection follows the window: pick the module's most relevant level.
    const mod = computeVisibleWindow(index, progress).layout.module;
    if (progress.currentLevel >= mod.startLevel && progress.currentLevel <= mod.endLevel) {
      setSelectedLevel(progress.currentLevel);
    } else {
      setSelectedLevel(mod.startLevel);
    }
  };

  const selectLevel = (levelNumber: number) => {
    setSelectedLevel(levelNumber);
    setModuleIndex(getModuleForLevel(levelNumber).index);
    setDetailOpen(true);
  };

  const moveSelection = (levelNumber: number) => {
    setSelectedLevel(levelNumber);
    setModuleIndex(getModuleForLevel(levelNumber).index);
    focusPending.current = true;
  };

  const returnToCurrent = () => {
    setModuleIndex(currentModuleIndex);
    setSelectedLevel(progress.currentLevel);
    focusPending.current = true;
  };

  // Closing the detail returns focus to the selected node (focus is never lost).
  const closeDetail = () => {
    setDetailOpen(false);
    focusPending.current = true;
  };

  const onKeyDown = usePathKeyboard({
    selectedLevel,
    onMoveSelection: moveSelection,
    onOpenDetail: () => setDetailOpen(true),
    onCloseDetail: closeDetail,
    onReturnToCurrent: returnToCurrent,
  });

  // Keyboard selection / detail close: focus follows the selected node.
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>(`.pnode[data-level="${selectedLevel}"]`)
      ?.focus();
  }, [selectedLevel, moduleIndex, detailOpen]);

  const awayFromCurrent =
    moduleIndex !== currentModuleIndex || selectedLevel !== progress.currentLevel;

  // Escape closes the detail layer from anywhere inside the workspace
  // (the viewport handles the full key set; this catches focus in the layer).
  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") closeDetail();
  };

  return (
    <div className="path-page" ref={rootRef} onKeyDown={onRootKeyDown}>
      <PathHeader progress={progress} showReturn={awayFromCurrent} onReturn={returnToCurrent} />

      <ModuleNavigator selectedIndex={moduleIndex} progress={progress} onSelect={selectModule} />

      <div className={`path-body${detailOpen ? " detail-open" : ""}`}>
        <PathViewport
          window={win}
          progress={progress}
          selectedLevel={selectedLevel}
          detailOpen={detailOpen}
          onSelectLevel={selectLevel}
          onSelectModule={selectModule}
          onKeyDown={onKeyDown}
        />
        {detailOpen && (
          <>
            {/* Mobile-only scrim: separates the opaque sheet from the workspace
                without blur/glassmorphism. Tapping it closes the layer — a
                redundant affordance, so it stays out of the accessibility tree
                (Escape and the close button are the real controls). */}
            <div className="path-scrim" aria-hidden="true" onClick={closeDetail} />
            <PathDetailLayer
              level={getLevel(selectedLevel)}
              progress={progress}
              onClose={closeDetail}
            />
          </>
        )}
      </div>

      <PathAccessibleOutline selectedModuleIndex={moduleIndex} progress={progress} />
    </div>
  );
}
