"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  COPY,
  presenceFor,
  toRecord,
  type NotificationRecord,
  type NotificationRow,
  type PresenceState,
} from "@/features/notifications-fidelity/notifications-state";
import "@/features/notifications-fidelity/notifications-fidelity.css";

/**
 * NOTIFICATIONS — the frozen NotationLedger surface, on the real register.
 *
 * VISUAL AUTHORITY: NotificationsATA @ c73b854446b8d6016a570d4cc5b60ba358c71409 —
 * `system/tokens.css`, `system/notifications.css` and the Phase-3 component
 * renderers in `system/components.js`. The composition order is the one the
 * architecture requires and states in words:
 *
 *     identity → action presence → application state → register → retrieval
 *
 * DATA AUTHORITY: the product. Every row is a Backend `Notification`, read
 * through the same-origin proxy that was already audited and bounded. Not one
 * value from the Phase-4 fixture file is here.
 *
 * WHY THIS IS STILL A CLIENT COMPONENT. The frozen system specifies LOADING and
 * FAILURE as first-class states of the surface, with a skeleton shaped like the
 * content that is coming and a recovery control that re-requests. Those states
 * only exist where the request does, so the request stays in the browser —
 * exactly as the deployed product already did it. Server-rendering the register
 * would delete two of the four states the design is built around.
 *
 * WHAT IS DELIBERATELY NOT CARRIED ACROSS, AND WHY:
 *
 *   * THE RETRIEVAL CONTROL. The frozen page offers «Показать более ранние».
 *     The Backend list route is `take: 50` with no cursor and no total, so the
 *     control could only ever be a button that does nothing. The frozen system's
 *     own rule is that a handoff "never a control that does nothing"; a
 *     retrieval control with no retrieval behind it is the same defect. It
 *     returns when the Backend can page.
 *
 *   * THE READ TRANSITION. The frozen read-semantics document selects
 *     "meaningful learner exposure" as the UNREAD → READ mechanic — and that
 *     document is explicitly a CANDIDATE, not frozen. Implementing it would
 *     write to the live PREPROD database on page view, which this phase is
 *     forbidden from doing, and would ship an unfrozen behavioural decision
 *     under cover of a visual restoration. Consumption is therefore RENDERED
 *     from the real `readAt` and never changed from here. The two BFF write
 *     operations stay unused, as they already were.
 *
 *   * THE PROTOTYPE'S OWN SHELL. `design/shell.js` is imported by the frozen
 *     page; the product keeps the accepted AppShell, which supplies the one
 *     `<main>` landmark and the one skip link.
 */
/*
 * THE LAST-KNOWN REGISTER IS NOT MODELLED, AND THAT IS A FINDING, NOT AN
 * OMISSION.
 *
 * The frozen system has a state for "the refresh failed, so what you are
 * looking at is the last thing we knew" — `data-confidence="last-known"` on the
 * register, with the staleness stated in words by the failure block above it.
 * It is a good state and its rules are carefully drawn.
 *
 * It is also unreachable here. This surface issues exactly ONE request per
 * mount, and the only control that re-requests is the recovery button inside
 * the failure block — which exists only when there was nothing to keep. A
 * register can therefore never go stale while it is on screen: either the first
 * request succeeded and nothing re-requests, or it failed and there is no
 * register at all. Navigating away and back remounts and asks again.
 *
 * So the branch is not implemented. Writing one would be writing a state that
 * cannot happen and cannot be tested — which is worse than not having it. If a
 * refresh affordance is ever added (visibility change, polling, a control in the
 * success state), the frozen semantics come back with it, unchanged: the mark
 * goes on the CONTAINER, exactly once, and it carries no visual reduction.
 */
type Load =
  | { phase: "loading" }
  | { phase: "ready"; records: NotificationRecord[]; suppressed: number }
  | { phase: "failed" };

const PAGE_TITLE_ID = "notifications-title";

/**
 * The request, as a plain async function that RETURNS the next state instead of
 * setting it. Keeping the state update out of here is what lets the mount
 * effect stay a pure subscription — it awaits, then commits once, and nothing
 * sets state synchronously inside an effect body.
 */
async function requestRegister(): Promise<Load> {
  try {
    const res = await fetch("/api/backend/notifications", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { items?: NotificationRow[] };
    const rows = data.items ?? [];
    const now = new Date();
    const records = rows
      .map((row) => toRecord(row, now))
      .filter((r): r is NotificationRecord => r !== null);
    return { phase: "ready", records, suppressed: rows.length - records.length };
  } catch {
    return { phase: "failed" };
  }
}

export function NotificationsFidelity() {
  const [load, setLoad] = useState<Load>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await requestRegister();
      if (alive) setLoad(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const retry = useCallback(() => {
    setLoad({ phase: "loading" });
    void requestRegister().then(setLoad);
  }, []);

  const records = load.phase === "ready" ? load.records : null;
  const requestState = load.phase === "ready" ? "SUCCESS" : load.phase === "failed" ? "FAILURE" : "LOADING";
  const presence: PresenceState = presenceFor(requestState, records?.length ?? 0);

  return (
    <div className="nt" data-nt-root>
      <div className="n-page">
        <div className="n-page__inner">
          <h1 className="n-page__title" id={PAGE_TITLE_ID}>
            {COPY.title}
          </h1>

          <ActionPresence state={presence} />

          {load.phase === "failed" ? (
            <div className="n-state n-state--failure n-grid" role="alert">
              <span className="n-state__notation">
                <span className="n-state__bar" aria-hidden="true" />
              </span>
              <div className="n-state__body">
                <p className="n-state__lead">{COPY.failureLead}</p>
                <p className="n-state__support">{COPY.failureReasonCold}</p>
                <button type="button" className="n-control n-recover" onClick={retry}>
                  {COPY.failureRecovery}
                </button>
              </div>
            </div>
          ) : null}

          {load.phase === "loading" ? <Skeleton rows={3} /> : null}

          {records && records.length > 0 ? (
            <ul className="n-register" aria-label={COPY.registerLabel}>
              {records.map((record) => (
                <Record key={record.id} record={record} />
              ))}
            </ul>
          ) : null}

          {load.phase === "ready" && records!.length === 0 ? (
            <div className="n-state n-state--empty n-grid">
              <span className="n-state__notation" />
              <div className="n-state__body">
                <p className="n-state__lead">{COPY.emptyLead}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The page-level answer to «требуется ли от меня что-то теперь?».
 *
 * WITHHELD renders nothing, deliberately. A "we could not check" statement is
 * still a statement, and the architecture withholds the claim rather than
 * narrating its own uncertainty at page level.
 */
function ActionPresence({ state }: { state: PresenceState }) {
  if (state === "WITHHELD") return null;
  const mode = state === "NONE_SCOPED" ? "none" : "present";
  const copy = state === "NONE_SCOPED" ? COPY.presenceNone : null;
  if (!copy) return null;
  return (
    <div className="n-presence n-grid" data-presence={mode}>
      <span className="n-presence__notation">
        <span className="n-presence__mark" aria-hidden="true" />
      </span>
      <p className="n-presence__text">{copy}</p>
    </div>
  );
}

/**
 * One record: notation cell, content cell.
 *
 * THE ROW IS NOT A TARGET. The handoff is one explicit labelled control, and
 * the record itself is undecorated prose — no border, no background, no
 * container. Both are accepted rulings of the direction, not preferences.
 *
 * NO SIGNAL MARK IS EVER RENDERED HERE. It would require a confirmed
 * current-action claim, and the product has no source of one. Absence of a mark
 * is absence of a claim, never a claim of absence.
 */
function Record({ record }: { record: NotificationRecord }) {
  const consumptionWord = record.consumption === "UNREAD" ? "Не прочитано" : "Прочитано";
  return (
    <li
      className="n-record n-grid"
      data-id={record.id}
      data-consumption={record.consumption}
      data-consequence={record.consequence}
      data-actionability={record.actionability}
      data-destination={record.destination}
      data-action-confirmed="0"
    >
      <div className="n-record__notation">
        <time className="n-time" dateTime={record.timeMachine}>
          {record.time}
        </time>
        <span className="n-marks">
          {record.consumption === "UNREAD" ? (
            <>
              <span className="n-mark--unread" aria-hidden="true" />
              <span className="sr-only">не прочитано</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="n-record__body">
        <p className="n-record__statement">
          {record.change}
          <span className="sr-only"> — {consumptionWord}</span>
        </p>
        {record.reason ? <p className="n-record__support">{record.reason}</p> : null}
        <p className="n-record__meta">{record.context}</p>
        <div className="n-record__act">
          {record.handoff ? (
            <Link className="n-action" href={record.handoff.href}>
              {record.handoff.label}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Placeholders shaped like the content that is coming, so the state reads as
 * NOT YET CONTENT rather than as an empty register.
 *
 * No animation: a register of record does not perform while it waits. Announced
 * to assistive technology rather than shown to it.
 */
function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">{COPY.loadingAnnouncement}</span>
      <div className="n-skeleton__presence n-grid" aria-hidden="true">
        <div className="n-skeleton__notation">
          <span className="n-bone n-bone--mark" />
        </div>
        <div className="n-skeleton__body">
          <span className="n-bone n-bone--presence" />
        </div>
      </div>
      <div className="n-skeleton">
        {Array.from({ length: rows }, (_, i) => (
          <div className="n-skeleton__row n-grid" aria-hidden="true" key={i}>
            <div className="n-skeleton__notation">
              <span className="n-bone n-bone--time" />
              <span className="n-bone n-bone--mark" />
            </div>
            <div className="n-skeleton__body">
              <span className="n-bone n-bone--statement" />
              <span className="n-bone n-bone--support" />
              <span className="n-bone n-bone--meta" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
