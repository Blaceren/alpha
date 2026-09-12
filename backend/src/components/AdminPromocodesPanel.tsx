"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminActionBar, AdminInput, AdminPageHeader, AdminSection, AdminSelect, AdminShell, JsonPreview, StatusBadge } from "@/components/admin-ui";
import { csrfFetch } from "@/lib/api";

type Item = {
  id: number; code: string; type: string; value: unknown; maxUses: number | null; perUserLimit: number;
  usedCount: number; isActive: boolean; startsAt: string | null; expiresAt: string | null; redemptions: unknown[];
};

export function AdminPromocodesPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [code, setCode] = useState("");
  const [type, setType] = useState("xp_bonus");
  const [value, setValue] = useState('{"xp":100}');
  const [maxUses, setMaxUses] = useState("100");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/promocodes", { cache: "no-store" });
    if (response.ok) setItems(((await response.json()) as { items: Item[] }).items);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    let parsedValue: Record<string, unknown>;
    try { parsedValue = JSON.parse(value) as Record<string, unknown>; }
    catch { setStatus("Некорректный JSON значения"); return; }
    const response = await csrfFetch("/api/admin/promocodes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, type, value: parsedValue, maxUses: maxUses ? Number(maxUses) : null, perUserLimit: 1, startsAt: startsAt ? new Date(startsAt).toISOString() : null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, isActive: true }),
    });
    setStatus(response.ok ? "Промокод создан" : "Не удалось создать промокод");
    if (response.ok) { setCode(""); await load(); }
  }

  async function toggle(item: Item) {
    const response = await csrfFetch(`/api/admin/promocodes/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
    if (response.ok) await load();
  }

  async function remove(id: number) {
    const response = await csrfFetch(`/api/admin/promocodes/${id}`, { method: "DELETE" });
    if (response.ok) await load();
  }

  return <AdminShell>
    <AdminPageHeader title="Промокоды" description="Создание, расписание, лимиты и история использования промокодов." breadcrumbs={[{ href: "/admin", label: "Админка" }, { label: "Промокоды" }]} />
    <AdminSection>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <AdminInput value={code} onChange={(event) => setCode(event.target.value)} placeholder="CODE" />
        <AdminSelect value={type} onChange={(event) => setType(event.target.value)}><option value="xp_bonus">xp_bonus</option><option value="unlock_reward">unlock_reward</option><option value="grant_achievement">grant_achievement</option></AdminSelect>
        <AdminInput value={value} onChange={(event) => setValue(event.target.value)} placeholder='{"xp":100}' />
        <AdminInput value={maxUses} onChange={(event) => setMaxUses(event.target.value)} inputMode="numeric" placeholder="Макс. активаций" />
        <p className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-secondary)]">Лимит на пользователя: 1</p>
        <AdminInput value={startsAt} onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" />
        <AdminInput value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" />
        <button className="btn btn-primary" type="button" disabled={!code} onClick={create}>Создать</button>
      </div>
      {status ? <p className="mt-2 text-sm text-[var(--text-secondary)]">{status}</p> : null}
    </AdminSection>
    <div className="grid gap-4 lg:grid-cols-2">
      {items.map((item) => <AdminSection key={item.id}>
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-[var(--text-primary)]">{item.code}</h2><p className="text-sm text-[var(--text-secondary)]">{item.type} / активаций {item.usedCount}{item.maxUses ? `/${item.maxUses}` : ""} / на пользователя {item.perUserLimit}</p></div><StatusBadge value={item.isActive ? "активен" : "неактивен"} /></div>
        <div className="mt-3"><JsonPreview value={item.value} /></div>
        <AdminActionBar className="mt-3"><button className="btn btn-secondary" type="button" onClick={() => toggle(item)}>{item.isActive ? "Отключить" : "Включить"}</button><button className="btn btn-ghost" type="button" onClick={() => remove(item.id)}>Удалить</button><StatusBadge value={`${item.redemptions.length} активаций`} /></AdminActionBar>
        {item.redemptions.length ? <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-[var(--primary)]">История активаций</summary><div className="mt-2"><JsonPreview value={item.redemptions} /></div></details> : null}
      </AdminSection>)}
    </div>
  </AdminShell>;
}
