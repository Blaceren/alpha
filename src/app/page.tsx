"use client";

/**
 * §22 — the partner dashboard.
 *
 * EVERY TILE IS A CANONICAL ROW COUNT OR A CANONICAL SUM. Nothing on this page
 * is estimated, extrapolated, forecast or smoothed, and there is no tile whose
 * source is "we thought a dashboard should have one".
 *
 * THE THREE MONEY TILES ARE THREE DIFFERENT NUMBERS AND SAY SO: deposits are
 * what learners paid the provider, redeposits likewise, and earnings are what
 * ATA owes this partner. §51 forbids presenting any of them as another.
 */
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Money, Rate, type CurrencyTotal } from "@/components/Money";
import { EMPTY_FILTERS, Filters, filtersToQuery, type FilterState } from "@/components/Filters";
import { api } from "@/lib/api";

type Overview = {
  clicks: number;
  reg: number;
  dep: number;
  rdep: number;
  clickToRegRate: number | null;
  regToDepRate: number | null;
  depAmounts: CurrencyTotal[];
  rdepAmounts: CurrencyTotal[];
  cpaQualifications: number;
  commissionTotals: CurrencyTotal[];
};

export default function OverviewPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (applied: FilterState) => {
    const result = await api<Overview>(`/api/partner/v1/overview${filtersToQuery(applied)}`);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.messageKey);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  return (
    <Shell>
      <h1>Overview</h1>
      <p className="sub">Every figure below is counted from canonical conversion rows.</p>
      <Filters value={filters} onApply={setFilters} />
      {error !== null ? <p className="err">{error}</p> : null}
      {data === null ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="tiles">
            <div className="tile"><div className="k">Clicks</div><div className="v">{data.clicks}</div><div className="n">qualified only</div></div>
            <div className="tile"><div className="k">REG</div><div className="v">{data.reg}</div><div className="n">Academy registrations</div></div>
            <div className="tile"><div className="k">DEP</div><div className="v">{data.dep}</div><div className="n">first deposits</div></div>
            <div className="tile"><div className="k">RDEP</div><div className="v">{data.rdep}</div><div className="n">redeposits · no CPA</div></div>
            <div className="tile"><div className="k">Click → REG</div><div className="v"><Rate value={data.clickToRegRate} /></div></div>
            <div className="tile"><div className="k">REG → DEP</div><div className="v"><Rate value={data.regToDepRate} /></div></div>
          </div>

          <h2>Provider deposit amounts — what learners paid Pocket</h2>
          <div className="tiles">
            <div className="tile"><div className="k">First deposits</div><div className="v" style={{ fontSize: 17 }}><Money totals={data.depAmounts} /></div></div>
            <div className="tile"><div className="k">Redeposits</div><div className="v" style={{ fontSize: 17 }}><Money totals={data.rdepAmounts} /></div></div>
          </div>

          <h2>Your earnings — what ATA owes you</h2>
          <div className="tiles">
            <div className="tile"><div className="k">CPA qualifications</div><div className="v">{data.cpaQualifications}</div><div className="n">one per qualifying first deposit</div></div>
            <div className="tile"><div className="k">Commission</div><div className="v" style={{ fontSize: 17 }}><Money totals={data.commissionTotals} /></div><div className="n">at your configured CPA — not the deposit amount</div></div>
          </div>
        </>
      )}
    </Shell>
  );
}
