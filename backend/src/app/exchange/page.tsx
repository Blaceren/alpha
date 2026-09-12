"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { Alert, Card, StatusPill } from "@/components/ui";
import { csrfFetch } from "@/lib/api";

type ExchangeAccount = {
  id: number;
  provider: string;
  exchangeAccountId: string;
  externalAccountId: string | null;
  traderId?: string | null;
  clickId?: string | null;
  status: string;
  registrationStatus: boolean;
  emailConfirmed: boolean;
  firstDepositConfirmed: boolean;
  lastVerifiedAt: string | null;
  rejectionReason: string | null;
};

function StatusLine({ label, value, done }: { label: string; value: string; done?: boolean }) {
  return (
    <div className="status-step rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4" data-done={Boolean(done)}>
      <div className="text-sm text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="font-black text-[var(--text-primary)]">{value}</div>
        <StatusPill>{done ? "готово" : "ожидает"}</StatusPill>
      </div>
    </div>
  );
}

export default function ExchangePage() {
  const [account, setAccount] = useState<ExchangeAccount | null>(null);
  const [status, setStatus] = useState("Загрузка...");
  const [isOpeningPocket, setIsOpeningPocket] = useState(false);

  async function loadAccount() {
    setStatus("Загрузка...");
    const response = await fetch("/api/exchange/account", { cache: "no-store" });

    if (!response.ok) {
      setStatus("Не удалось загрузить статус биржи");
      return;
    }

    const result = (await response.json()) as { account: ExchangeAccount | null };
    setAccount(result.account);
    setStatus("");
  }

  useEffect(() => {
    loadAccount();
  }, []);

  async function checkRegistration() {
    setStatus("Проверка регистрации...");
    const response = await csrfFetch("/api/exchange/registration/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    setStatus(result.message ?? "Проверка завершена");
    await loadAccount();
  }

  async function openPocketRegistration() {
    if (isOpeningPocket) return;

    setIsOpeningPocket(true);
    setStatus("Создаём безопасную ссылку Pocket...");
    const response = await csrfFetch("/api/exchange/referral-link", { method: "POST" });
    const result = (await response.json().catch(() => ({}))) as {
      referralUrl?: string;
      message?: string;
      error?: string;
    };

    if (!response.ok || !result.referralUrl) {
      setIsOpeningPocket(false);
      setStatus(result.message ?? result.error ?? "Не удалось создать ссылку Pocket");
      return;
    }

    window.location.assign(result.referralUrl);
  }

  return (
    <ProtectedPage allowedRoles={["user", "admin", "support", "mentor"]}>
      <div className="space-y-7">
        <section className="dashboard-primary app-card grid gap-6 p-6 md:p-8 xl:grid-cols-[1fr_0.82fr]">
          <div>
            <p className="page-kicker">Биржевой onboarding</p>
            <h1 className="mt-3 text-4xl font-black leading-tight tracking-[-0.03em] text-[var(--text-primary)] md:text-5xl">
              Подключите биржу и откройте следующий этап
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--text-secondary)]">
              Здесь видны только пользовательские статусы: регистрация, email, первый депозит и готовность checkpoint.
              Сырые postback-данные остаются в админке.
            </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={openPocketRegistration}
                  disabled={isOpeningPocket}
                  className="btn btn-primary min-h-12 px-6 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Перейти к регистрации
                </button>
                <button className="btn btn-secondary min-h-12 px-6" type="button" onClick={checkRegistration}>
                  Проверить регистрацию
                </button>
                <Link href="/exchange/existing-account" className="btn btn-secondary min-h-12 px-6">
                  Уже есть аккаунт
                </Link>
              </div>
          </div>
          <div className="premium-preview app-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[var(--text-primary)]">Exchange status</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">sandbox/manual provider</p>
              </div>
              <StatusPill>{account?.status ?? "not_connected"}</StatusPill>
            </div>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
                <p className="text-xs font-bold uppercase text-[var(--text-muted)]">ID аккаунта</p>
                <p className="mt-2 break-all font-black text-[var(--text-primary)]">{account?.exchangeAccountId ?? "пока нет"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
                <p className="text-xs font-bold uppercase text-[var(--text-muted)]">Последняя проверка</p>
                <p className="mt-2 font-black text-[var(--text-primary)]">
                  {account?.lastVerifiedAt ? new Date(account.lastVerifiedAt).toLocaleString("ru-RU") : "ещё не было"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatusLine label="Регистрация по ссылке" value={account?.registrationStatus ? "подтверждена" : "не подтверждена"} done={account?.registrationStatus} />
          <StatusLine label="Email у партнёра" value={account?.emailConfirmed ? "подтверждён" : "не подтверждён"} done={account?.emailConfirmed} />
          <StatusLine label="Первый депозит" value={account?.firstDepositConfirmed ? "подтверждён" : "не подтверждён"} done={account?.firstDepositConfirmed} />
          <StatusLine label="Контрольная точка" value={account?.firstDepositConfirmed ? "можно проверять" : "ожидает условий"} done={account?.firstDepositConfirmed} />
        </div>

        <Card className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="font-black text-[var(--text-primary)]">Следующий шаг после подтверждения</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Вернитесь к цепочке заданий: шаг 4 закрывается после подтверждения регистрации/депозита через postback.
            </p>
          </div>
          <Link href="/tasks" className="btn btn-primary">
            Перейти к заданию
          </Link>
        </Card>

        {account?.rejectionReason ? <Alert className="border-red-200 bg-red-50 text-red-700">{account.rejectionReason}</Alert> : null}
        {status ? <Alert>{status}</Alert> : null}
      </div>
    </ProtectedPage>
  );
}
