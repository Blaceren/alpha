import type { ReactNode } from "react";

/** Renders content available to screen readers but hidden visually. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        borderWidth: 0,
      }}
    >
      {children}
    </span>
  );
}
