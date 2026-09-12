"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

type ExchangeAccount = {
  id: number;
  userId: number;
  user?: { id: number; name: string; email: string };
  provider: string;
  status: string;
  exchangeAccountId: string;
  externalAccountId: string | null;
  balance: number;
  depositAmount: number;
  tradesCount: number;
  updatedAt: string;
};

type ListResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const emptyResponse: ListResponse<ExchangeAccount> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

export default function AdminExchangePage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <AdminExchangeContent />
      </Suspense>
    </ProtectedPage>
  );
}

function AdminExchangeContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse<ExchangeAccount>>(emptyResponse);
  const [status, setStatus] = useState("Загрузка...");
  const [accountStatus, setAccountStatus] = useState(searchParams.get("status") ?? "");

  useEffect(() => {
    setAccountStatus(searchParams.get("status") ?? "");
  }, [searchParams]);

  useEffect(() => {
    async function loadAccounts() {
      setStatus("Загрузка...");
      const query = searchParams.toString();
      const response = await fetch(`/api/admin/exchange/accounts${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        setStatus("Не удалось загрузить exchange accounts");
        return;
      }

      setData((await response.json()) as ListResponse<ExchangeAccount>);
      setStatus("");
    }

    loadAccounts();
  }, [searchParams]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    if (accountStatus) next.set("status", accountStatus);
    else next.delete("status");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Exchange accounts</h1>
        <p className="text-sm text-slate-600">Список sandbox/manual exchange подключений.</p>
      </div>

      <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={accountStatus}
          onChange={(event) => setAccountStatus(event.target.value)}
        >
          <option value="">Все статусы</option>
          <option value="not_connected">not_connected</option>
          <option value="pending">pending</option>
          <option value="connected">connected</option>
          <option value="rejected">rejected</option>
          <option value="blocked">blocked</option>
        </select>
        <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={applyFilters}>
          Найти
        </button>
      </div>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">id</th>
              <th className="py-2 pr-3">user</th>
              <th className="py-2 pr-3">provider</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">externalAccountId</th>
              <th className="py-2 pr-3">balance</th>
              <th className="py-2 pr-3">deposit</th>
              <th className="py-2 pr-3">trades</th>
              <th className="py-2 pr-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((account) => (
              <tr key={account.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">{account.id}</td>
                <td className="py-2 pr-3">{account.user?.email ?? account.userId}</td>
                <td className="py-2 pr-3">{account.provider}</td>
                <td className="py-2 pr-3">{account.status}</td>
                <td className="py-2 pr-3">{account.externalAccountId ?? account.exchangeAccountId}</td>
                <td className="py-2 pr-3">{account.balance}</td>
                <td className="py-2 pr-3">{account.depositAmount}</td>
                <td className="py-2 pr-3">{account.tradesCount}</td>
                <td className="py-2 pr-3">
                  <Link className="font-medium text-slate-950 underline" href={`/admin/exchange/${account.id}`}>
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
