"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalSession } from "@/features/auth/use-session";
import { closeAccountSession, listAccountSessions, type AccountSession } from "@/lib/api/client";

/**
 * «Сеансы» — the account's live sessions, at the bottom of the profile (owner
 * 2026-10-07: «Сделай что бы можно было иметь 2 активных сеанса в 1 аккаунте и в
 * профиле снизу есть сеансы они должны быть там показаны и возможность закрыть
 * сеанс с другого сеанса»).
 *
 * Two may be live. Each is a row: the device by name, when it signed in and was
 * last used, and one action — signing out for this browser (the same server
 * logout the shell's «Выйти» runs), closing for the other, after one more
 * question. The list comes from the Backend's own answer and carries no token.
 *
 * Signing out never depends on the list: while it loads, or if it cannot be
 * read, this browser's row is still drawn with its action. Without a real
 * session (the fixture prototype) there is nothing to show and nothing is drawn.
 */
export const SESSIONS_COPY = {
  section: "Сеансы",
  intro:
    "Войти в аккаунт можно с двух устройств одновременно. При входе с третьего завершится сеанс, которым дольше всего не пользовались.",
  thisBrowser: "Этот браузер",
  exit: "Выйти из аккаунта",
  exitBusy: "Выход…",
  close: "Завершить сеанс",
  confirm: "Завершить сеанс на этом устройстве?",
  confirmYes: "Завершить",
  confirmNo: "Отмена",
  closing: "Завершение…",
  closed: "Сеанс завершён. На том устройстве нужно будет войти снова.",
  closeFailed: "Не удалось завершить сеанс. Попробуйте ещё раз.",
  alreadyClosed: "Этот сеанс уже завершён.",
  failed: "Не удалось загрузить список сеансов.",
  retry: "Повторить",
  unknownDevice: "Неизвестное устройство",
} as const;

const KIND_WORD: Record<NonNullable<AccountSession["device"]["kind"]>, string> = {
  computer: "Компьютер",
  phone: "Телефон",
  tablet: "Планшет",
};

/** «Chrome на Windows», «Safari на iPhone», or what is known of it. */
export function deviceName(device: AccountSession["device"]): string {
  if (device.browser && device.os) return `${device.browser} на ${device.os}`;
  return device.browser ?? device.os ?? SESSIONS_COPY.unknownDevice;
}

const STAMP = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** «вход 7 окт., 09:12». */
export function signedInLine(iso: string): string {
  return `вход ${STAMP.format(new Date(iso))}`;
}

/** How long ago the other session was used — in words that need no plural. */
export function lastUsedLine(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 10) return "активен недавно";
  if (minutes < 60) return `был активен ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `был активен ${hours} ч назад`;
  return `был активен ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(iso))}`;
}

type ListState =
  | { phase: "loading" }
  | { phase: "ready"; sessions: AccountSession[] }
  | { phase: "failed" };

export function ProfileSessions() {
  const session = useOptionalSession();
  const real = Boolean(session?.viewer && !session.viewer.synthetic);

  const [list, setList] = useState<ListState>({ phase: "loading" });
  const [exiting, setExiting] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  /* The list as the Backend has it now. Called after mount, after a close and
     on «Повторить»; the state is set when the answer arrives. */
  const refresh = useCallback(async () => {
    const result = await listAccountSessions();
    setList(result.ok ? { phase: "ready", sessions: result.data.sessions } : { phase: "failed" });
  }, []);

  useEffect(() => {
    if (!real) return;
    let alive = true;
    void listAccountSessions().then((result) => {
      if (alive) setList(result.ok ? { phase: "ready", sessions: result.data.sessions } : { phase: "failed" });
    });
    return () => {
      alive = false;
    };
  }, [real]);

  function retry() {
    setList({ phase: "loading" });
    void refresh();
  }

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  if (!session || !real) return null;

  async function onExit() {
    if (exiting || !session) return;
    setExiting(true);
    try {
      await session.logout();
    } finally {
      setExiting(false);
    }
  }

  async function onClose(id: string) {
    setClosing(id);
    setSaid("");
    const result = await closeAccountSession(id);
    setClosing(null);
    setAsking(null);
    /* A session that is already gone — the other device signed out, or a new
       sign-in took its place — answers «not found». That is the outcome the
       learner asked for, not a failure to retry forever (2026-10-07 audit); and
       the list is read again after EVERY answer, so it shows the sessions that
       are live now. */
    const gone = !result.ok && result.error.status === 404;
    if (result.ok || gone) {
      setSaid(result.ok ? SESSIONS_COPY.closed : SESSIONS_COPY.alreadyClosed);
      if (list.phase === "ready") {
        setList({ phase: "ready", sessions: list.sessions.filter((row) => row.id !== id) });
      }
    } else {
      setSaid(SESSIONS_COPY.closeFailed);
    }
    void refresh();
  }

  const rows: AccountSession[] = list.phase === "ready" ? list.sessions : [];
  const current = rows.find((row) => row.current);
  const others = rows.filter((row) => !row.current);

  return (
    <section className="p-section p-sessions" aria-labelledby="p-section-sessions">
      <h2 className="p-section__title" id="p-section-sessions">
        {SESSIONS_COPY.section}
      </h2>
      <p className="p-sessions__intro">{SESSIONS_COPY.intro}</p>

      <ul className="p-sessions__list">
        <li className="p-row p-session p-session--current" data-role="session-row" data-current="">
          <span className="p-row__label">{current?.device.kind ? KIND_WORD[current.device.kind] : SESSIONS_COPY.thisBrowser}</span>
          <span className="p-row__value p-session__what">
            <span className="p-session__device">
              {current ? deviceName(current.device) : SESSIONS_COPY.thisBrowser}
            </span>
            <span className="p-session__meta">
              <span className="p-session__here">{SESSIONS_COPY.thisBrowser}</span>
              {current ? <> · {signedInLine(current.signedInAt)}</> : null}
            </span>
          </span>
          <button
            type="button"
            className="p-edit"
            data-role="session-exit"
            onClick={() => void onExit()}
            disabled={exiting}
            aria-busy={exiting || undefined}
          >
            {exiting ? SESSIONS_COPY.exitBusy : SESSIONS_COPY.exit}
          </button>
        </li>

        {others.map((row) => {
          const name = deviceName(row.device);
          const busy = closing === row.id;
          return (
            <li key={row.id} className="p-row p-session" data-role="session-row" data-session={row.id}>
              <span className="p-row__label">{row.device.kind ? KIND_WORD[row.device.kind] : "Устройство"}</span>
              <span className="p-row__value p-session__what">
                <span className="p-session__device">{name}</span>
                <span className="p-session__meta">
                  {lastUsedLine(row.lastSeenAt)} · {signedInLine(row.signedInAt)}
                </span>
              </span>
              {asking === row.id ? (
                <span className="p-session__ask" role="group" aria-label={SESSIONS_COPY.confirm}>
                  <span className="p-session__question">{SESSIONS_COPY.confirm}</span>
                  <button
                    type="button"
                    className="p-edit"
                    ref={cancelRef}
                    onClick={() => setAsking(null)}
                    disabled={busy}
                  >
                    {SESSIONS_COPY.confirmNo}
                  </button>
                  <button
                    type="button"
                    className="p-edit p-session__yes"
                    data-role="session-close-confirm"
                    onClick={() => void onClose(row.id)}
                    disabled={busy}
                    aria-busy={busy || undefined}
                  >
                    {busy ? SESSIONS_COPY.closing : SESSIONS_COPY.confirmYes}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="p-edit"
                  data-role="session-close"
                  aria-label={`${SESSIONS_COPY.close}: ${name}`}
                  onClick={() => {
                    setSaid("");
                    setAsking(row.id);
                  }}
                >
                  {SESSIONS_COPY.close}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {list.phase === "loading" ? <p className="p-sessions__note" aria-hidden="true" data-role="sessions-loading" /> : null}
      {list.phase === "failed" ? (
        <p className="p-sessions__note" role="alert">
          {SESSIONS_COPY.failed}{" "}
          <button type="button" className="p-edit p-sessions__retry" onClick={retry}>
            {SESSIONS_COPY.retry}
          </button>
        </p>
      ) : null}
      <p className="p-sessions__said" role="status">
        {said}
      </p>
    </section>
  );
}
