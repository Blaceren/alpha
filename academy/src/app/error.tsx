"use client";

/**
 * Root failure boundary (2026-10-04, launch audit).
 *
 * The `(app)` group has its own boundary; a failure anywhere else — the sign-in
 * and registration pages, recovery, the news — fell through to the framework's
 * default page, in English, with no way back. This is the same sentence the
 * product says inside the shell, on the 404's ground: what happened in the
 * learner's words, that nothing they did is lost, and two ways forward. The
 * server's own text and the digest stay out of the page — they are for the log.
 */
import Link from "next/link";
import { useEffect } from "react";
import "@/features/academy-experience/experience.css";
import "@/styles/states-hifi.css";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("academy page error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="ax-page">
      <div className="ax">
        <div className="ax-empty" role="alert">
          <h1>Страница не загрузилась</h1>
          <p>Что-то пошло не так на нашей стороне. Ваши данные не затронуты — попробуйте ещё раз.</p>
          <p className="ax-actions">
            <button type="button" className="ax-cta" onClick={reset}>
              Попробовать ещё раз
            </button>
            <Link className="ax-cta ax-cta--quiet" href="/">
              На главную
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
