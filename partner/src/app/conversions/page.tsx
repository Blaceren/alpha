"use client";

/**
 * §24 — the conversion history.
 *
 * REG, DEP AND RDEP ARE NEVER COLLAPSED INTO "CONVERSION". They are three
 * business facts with three different consequences, and the type column is the
 * first one.
 *
 * THE COMMISSION COLUMN IS SEPARATE FROM THE AMOUNT COLUMN, always, even when
 * both are present on one row. The amount is the learner's deposit; the
 * commission is what ATA owes. §51.
 *
 * NOTHING ABOUT THE LEARNER IS DISPLAYED because nothing about the learner is
 * returned — the projection never selects it.
 */
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Amount } from "@/components/Money";
import { EMPTY_FILTERS, Filters, filtersToQuery, type FilterState } from "@/components/Filters";
import { api } from "@/lib/api";

type Row = {
  conversionId: string;
  eventType: string;
  occurredAt: string;
  amount: string | null;
  currency: string | null;
  campaignCode: string | null;
  trackingLinkPublicCode: string | null;
  clickId: string | null;
  sub1: string | null;
  sub2: string | null;
  sub3: string | null;
  sub4: string | null;
  sub5: string | null;
  commission: { amount: string; currency: string } | null;
};

const LABEL: Record<string, string> = {
  academy_registration: "REG",
  first_deposit: "DEP",
  redeposit: "RDEP",
};

export default function ConversionsPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [eventType, setEventType] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (applied: FilterState, type: string) => {
    const query = filtersToQuery(applied);
    const suffix = type === "" ? query : `${query === "" ? "?" : `${query}&`}eventType=${type}`;
    const result = await api<{ rows: Row[] }>(`/api/partner/v1/conversions${suffix}`);
    if (result.ok) {
      setRows(result.data.rows);
      setError(null);
    } else setError(result.messageKey);
  }, []);

  useEffect(() => {
    void load(filters, eventType);
  }, [filters, eventType, load]);

  return (
    <Shell>
      <h1>Conversions</h1>
      <p className="sub">REG is an Academy registration. DEP is a first Pocket deposit. RDEP is every later deposit and earns no CPA.</p>
      <Filters value={filters} onApply={setFilters} />
      <div className="filters">
        <div>
          <label htmlFor="type">Type</label>
          <select id="type" value={eventType} onChange={(event) => setEventType(event.target.value)}>
            <option value="">All</option>
            <option value="academy_registration">REG</option>
            <option value="first_deposit">DEP</option>
            <option value="redeposit">RDEP</option>
          </select>
        </div>
      </div>
      {error !== null ? <p className="err">{error}</p> : null}
      {rows === null ? (
        <p className="empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="empty">No conversions match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>When</th>
              <th>Deposit amount</th>
              <th>Your commission</th>
              <th>Campaign</th>
              <th>Link</th>
              <th>sub1…5</th>
              <th>Conversion id</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.conversionId}>
                <td><span className="pill">{LABEL[row.eventType] ?? row.eventType}</span></td>
                <td className="mono">{row.occurredAt.replace("T", " ").replace(".000Z", "Z")}</td>
                <td className="num"><Amount amount={row.amount} currency={row.currency} /></td>
                <td className="num">
                  {row.commission === null ? (
                    <span>—</span>
                  ) : (
                    <Amount amount={row.commission.amount} currency={row.commission.currency} />
                  )}
                </td>
                <td>{row.campaignCode ?? "—"}</td>
                <td className="mono">{row.trackingLinkPublicCode?.slice(0, 10) ?? "—"}…</td>
                <td className="mono">
                  {[row.sub1, row.sub2, row.sub3, row.sub4, row.sub5]
                    .map((value) => value ?? "")
                    .join(" / ")
                    .replace(/^[\s/]+$/, "—")}
                </td>
                <td className="mono">{row.conversionId.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
