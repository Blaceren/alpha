"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AdminActionBar,
  AdminInput,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  StatusBadge,
} from "@/components/admin-ui";
import { csrfFetch } from "@/lib/api";

type Item = {
  id: number;
  slug: string;
  title: string;
  description: string;
  rarity: string;
  iconKey: string;
  isActive: boolean;
  users: unknown[];
};

export function AdminAchievementsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState("");
  const [achievementId, setAchievementId] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/achievements", { cache: "no-store" });
    if (response.ok) {
      setItems(((await response.json()) as { items: Item[] }).items);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const response = await csrfFetch("/api/admin/achievements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        title,
        description: title,
        rarity: "common",
        iconKey: "award",
        isActive: true,
      }),
    });

    setStatus(response.ok ? "Достижение создано" : "Не удалось создать достижение");
    if (response.ok) {
      setSlug("");
      setTitle("");
      await load();
    }
  }

  async function grant(action: "grant" | "revoke") {
    const response = await csrfFetch("/api/admin/achievements/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: Number(userId),
        achievementId: Number(achievementId),
        action,
      }),
    });

    setStatus(response.ok ? "Действие выполнено" : "Не удалось выполнить действие");
    if (response.ok) await load();
  }

  return (
    <AdminShell>
      <AdminPageHeader
        title="Достижения"
        description="Каталог достижений и ручная выдача пользователям."
        breadcrumbs={[{ href: "/admin", label: "Админка" }, { label: "Достижения" }]}
      />

      <AdminSection>
        <div className="grid gap-3 md:grid-cols-3">
          <AdminInput value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug" />
          <AdminInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" />
          <button className="btn btn-primary" type="button" disabled={!slug || !title} onClick={create}>
            Создать
          </button>
        </div>
      </AdminSection>

      <AdminSection>
        <div className="grid gap-3 md:grid-cols-4">
          <AdminInput value={userId} onChange={(event) => setUserId(event.target.value)} inputMode="numeric" placeholder="ID пользователя" />
          <AdminInput value={achievementId} onChange={(event) => setAchievementId(event.target.value)} inputMode="numeric" placeholder="ID достижения" />
          <button className="btn btn-primary" type="button" onClick={() => grant("grant")}>
            Выдать
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => grant("revoke")}>
            Отозвать
          </button>
        </div>
        {status ? <p className="mt-2 text-sm text-[var(--text-secondary)]">{status}</p> : null}
      </AdminSection>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <AdminSection key={item.id}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--text-muted)]">#{item.id}</span>
              <StatusBadge value={item.isActive ? item.rarity : "неактивно"} />
            </div>
            <h2 className="mt-3 font-black text-[var(--text-primary)]">{item.title}</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{item.description}</p>
            <AdminActionBar className="mt-3">
              <StatusBadge value={`${item.users.length} пользователей`} />
            </AdminActionBar>
          </AdminSection>
        ))}
      </div>
    </AdminShell>
  );
}
