"use client";

/**
 * §17/§44 — account and security.
 *
 * CHANGING A PASSWORD REQUIRES THE CURRENT ONE, and signs out every OTHER
 * session while keeping this one. The page says so, because a security control
 * a user does not know about is one they cannot rely on.
 */
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, messageFor } from "@/lib/api";

type Session = {
  partnerUserId: string;
  email: string;
  displayName: string;
  partner: { code: string; displayName: string };
  expiresAt: string;
};

export default function AccountPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await api<Session>("/api/partner/v1/session");
      if (result.ok) setSession(result.data);
    })();
  }, []);

  return (
    <Shell>
      <h1>Account</h1>
      <p className="sub">Your sign-in and security settings.</p>

      {session !== null ? (
        <table>
          <tbody>
            <tr><th>Affiliate</th><td>{session.partner.displayName} <span className="mono">({session.partner.code})</span></td></tr>
            <tr><th>Name</th><td>{session.displayName}</td></tr>
            <tr><th>Email</th><td className="mono">{session.email}</td></tr>
            <tr><th>Session expires</th><td className="mono">{session.expiresAt.replace("T", " ").replace(".000Z", "Z")}</td></tr>
          </tbody>
        </table>
      ) : null}

      <h2>Change password</h2>
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setDone(false);
          const result = await api("/api/partner/v1/account/password", {
            method: "POST",
            body: { currentPassword, newPassword },
          });
          setBusy(false);
          if (result.ok) {
            setDone(true);
            setCurrentPassword("");
            setNewPassword("");
          } else setError(messageFor(result.messageKey));
        }}
      >
        <label htmlFor="current">Current password</label>
        <input id="current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        <label htmlFor="next">New password (at least 12 characters, 8 distinct)</label>
        <input id="next" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} />
        <p className="sub" style={{ marginTop: 8 }}>
          Changing your password signs out every other browser. This one stays signed in.
        </p>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
        {error !== null ? <p className="err">{error}</p> : null}
        {done ? <p className="ok">Password changed. Other sessions have been signed out.</p> : null}
      </form>
    </Shell>
  );
}
