"use client";

/**
 * Keyboard navigation for the Route Field (§17 D2A):
 *  ←/→  — move the selection to the neighbouring level (crossing module
 *          boundaries switches the visible module window);
 *  Enter/Space — open the detail layer for the selected level;
 *  Escape — close the detail layer;
 *  Home — return to the current level.
 * Focus follows the selection (the workspace focuses the selected node).
 */
export function usePathKeyboard({
  selectedLevel,
  onMoveSelection,
  onOpenDetail,
  onCloseDetail,
  onReturnToCurrent,
}: {
  selectedLevel: number;
  onMoveSelection: (levelNumber: number) => void;
  onOpenDetail: () => void;
  onCloseDetail: () => void;
  onReturnToCurrent: () => void;
}) {
  // Plain handler — the React Compiler memoizes it (manual useCallback would
  // trip react-hooks/preserve-manual-memoization under the compiler).
  return (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        if (selectedLevel < 100) onMoveSelection(selectedLevel + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (selectedLevel > 1) onMoveSelection(selectedLevel - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onOpenDetail();
        break;
      case "Escape":
        e.preventDefault();
        onCloseDetail();
        break;
      case "Home":
        e.preventDefault();
        onReturnToCurrent();
        break;
    }
  };
}
