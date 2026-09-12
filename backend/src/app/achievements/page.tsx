"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { csrfFetch } from "@/lib/api";

type Achievement = { id: number; slug: string; title: string; description: string; rarity: string; iconKey: string; granted: boolean };

export default function AchievementsPage() {
  const [items, setItems] = useState<Achievement[]>([]);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const redeemAttempt = useRef<{ code: string; requestId: string } | null>(null);
  const load = useCallback(async () => { const response = await fetch("/api/achievements", { cache: "no-store" }); if (response.ok) setItems(((await response.json()) as { items: Achievement[] }).items); }, []);
  useEffect(() => { load(); }, [load]);
  async function redeem() {
    const normalizedCode = code.trim().toUpperCase();
    const attempt = redeemAttempt.current?.code === normalizedCode
      ? redeemAttempt.current
      : { code: normalizedCode, requestId: crypto.randomUUID() };
    redeemAttempt.current = attempt;
    try {
      const response = await csrfFetch("/api/promocodes/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.requestId,
        },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (response.ok || response.status < 500) redeemAttempt.current = null;
      setStatus(response.ok ? "Промокод применён" : result.message ?? "Промокод недоступен");
      if (response.ok) { setCode(""); await load(); }
    } catch {
      setStatus("Ошибка сети. Повтор использует тот же идентификатор запроса.");
    }
  }
  async function select(achievementId: number) { const response = await csrfFetch("/api/achievements/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ achievementId }) }); setStatus(response.ok ? "Достижение выбрано для чата" : "Не удалось выбрать достижение"); }
  return <ProtectedPage allowedRoles={["user"]}><div className="space-y-6"><PageHeader kicker="Профиль" title="Достижения и промокоды" description="Полученные достижения можно показывать рядом с именем в community chat."/><section className="dashboard-primary app-card p-5"><h2 className="section-title">Активировать промокод</h2><div className="mt-4 flex flex-wrap gap-3"><input className="form-input max-w-sm" value={code} onChange={e=>{ setCode(e.target.value.toUpperCase()); redeemAttempt.current = null; }} placeholder="Введите код"/><button className="btn btn-primary" type="button" disabled={!code} onClick={redeem}>Применить</button></div>{status?<p className="mt-3 text-sm text-[var(--text-secondary)]">{status}</p>:null}</section>{items.length===0?<EmptyState label="Достижений пока нет"/>:<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{items.map(item=><section key={item.id} className="reward-card app-card-flat p-5"><div className="flex items-center justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary-soft)] font-black text-[var(--primary)]">{item.title.slice(0,1)}</span><StatusPill>{item.granted?"получено":item.rarity}</StatusPill></div><h2 className="mt-4 font-black text-[var(--text-primary)]">{item.title}</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">{item.description}</p>{item.granted?<button className="btn btn-secondary mt-4" type="button" onClick={()=>select(item.id)}>Показывать в чате</button>:null}</section>)}</div>}</div></ProtectedPage>;
}
