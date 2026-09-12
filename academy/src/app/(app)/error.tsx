"use client";

/**
 * App-level failure boundary.
 *
 * It shows the learner a sentence they can act on and never the server's own
 * text: an upstream message is an internal concept leaking into learner
 * language, and it is not actionable for the person reading it. The digest stays
 * out of the UI for the same reason — it is for the log, not the learner.
 */
import { useEffect } from "react";
import "@/features/academy-experience/experience.css";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("academy route error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="ax">
      <div className="ax-error" role="alert">
        <h2>Страница не загрузилась</h2>
        <p>
          Что-то пошло не так на нашей стороне. Ваш прогресс не затронут — попробуйте открыть
          страницу ещё раз.
        </p>
        <p style={{ marginTop: 22 }}>
          <button type="button" className="ax-cta ax-cta--quiet" onClick={reset}>
            Попробовать ещё раз
          </button>
        </p>
      </div>
    </div>
  );
}
