"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/** Root error boundary (App Router). Must be a client component. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // In a real app this would report to an error sink; Phase 1A logs only.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div
        role="alert"
        className="w-full max-w-md rounded-lg border border-danger/30 bg-surface p-6 text-center"
      >
        <h1 className="text-base font-semibold text-text-primary">Что-то пошло не так</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Произошла непредвиденная ошибка в интерфейсе. Попробуйте повторить.
        </p>
        <Button className="mt-4" onClick={reset}>
          Повторить
        </Button>
      </div>
    </div>
  );
}
