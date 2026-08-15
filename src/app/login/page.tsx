"use client";

/**
 * §44 — the partner sign-in page.
 *
 * IT DISPLAYS WHAT THE BACKEND SAID AND INVENTS NOTHING. Every failed sign-in
 * gets the same refusal from the server — unknown address, wrong password,
 * disabled login and paused partner are indistinguishable by design — so this
 * page has nothing to add and does not try.
 *
 * NO PASSWORD IS EVER PUT IN THE URL, IN LOCAL STORAGE, OR IN A LOG.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="main login">
      <h1>Affiliate Partners</h1>
      <p className="sub">Alfa Trade Academy</p>
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const result = await api("/api/partner/v1/session", {
            method: "POST",
            body: { email, password },
          });
          setBusy(false);
          if (result.ok) router.replace("/");
          else setError(messageFor(result.messageKey));
        }}
      >
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error !== null ? <p className="err">{error}</p> : null}
      </form>
    </div>
  );
}
