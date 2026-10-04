import Link from "next/link";
import type { ProgramPosition } from "@/lib/curriculum/program-points";
import type { ToolWindowView } from "@/features/tool-windows/model/access";
import { initials, profileFacts, ringModel } from "@/features/profile-fidelity/profile-record";
import { LocalDay } from "@/features/profile-fidelity/local-day";

/**
 * PROFILE, HI-FI — the passport (DD-337).
 *
 * Who the learner is and how far they have come, at the top of every part of
 * the profile: the initials inside THE RING (the program line closed around
 * them — a stretch per module, lit as far as the learner has come, the current
 * level a Signal point on it), the name, the address, the day the account was
 * made, and four counts.
 *
 * The name here is the server's, like the shell's avatar; after a confirmed
 * change the page refreshes and both follow.
 */
export type PassportAccount = {
  readonly email: string | null;
  /** Shown only where the Backend can confirm an address; elsewhere it would ask for what nobody can do. */
  readonly verified: boolean | null;
  readonly memberSince: string | null;
};

export function ProfilePassport({
  name,
  account,
  position,
  tools,
}: {
  name: string;
  account: PassportAccount;
  position: ProgramPosition | null;
  tools: readonly ToolWindowView[] | null;
}) {
  const facts = profileFacts(position, tools);
  return (
    <section className="pp" aria-label="Учётная запись">
      <div className="pp-id">
        <ProfileRing name={name} position={position} />
        <div className="pp-who">
          <p className="pp-name" data-role="passport-name">
            {name}
          </p>
          {account.email ? (
            <p className="pp-mail">
              <span className="pp-mail__address">{account.email}</span>
              {account.verified !== null ? (
                <span className="pp-mail__state"> · {account.verified ? "подтверждён" : "не подтверждён"}</span>
              ) : null}
            </p>
          ) : null}
          {account.memberSince ? (
            <p className="pp-since">
              В Академии с <LocalDay iso={account.memberSince} />
            </p>
          ) : null}
        </div>
      </div>
      {facts.length > 0 ? (
        <div className="pp-record">
          <dl className="pp-facts">
            {facts.map((fact) => (
              <div className="pp-fact" key={fact.key} data-fact={fact.key}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <Link className="pp-path" href="/path">
            Открыть путь
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function ProfileRing({ name, position }: { name: string; position: ProgramPosition | null }) {
  const ring = position ? ringModel(position) : { modules: [], current: null };
  return (
    <div className="pp-ring" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="pp-ring__svg" focusable="false">
        {ring.modules.length === 0 ? <circle className="pp-ring__empty" cx="60" cy="60" r="54" /> : null}
        {ring.modules.map((module, index) => (
          <g key={index}>
            <path d={module.track} className={module.preparing ? "pp-ring__track pp-ring__track--preparing" : "pp-ring__track"} />
            {module.lit ? <path d={module.lit} className="pp-ring__lit" /> : null}
          </g>
        ))}
        {ring.current ? (
          <>
            <circle className="pp-ring__halo" cx={ring.current.x} cy={ring.current.y} r="8" />
            <circle className="pp-ring__point" cx={ring.current.x} cy={ring.current.y} r="4.5" />
          </>
        ) : null}
      </svg>
      <span className="pp-ring__initials">{initials(name)}</span>
    </div>
  );
}
