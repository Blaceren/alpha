"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui";

type DashboardExchangeStatusProps = {
  exchange: {
    account: string;
    depositConfirmed: boolean;
    balance: number;
    currency: string;
  };
};

type ExchangeAccount = {
  status: string;
  registrationStatus: boolean;
  emailConfirmed: boolean;
  firstDepositConfirmed: boolean;
};

function InlineStatus({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="status-step flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3" data-done={done}>
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <StatusPill>{done ? "да" : "нет"}</StatusPill>
    </div>
  );
}

export function DashboardExchangeStatus({ exchange }: DashboardExchangeStatusProps) {
  const [account, setAccount] = useState<ExchangeAccount | null>(null);

  useEffect(() => {
    fetch("/api/exchange/account", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { account: ExchangeAccount | null } | null) => setAccount(result?.account ?? null))
      .catch(() => setAccount(null));
  }, []);

  const firstDepositConfirmed = Boolean(account?.firstDepositConfirmed || exchange.depositConfirmed);

  return (
    <section className="app-card p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="section-title">Статус биржи</h2>
            <StatusPill>{account?.status ?? exchange.account}</StatusPill>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InlineStatus label="Регистрация подтверждена" done={Boolean(account?.registrationStatus)} />
            <InlineStatus label="Email подтверждён у партнёра" done={Boolean(account?.emailConfirmed)} />
            <InlineStatus label="Первый депозит подтверждён" done={firstDepositConfirmed} />
            <InlineStatus label="Checkpoint verification" done={Boolean(account?.firstDepositConfirmed)} />
          </div>
        </div>

        <Link href="/exchange" className="btn btn-primary">
          Открыть биржу
        </Link>
      </div>
    </section>
  );
}
