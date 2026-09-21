"use client";

import { useState, type ReactNode } from "react";

/** «Показать, как будет выглядеть» — reveals the example the server rendered. */
export function ToolPreviewToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="tw-preview-cta">
        <button type="button" className="tw-button" data-variant="outline" onClick={() => setOpen(true)}>
          Показать, как будет выглядеть
        </button>
      </div>
    );
  }

  return (
    <section className="tw-preview" aria-labelledby="tool-preview-title">
      <div className="tw-preview__head">
        <h2 className="tw-label" id="tool-preview-title">
          Пример данных
        </h2>
        <button type="button" className="tw-link-button" onClick={() => setOpen(false)}>
          Скрыть пример
        </button>
      </div>
      {children}
    </section>
  );
}
