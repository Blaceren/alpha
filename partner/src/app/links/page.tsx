"use client";

/**
 * §20/§46 — tracking links.
 *
 * A PARTNER CHOOSES A CAMPAIGN AND A NAME. THERE IS NO DESTINATION FIELD, on
 * this page or in the API behind it: the landing target is a server-owned key,
 * so an open redirect is not something this form declines to offer — it is
 * something the domain cannot represent.
 *
 * A CAMPAIGN IS REQUIRED, and only campaigns staff made available to this
 * partner appear. A link with no campaign has no commercial terms and could
 * never earn anything.
 */
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, messageFor } from "@/lib/api";

type Campaign = { code: string; displayName: string; cpa: { amount: string; currency: string; version: number } | null };
type Row = {
  publicCode: string;
  url: string | null;
  displayName: string;
  status: string;
  campaignCode: string | null;
  parameters: {
    externalClickParameter: string;
    sub1: string | null;
    sub2: string | null;
    sub3: string | null;
    sub4: string | null;
    sub5: string | null;
  };
  createdAt: string;
};

export default function LinksPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [campaignCode, setCampaignCode] = useState("");
  const [subs, setSubs] = useState({ sub1Parameter: "", sub2Parameter: "", sub3Parameter: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await api<{ rows: Row[] }>("/api/partner/v1/tracking-links");
    if (list.ok) setRows(list.data.rows);
    const c = await api<{ rows: Campaign[] }>("/api/partner/v1/campaigns");
    if (c.ok) {
      setCampaigns(c.data.rows);
      if (c.data.rows.length > 0 && campaignCode === "") setCampaignCode(c.data.rows[0].code);
    }
  }, [campaignCode]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <h1>Tracking Links</h1>
      <p className="sub">Every link lands on the Academy registration page. The destination is set by ATA and is not configurable.</p>

      <h2>Your commercial campaigns</h2>
      {campaigns.length === 0 ? (
        <p className="empty">No campaigns have been made available to you yet.</p>
      ) : (
        <table>
          <thead><tr><th>Campaign</th><th>CPA</th></tr></thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.code}>
                <td>{campaign.displayName} <span className="mono">({campaign.code})</span></td>
                <td className="num">
                  {campaign.cpa === null ? (
                    <span className="pill">no rate agreed yet</span>
                  ) : (
                    <>
                      <span className="mono">{campaign.cpa.amount}</span> {campaign.cpa.currency}{" "}
                      <span className="pill">v{campaign.cpa.version}</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Create a link</h2>
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const result = await api("/api/partner/v1/tracking-links", {
            method: "POST",
            body: {
              campaignCode,
              displayName,
              ...Object.fromEntries(Object.entries(subs).filter(([, value]) => value !== "")),
            },
          });
          setBusy(false);
          if (result.ok) {
            setDisplayName("");
            await load();
          } else setError(messageFor(result.messageKey));
        }}
      >
        <label htmlFor="campaign">Campaign</label>
        <select id="campaign" value={campaignCode} onChange={(event) => setCampaignCode(event.target.value)} required>
          {campaigns.map((campaign) => (
            <option key={campaign.code} value={campaign.code}>{campaign.displayName}</option>
          ))}
        </select>
        <label htmlFor="name">Link name</label>
        <input id="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={160} />
        {(["sub1Parameter", "sub2Parameter", "sub3Parameter"] as const).map((key) => (
          <div key={key}>
            <label htmlFor={key}>{key.replace("Parameter", "")} parameter name (optional)</label>
            <input
              id={key}
              value={subs[key]}
              onChange={(event) => setSubs({ ...subs, [key]: event.target.value })}
              pattern="[a-z0-9_]+"
              maxLength={32}
            />
          </div>
        ))}
        <button type="submit" disabled={busy || campaigns.length === 0}>
          {busy ? "Creating…" : "Create link"}
        </button>
        {error !== null ? <p className="err">{error}</p> : null}
      </form>

      <h2>Your links</h2>
      {rows === null ? (
        <p className="empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="empty">You have no tracking links yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Campaign</th><th>Status</th><th>URL</th><th>Parameters</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.publicCode}>
                <td>{row.displayName}</td>
                <td>{row.campaignCode ?? "—"}</td>
                <td><span className="pill">{row.status}</span></td>
                <td className="mono">{row.url ?? `/go/${row.publicCode}`}</td>
                <td className="mono">
                  {[
                    row.parameters.externalClickParameter,
                    row.parameters.sub1,
                    row.parameters.sub2,
                    row.parameters.sub3,
                    row.parameters.sub4,
                    row.parameters.sub5,
                  ]
                    .filter((value): value is string => value !== null)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
