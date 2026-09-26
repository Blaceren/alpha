"use client";

/**
 * §13/§51 — earnings.
 *
 * THREE COLUMNS FOR THREE NUMBERS, side by side and named: the deposit that
 * qualified, the CPA rate that applied (with its version), and the commission.
 * A partner can read straight across and see that 500.00 of deposit under a
 * 120.00 CPA earned 120.00 — which is the single most important thing this
 * product has to communicate honestly.
 *
 * THE TERMS VERSION IS SHOWN because §11 is a promise to the partner too: a
 * commission earned under version 1 still says version 1 after the rate changes.
 *
 * THERE IS NO PAYOUT STATUS, NO BALANCE AND NO "AVAILABLE TO WITHDRAW",
 * because no owner in this product can answer any of them.
 */
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Amount, Money, type CurrencyTotal } from "@/components/Money";
import { api } from "@/lib/api";

type Row = {
  commissionId: string;
  amount: string;
  currency: string;
  createdAt: string;
  qualifiedAt: string;
  campaignCode: string;
  cpaTerms: { version: number; amount: string; currency: string };
  qualifyingDeposit: {
    conversionId: string;
    amount: string | null;
    currency: string | null;
    occurredAt: string;
  };
};

export default function CommissionsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<CurrencyTotal[]>([]);

  useEffect(() => {
    void (async () => {
      const result = await api<{ rows: Row[]; totals: CurrencyTotal[] }>("/api/partner/v1/commissions");
      if (result.ok) {
        setRows(result.data.rows);
        setTotals(result.data.totals);
      } else setRows([]);
    })();
  }, []);

  return (
    <Shell>
      <h1>Commissions</h1>
      <p className="sub">One commission per qualifying first deposit, at the CPA agreed when it qualified. Redeposits never earn a second commission.</p>
      <div className="tiles">
        <div className="tile">
          <div className="k">Total earned</div>
          <div className="v" style={{ fontSize: 17 }}><Money totals={totals} /></div>
        </div>
      </div>
      <h2>Detail</h2>
      {rows === null ? (
        <p className="empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="empty">No commissions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Qualified</th>
              <th>Campaign</th>
              <th>Qualifying deposit</th>
              <th>CPA rate applied</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.commissionId}>
                <td className="mono">{row.qualifiedAt.replace("T", " ").replace(".000Z", "Z")}</td>
                <td>{row.campaignCode}</td>
                <td className="num">
                  <Amount amount={row.qualifyingDeposit.amount} currency={row.qualifyingDeposit.currency} />
                </td>
                <td className="num">
                  <Amount amount={row.cpaTerms.amount} currency={row.cpaTerms.currency} />{" "}
                  <span className="pill">v{row.cpaTerms.version}</span>
                </td>
                <td className="num"><Amount amount={row.amount} currency={row.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
