"use client";

import Link from "next/link";
import { X } from "lucide-react";

/**
 * «×» — close the tool.
 *
 * The tool was opened in a tab of its own, so closing means closing that tab.
 * A browser only lets a page close a tab it opened itself or one with no
 * history behind it; when it refuses, the learner still gets somewhere sensible,
 * the tools page, because the control is a real link to it.
 */
export function ToolCloseButton() {
  return (
    <Link
      href="/tools"
      className="tw-close"
      aria-label="Закрыть инструмент"
      onClick={(event) => {
        // A tab with history behind it cannot be closed by the page: follow the link.
        if (window.history.length > 1) return;
        event.preventDefault();
        window.close();
        // Still here a moment later: the browser kept the tab. Go to the tools page.
        setTimeout(() => window.location.assign("/tools"), 150);
      }}
    >
      <X aria-hidden="true" size={18} strokeWidth={1.75} />
    </Link>
  );
}
