import {
  AVAILABILITY,
  EXIT_LABEL,
  type AvailabilityClass,
  type ExitId,
} from "@/features/reader-fidelity/reader-state";
import Link from "next/link";
import "@/features/reader-fidelity/reader-fidelity.css";

/**
 * THE FIVE REASONS A MATERIAL IS NOT READABLE, kept apart on purpose.
 *
 * The frozen Reader refuses to collapse them into one "unavailable" page, and
 * the refusal is the design: a checkpoint has no text and never will, an
 * unpublished lesson will have one later, a locked level is about the learner's
 * position, a transient failure is worth retrying, and a bad address is not
 * about the programme at all. Each also exits somewhere different, because the
 * next useful place differs.
 *
 * IDENTITY IS DISCLOSED ONLY AS FAR AS THE CLASS ALLOWS. A locked level shows
 * its address but never its title — the learner has not reached it, and naming
 * it would disclose exactly what the lock withholds. An invalid address shows
 * no identity at all, because there is no level to identify.
 */
export function ReaderUnavailable({
  availability,
  levelHref,
  identity,
}: {
  availability: AvailabilityClass;
  levelHref?: string;
  identity?: {
    moduleOrder: number | null;
    levelOrder: number;
    typeLabel: string;
    title: string | null;
  };
}) {
  const state = AVAILABILITY[availability];
  const kicker = identity
    ? [
        identity.moduleOrder !== null
          ? `МОДУЛЬ ${String(identity.moduleOrder).padStart(2, "0")}`
          : null,
        `УРОВЕНЬ ${identity.levelOrder}`,
        identity.typeLabel.toUpperCase(),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const href = (exit: ExitId): string =>
    exit === "lessons" ? "/lessons" : exit === "path" ? "/path" : (levelHref ?? "/lessons");

  return (
    <div className="rdr">
      <div className="avail">
        {kicker ? <p className="kicker">{kicker}</p> : null}
        {identity?.title ? <p className="subtitle">{identity.title}</p> : null}
        <h1>{state.heading}</h1>
        <p className="avail__text">{state.text}</p>
        <nav className="exits" aria-label="Выходы">
          {state.exits.map((exit) => (
            <Link key={exit} href={href(exit)}>
              {EXIT_LABEL[exit]}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
