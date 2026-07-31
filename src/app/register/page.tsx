"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    setReferralCode(new URLSearchParams(window.location.search).get("ref") ?? "");
  }, []);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // AFD-3A3: the `"dev-captcha-ok"` sentinel is removed here for the same
      // reason as on the login page — it is a fabricated token, not a solved
      // challenge. Registration verification is unconditional, so this internal
      // loopback form is refused; the public registration surface is the
      // Academy's /register, which renders a real widget.
      body: JSON.stringify({ name, email, password, referralCode: referralCode || undefined }),
    });

    setIsSubmitting(false);

    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      verification?: { required?: boolean };
    };

    if (!response.ok) {
      setError(result.message ?? result.error ?? "Не удалось зарегистрироваться");
      return;
    }

    if (result.verification?.required) {
      setSuccess("Аккаунт создан. Перед входом подтвердите email по инструкции оператора closed beta.");
      return;
    }

    router.push("/dashboard?welcome=1");
    router.refresh();
  }

  return (
    <section className="grid min-h-[68vh] items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-5">
        <span className="badge">Старт обучения</span>
        <h1 className="page-title text-5xl">Создайте аккаунт</h1>
        <p className="max-w-lg text-lg leading-8 text-[var(--text-secondary)]">
          После регистрации откроются задания, уровни, награды, комьюнити и прогресс по контрольным точкам.
        </p>
      </div>

      <div className="app-card p-6 md:p-8">
        <form onSubmit={register} className="space-y-5">
          <div>
            <p className="page-kicker">Новый пользователь</p>
            <h2 className="section-title mt-2">Регистрация</h2>
          </div>

          {referralCode ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--primary-soft)] p-3 text-sm text-[var(--text-secondary)]">
              Реферальный бонус будет начислен после регистрации.
            </div>
          ) : null}

          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            Никнейм
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              type="text"
              autoComplete="nickname"
              required
              minLength={2}
              maxLength={50}
              className="form-input mt-2"
            />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">Публичное имя для рейтинга, сообщества и профиля.</span>
          </label>

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
              autoComplete="new-password"
              required
              className="form-input mt-2"
            />
          </label>

          <p className="text-xs leading-5 text-[var(--text-muted)]">
            Пароль должен содержать строчную букву, заглавную букву и цифру.
          </p>

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
          {success ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div> : null}

          <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Создаём..." : "Зарегистрироваться"}
          </button>
        </form>

        <p className="mt-5 text-sm text-[var(--text-secondary)]">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="font-bold text-[var(--primary)]">
            Войти
          </Link>
        </p>
      </div>
    </section>
  );
}
