"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * «Не удалось загрузить инструменты» — a failed read, said as one (2026-10-04,
 * launch audit). It used to look exactly like six closed tools. The retry
 * re-runs the server render; nothing loops on its own.
 */
export function ToolsReadFailed({ titleLevel = "h2" }: { titleLevel?: "h1" | "h2" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const Title = titleLevel;
  return (
    <div className="tw-quiet" role="alert">
      <Title className="tw-quiet__title">Не удалось загрузить инструменты</Title>
      <p className="tw-quiet__line">
        Сервер не ответил, поэтому мы не можем показать, что у вас открыто. Ваши записи на месте —
        повторите через минуту.
      </p>
      <button
        type="button"
        className="tw-button"
        data-variant="outline"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          router.refresh();
          setTimeout(() => setBusy(false), 1500);
        }}
      >
        {busy ? "Обновляем…" : "Повторить"}
      </button>
    </div>
  );
}
