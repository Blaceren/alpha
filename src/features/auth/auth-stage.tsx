import type { ReactNode } from "react";
import Link from "next/link";
import "@/features/auth/auth-stage.css";

/**
 * THE ONE STAGE BOTH AUTH PAGES STAND ON.
 *
 * WHAT IT REPLACES. `/login` and `/register` each rendered a 400px card
 * centred in an empty field, and each opened with the words «Alfa Trade
 * Academy» set as a paragraph — a text imitation of a mark the product already
 * owns as a file. On a 1440px display the result was a small box adrift in a
 * large void, and the page it belonged to was unrecognisable as the same
 * product as Public Home or the Academy behind it.
 *
 * WHAT IT IS. One composition, shared, so the two pages cannot drift apart
 * again: a brand axis and a form area that read as a single scene. The mark is
 * the accepted `/brand/ata-logo.svg`, and it is a link to `/` — the same
 * destination and the same asset the authenticated shell uses, so a visitor who
 * arrives here can always get back to the public page.
 *
 * WHAT IT DOES NOT DO. It holds no form logic and no state. Everything about
 * authentication — the fields, their names, their autocomplete, the endpoints,
 * the Turnstile token, the session cookie, the `next` contract, every error and
 * every guard — belongs to the form components and is untouched. This is the
 * room; the forms are unchanged.
 *
 * NO NEW MARKETING COPY. The lead and the supporting line are the pages' own
 * existing words. A sign-in page is not a place to start selling.
 */
export function AuthStage({
  headingId,
  title,
  lead,
  children,
}: {
  headingId: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="auth">
      <div className="auth__stage">
        {/* The brand axis. On a wide viewport it sits beside the form; on a
            narrow one it stacks above it. It carries the mark and nothing that
            competes with the form for attention. */}
        <div className="auth__axis">
          <Link className="auth__mark" href="/" aria-label="Alfa Trade Academy — на главную">
            {/* eslint-disable-next-line @next/next/no-img-element -- the asset of
                record, served from public/, sized by CSS; the optimiser would
                add a remote-looking URL to a page that must have none. */}
            <img src="/brand/ata-logo.svg" alt="" width={362} height={200} />
          </Link>
          <p className="auth__axis-line" aria-hidden="true" />
        </div>

        <section className="auth__panel" aria-labelledby={headingId}>
          <h1 id={headingId} className="auth__title">
            {title}
          </h1>
          <p className="auth__lead">{lead}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
