/**
 * XP-L1-FEEDBACK (minimum viable) — the learner is TOLD their Pocket
 * registration was received.
 *
 * WHY IT EXISTS. Before this, a confirmed registration was only *implied*: the
 * action section disappeared and the level state label changed. Nothing said
 * plainly "Pocket confirmed it, the level closed, here is your next step" — so
 * the first real learner to complete L1 would have been told nothing, and the
 * most predictable support question ("я зарегистрировался — сработало?") had
 * no product answer. Pulled into the REG activation wave for exactly that
 * reason; the full notification system stays in its own later wave.
 *
 * WHAT IT NEVER DOES. It renders a server-derived fact and one navigation
 * affordance. It completes nothing, writes nothing, polls nothing, shows no
 * balance and no money, and it cannot appear unless the Backend itself reports
 * the level `completed` — the only authority on that state.
 */
import Link from "next/link";
import "@/features/pocket-registration/pocket-registration.css";

export function PocketRegistrationConfirmed({
  nextLevelCode,
}: {
  nextLevelCode: string | null;
}) {
  return (
    <section
      className="pocket-reg pocket-reg--confirmed"
      aria-labelledby="pocket-reg-confirmed-title"
      data-phase="confirmed"
    >
      <h2 id="pocket-reg-confirmed-title" className="pocket-reg__title">
        Регистрация в Pocket подтверждена
      </h2>
      <p className="pocket-reg__explain">
        Pocket подтвердил твою регистрацию, и уровень закрылся автоматически.
        Ничего отмечать вручную не нужно.
      </p>
      {nextLevelCode !== null ? (
        <p className="pocket-reg__next">
          <Link
            className="pocket-reg__action pocket-reg__action--link"
            href={`/lessons/${encodeURIComponent(nextLevelCode)}`}
          >
            Перейти к следующему уровню
          </Link>
        </p>
      ) : null}
    </section>
  );
}
