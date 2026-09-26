"use client";

/**
 * §22 — the report filters, as a shared control.
 *
 * ONLY FILTERS THE CANONICAL SOURCE SUPPORTS ARE OFFERED. Date range, campaign,
 * tracking link and sub1..sub5 — each one is a column the query owner actually
 * filters on. There is no "country", no "device" and no "traffic source",
 * because nothing in this platform records them and a control that silently
 * matched everything would be a lie in the shape of a dropdown.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type FilterState = {
  from: string;
  to: string;
  campaign: string;
  link: string;
  sub1: string;
  sub2: string;
  sub3: string;
  sub4: string;
  sub5: string;
};

export const EMPTY_FILTERS: FilterState = {
  from: "", to: "", campaign: "", link: "", sub1: "", sub2: "", sub3: "", sub4: "", sub5: "",
};

export function filtersToQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "") params.set(key, value);
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

type Campaign = { code: string; displayName: string };
type Link = { publicCode: string; displayName: string };

export function Filters({
  value,
  onApply,
}: {
  value: FilterState;
  onApply: (next: FilterState) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  useEffect(() => {
    void (async () => {
      const c = await api<{ rows: Campaign[] }>("/api/partner/v1/campaigns");
      if (c.ok) setCampaigns(c.data.rows);
      const l = await api<{ rows: Link[] }>("/api/partner/v1/tracking-links");
      if (l.ok) setLinks(l.data.rows);
    })();
  }, []);

  const set = (key: keyof FilterState) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: event.target.value });

  return (
    <div className="filters">
      <div>
        <label htmlFor="f-from">From</label>
        <input id="f-from" type="date" value={draft.from} onChange={set("from")} />
      </div>
      <div>
        <label htmlFor="f-to">To</label>
        <input id="f-to" type="date" value={draft.to} onChange={set("to")} />
      </div>
      <div>
        <label htmlFor="f-campaign">Campaign</label>
        <select id="f-campaign" value={draft.campaign} onChange={set("campaign")}>
          <option value="">All</option>
          {campaigns.map((campaign) => (
            <option key={campaign.code} value={campaign.code}>
              {campaign.displayName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-link">Link</label>
        <select id="f-link" value={draft.link} onChange={set("link")}>
          <option value="">All</option>
          {links.map((link) => (
            <option key={link.publicCode} value={link.publicCode}>
              {link.displayName}
            </option>
          ))}
        </select>
      </div>
      {(["sub1", "sub2", "sub3", "sub4", "sub5"] as const).map((key) => (
        <div key={key} style={{ minWidth: 110 }}>
          <label htmlFor={`f-${key}`}>{key}</label>
          <input id={`f-${key}`} value={draft[key]} onChange={set(key)} />
        </div>
      ))}
      <div style={{ minWidth: 0, display: "flex", gap: 8 }}>
        <button onClick={() => onApply(draft)}>Apply</button>
        <button
          className="ghost"
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            onApply(EMPTY_FILTERS);
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
