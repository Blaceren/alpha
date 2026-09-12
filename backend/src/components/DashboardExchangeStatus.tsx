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
  /**
   * FDCONF-1: resolved by the server from the canonical conversion ledger, with
   * the closed legacy set as a fallback. It is NOT the legacy column.
   */
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

  // FDCONF-1 — ONE SOURCE, AND THE `||` IS GONE ON PURPOSE.
  //
  // `exchange.depositConfirmed` is page-level fixture state. OR-ing it with the
  // server's answer meant the component could show "да" for a learner the
  // canonical ledger has never heard of, and could never show "нет" once the
  // fixture said otherwise. Two sources merged by `||` is not a fallback, it is
  // a claim that whichever says yes is right.
  const firstDepositConfirmed = Boolean(account?.firstDepositConfirmed);

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
            {/*
              FDCONF-1 — "Checkpoint verification" WAS HERE AND WAS A FALSEHOOD.
              It rendered the first-deposit flag under a checkpoint label, so a
              learner who deposited was told a checkpoint had been verified when
              no checkpoint owner had said anything of the kind. §11 of the
              qualifying-FTD gate is explicit that a deposit is not a checkpoint
              completion, and inferring one from the other is the same class of
              error this whole item exists to remove.

              It is DELETED rather than re-pointed. The checkpoint read model has
              its own owner and its own surface; giving this card a second,
              hand-rolled derivation of it would create the next drift instead of
              closing this one.
            */}
          </div>
        </div>

        <Link href="/exchange" className="btn btn-primary">
          Открыть биржу
        </Link>
      </div>
    </section>
  );
}
