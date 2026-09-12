"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessRoute, type AppRole } from "@/lib/permissions";

function getRoleHome(role: AppRole) {
  if (role === "admin") return "/admin";
  if (role === "support") return "/support";
  if (role === "mentor") return "/admin/task-reports";
  if (role === "moderator") return "/admin/chat-moderation";
  if (role === "news_editor") return "/admin/news";
  return "/dashboard";
}

function getSafeNextPath(role: AppRole) {
  const next = new URLSearchParams(window.location.search).get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//") || !canAccessRoute(role, next)) {
    return getRoleHome(role);
  }

  return next;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    // AFD-3A3: the hard-coded `captchaToken: "dev-captcha-ok"` that used to sit
    // in this body is gone. It was never a token — it was a string chosen to
    // satisfy a stub, and under a permissive provider secret it would have been
    // accepted as one. This page is the Backend's own internal form on a
    // loopback-only origin and has no widget; the public learner surface is the
    // Academy's /login and the staff surface is the CRM's. Where login
    // verification is enforced this form is therefore refused with the standard
    // CAPTCHA error, which is the correct outcome for a form that cannot present
    // a genuine challenge. Nothing here fabricates one.
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      setError(result.message ?? result.error ?? "Не удалось войти");
      return;
    }

    const result = (await response.json()) as { user: { role: AppRole } };
    router.push(getSafeNextPath(result.user.role));
    router.refresh();
  }

  return (
    <section className="grid min-h-[68vh] items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-5">
        <span className="badge">Добро пожаловать обратно</span>
        <h1 className="page-title text-5xl">Вход в TradeQuest</h1>
        <p className="max-w-lg text-lg leading-8 text-[var(--text-secondary)]">
          Войдите, чтобы продолжить задания, проверить награды, открыть чат и увидеть текущий прогресс.
        </p>
      </div>

      <div className="app-card p-6 md:p-8">
        <form onSubmit={login} className="space-y-5">
          <div>
            <p className="page-kicker">Аккаунт</p>
            <h2 className="section-title mt-2">Войти</h2>
          </div>

          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              required
              className="form-input mt-2"
            />
          </label>

          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            Пароль
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="form-input mt-2"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            Показать пароль
          </label>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Входим..." : "Войти"}
          </button>
        </form>

        <p className="mt-5 text-sm text-[var(--text-secondary)]">
          Нет аккаунта?{" "}
          <Link href="/register" className="font-bold text-[var(--primary)]">
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </section>
  );
}
