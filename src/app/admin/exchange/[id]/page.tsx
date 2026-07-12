"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { JsonPreview } from "@/components/admin-ui";
import { csrfFetch } from "@/lib/api";

type ExchangeAccount = {
  id: number;
  user?: { id: number; name: string; email: string };
  provider: string;
  status: string;
  balance: number;
  depositAmount: number;
  tradesCount: number;
  rejectionReason: string | null;
  traderId: string | null;
  clickId: string | null;
  attribution: unknown;
  totalDeposits: number;
  totalWithdrawals: number;
  totalCommission: number;
};

type PostbackEvent = { id: number; normalizedEventType: string | null; eventType: string; amount: number | null; currency: string | null; status: string; attribution: unknown; rawPayload: string; processedAt: string | null; createdAt: string };

export default function AdminExchangeDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <AdminExchangeDetailContent />
    </ProtectedPage>
  );
}

function AdminExchangeDetailContent() {
  const params = useParams<{ id: string }>();
  const [account, setAccount] = useState<ExchangeAccount | null>(null);
  const [status, setStatus] = useState("Загрузка...");
  const [accountStatus, setAccountStatus] = useState("pending");
  const [balance, setBalance] = useState("0");
  const [depositAmount, setDepositAmount] = useState("0");
  const [tradesCount, setTradesCount] = useState("0");
  const [rejectionReason, setRejectionReason] = useState("");
  const [postbackEvents, setPostbackEvents] = useState<PostbackEvent[]>([]);

  const loadAccount = useCallback(async () => {
    setStatus("Загрузка...");
    const response = await fetch(`/api/admin/exchange/accounts/${params.id}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setStatus("Не удалось загрузить exchange account");
      return;
    }

    const result = (await response.json()) as { account: ExchangeAccount; postbackEvents: PostbackEvent[] };
    setAccount(result.account);
    setAccountStatus(result.account.status);
    setBalance(String(result.account.balance));
    setDepositAmount(String(result.account.depositAmount));
    setTradesCount(String(result.account.tradesCount));
    setRejectionReason(result.account.rejectionReason ?? "");
    setPostbackEvents(result.postbackEvents ?? []);
    setStatus("");
  }, [params.id]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  async function save() {
    setStatus("Сохранение...");
    const response = await csrfFetch(`/api/admin/exchange/accounts/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: accountStatus,
        balance: Number(balance),
        depositAmount: Number(depositAmount),
        tradesCount: Number(tradesCount),
        rejectionReason: rejectionReason || null,
      }),
    });

    if (!response.ok) {
      setStatus("Не удалось сохранить exchange account");
      return;
    }

    const result = (await response.json()) as { account: ExchangeAccount };
    setAccount(result.account);
    setStatus("Сохранено");
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Exchange account #{params.id}</h1>
        <p className="text-sm text-slate-600">{account?.user?.email ?? ""}</p>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2">
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}>
          <option value="not_connected">not_connected</option>
          <option value="pending">pending</option>
          <option value="connected">connected</option>
          <option value="rejected">rejected</option>
          <option value="blocked">blocked</option>
        </select>
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={balance} onChange={(event) => setBalance(event.target.value)} />
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={tradesCount} onChange={(event) => setTradesCount(event.target.value)} />
        <textarea className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
        <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium md:w-40" type="button" onClick={save}>
          Сохранить
        </button>
      </div>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}

      {account ? <div className="grid gap-4 lg:grid-cols-2"><section className="app-card-flat p-4"><h2 className="section-title">Attribution / macros</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">trader_id: {account.traderId ?? "-"} / click_id: {account.clickId ?? "-"}</p><div className="mt-3"><JsonPreview value={account.attribution ?? {}} /></div></section><section className="app-card-flat p-4"><h2 className="section-title">Financial event summary</h2><div className="mt-3 grid grid-cols-3 gap-3 text-sm"><div>Deposits<br/><strong>${account.totalDeposits}</strong></div><div>Withdrawals<br/><strong>${account.totalWithdrawals}</strong></div><div>Commission<br/><strong>${account.totalCommission}</strong></div></div></section></div> : null}

      <section className="app-card-flat p-4"><h2 className="section-title">Postback history</h2><div className="mt-4 space-y-3">{postbackEvents.map((event) => <details key={event.id} className="rounded-lg border border-[var(--border)] p-3"><summary className="cursor-pointer font-bold text-[var(--text-primary)]">{event.normalizedEventType ?? event.eventType} / {event.status} / {event.amount ?? 0} {event.currency ?? ""}</summary><div className="mt-3"><JsonPreview value={{ processedAt: event.processedAt, attribution: event.attribution, rawPayload: event.rawPayload }} /></div></details>)}</div></section>
    </section>
  );
}
