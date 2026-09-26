"use client";

/**
 * AFFILIATE-PLATFORM-V1 §31 — the partner navigation, and the session guard.
 *
 * THE GUARD IS A CONVENIENCE, NOT THE BOUNDARY. Every page here renders from
 * data the Backend returned, and the Backend refuses an unauthenticated request
 * on its own. Redirecting on a 401 stops a partner staring at empty tables; it
 * is not what keeps anybody out, and no page depends on it for that.
 *
 * SIX ENTRIES, AND NO SEVENTH. §31 asks for a narrow V1 with no decorative
 * dashboards, so there is no "Reports", no "Analytics", no "Payouts" and no
 * "Support" — each of those would be a link to a page that could not answer its
 * own name.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Session = {
  displayName: string;
  email: string;
  partner: { code: string; displayName: string };
};

const NAV = [
  ["/", "Overview"],
  ["/links", "Tracking Links"],
  ["/conversions", "Conversions"],
  ["/postbacks", "Postbacks"],
  ["/commissions", "Commissions"],
  ["/account", "Account"],
] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await api<Session>("/api/partner/v1/session");
      if (cancelled) return;
      if (result.ok) setSession(result.data);
      else router.replace("/login");
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked) return <div className="main"><p className="sub">Loading…</p></div>;
  if (session === null) return null;

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          {session.partner.displayName}
          <small>{session.partner.code}</small>
        </div>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
            {label}
          </Link>
        ))}
        <div style={{ padding: "18px 20px 0" }}>
          <button
            className="ghost"
            onClick={async () => {
              await api("/api/partner/v1/session", { method: "DELETE" });
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
