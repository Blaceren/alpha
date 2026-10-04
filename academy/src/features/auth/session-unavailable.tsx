import Link from "next/link";
import "@/features/academy-experience/experience.css";

/**
 * «Нет связи с Академией» — the guard's answer when the Backend could not say
 * whether the learner is signed in (2026-10-04, launch audit).
 *
 * It used to be a redirect to /login: a ten-second hiccup looked like being
 * signed out, and signing in failed too. The session is not touched here — no
 * cookie is cleared, nothing is written — so the retry is the same page,
 * fetched again. Nothing protected is rendered: the layout shows this INSTEAD
 * of its children.
 */
export function SessionUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <main className="ax-page" id="main">
      <div className="ax">
        <div className="ax-empty" role="alert">
          <h1>Нет связи с Академией</h1>
          <p>
            Сервер не ответил вовремя, поэтому страница не открылась. Ваш вход и прогресс на месте —
            попробуйте ещё раз через минуту.
          </p>
          <p className="ax-actions">
            {/* A plain link, not a client transition: the whole page, guard
                included, is asked again. */}
            <a className="ax-cta" href={retryHref}>
              Повторить
            </a>
            <Link className="ax-cta ax-cta--quiet" href="/">
              На главную
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
