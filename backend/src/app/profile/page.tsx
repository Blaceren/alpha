"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProtectedPage } from "@/components/ProtectedPage";
import { Alert, Card, FormField, Input, PageHeader } from "@/components/ui";
import { csrfFetch } from "@/lib/api";

type ProfileData = {
  name: string;
  email: string;
  pendingEmail: string | null;
  pendingEmailRequestedAt: string | null;
  emailVerified: boolean;
  level: number;
  xp: number;
};

type Achievement = { id: number; title: string; granted: boolean };

export default function ProfilePage() {
  return <ProtectedPage><ProfileContent /></ProtectedPage>;
}

function ProfileContent() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [promocode, setPromocode] = useState("");
  const [message, setMessage] = useState("");
  const redeemAttempt = useRef<{ code: string; requestId: string } | null>(null);

  const load = useCallback(async () => {
    const [meResponse, achievementsResponse] = await Promise.all([
      fetch("/api/me", { cache: "no-store" }),
      fetch("/api/achievements", { cache: "no-store" }),
    ]);
    if (meResponse.ok) {
      const result = (await meResponse.json()) as { user: ProfileData };
      setProfile(result.user);
      setName(result.user.name);
    }
    if (achievementsResponse.ok) {
      const result = (await achievementsResponse.json()) as { items?: Achievement[]; achievements?: Achievement[] };
      setAchievements(result.items ?? result.achievements ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await csrfFetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}) }),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? (email.trim() ? "Новый email ожидает ручного подтверждения оператором." : "Никнейм сохранён.") : (result.message ?? "Не удалось сохранить профиль"));
    if (response.ok) { setEmail(""); await load(); }
  }

  async function redeem(event: FormEvent) {
    event.preventDefault();
    const normalizedCode = promocode.trim().toUpperCase();
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
      const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (response.ok || response.status < 500) redeemAttempt.current = null;
      setMessage(response.ok ? "Промокод активирован." : (result.message ?? result.error ?? "Промокод не активирован"));
      if (response.ok) { setPromocode(""); await load(); }
    } catch {
      setMessage("Ошибка сети. Повтор использует тот же идентификатор запроса.");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader kicker="Личный кабинет" title="Профиль" description="Публичный никнейм, email, достижения и промокоды в одном месте." />
      {message ? <Alert>{message}</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="section-title">Настройки аккаунта</h2>
          <form onSubmit={saveProfile} className="mt-4 space-y-4">
            <FormField label="Никнейм"><Input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={50} /></FormField>
            <FormField label="Текущий email"><Input value={profile?.email ?? ""} readOnly /></FormField>
            <p className="text-sm text-[var(--text-secondary)]">Статус: {profile?.emailVerified ? "подтверждён" : "не подтверждён"}</p>
            {profile?.pendingEmail ? <Alert>Ожидает подтверждения: {profile.pendingEmail}</Alert> : null}
            <FormField label="Новый email"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Оставьте пустым, если не меняете" /></FormField>
            <button type="submit" className="btn btn-primary">Сохранить</button>
          </form>
        </Card>
        <div className="space-y-5">
          <Card>
            <h2 className="section-title">Прогресс</h2>
            <p className="mt-3 text-[var(--text-secondary)]">Уровень {profile?.level ?? "—"} · {profile?.xp ?? 0} XP</p>
            <Link href="/achievements" className="mt-3 inline-block font-bold text-[var(--primary)]">Все достижения →</Link>
            <ul className="mt-3 space-y-2 text-sm">{achievements.filter((item) => item.granted).slice(0, 5).map((item) => <li key={item.id}>✓ {item.title}</li>)}</ul>
          </Card>
          <Card>
            <h2 className="section-title">Промокод</h2>
            <form onSubmit={redeem} className="mt-4 flex gap-2"><Input value={promocode} onChange={(event) => { setPromocode(event.target.value); redeemAttempt.current = null; }} required /><button className="btn btn-secondary">Активировать</button></form>
          </Card>
          <Card>
            <h2 className="section-title">Сеанс и безопасность</h2>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">Вы вошли в активный защищённый сеанс. Управление паролем и внешними OAuth-провайдерами будет добавлено отдельным security pass.</p>
          </Card>
        </div>
      </div>
    </section>
  );
}
