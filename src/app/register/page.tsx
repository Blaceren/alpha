import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/features/auth/register-form";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Регистрация — Alfa Trade Academy",
  description: "Создайте аккаунт Alfa Trade Academy, чтобы начать обучение.",
  // A registration page has nothing to gain from indexing and the URL may carry
  // an invite code.
  robots: { index: false, follow: false },
};

// The referral parameter and the form state are per-request; never prerender.
export const dynamic = "force-dynamic";

/**
 * The public registration surface (AFD-3A).
 *
 * Reuses the anonymous auth layout established by `/login`. The copy below
 * states only what the Backend registration owner actually does: it creates an
 * account. It does not promise enrolment, level access, a mentor, a Pocket
 * account or earnings — none of which registration performs.
 */
export default function RegisterPage() {
  return (
    <main className="login">
      <section className="login-card" aria-labelledby="register-heading">
        <p className="login-brand">Alfa Trade Academy</p>
        <h1 id="register-heading" className="login-title">
          Создать аккаунт
        </h1>
        <p className="login-subtitle">
          Аккаунт открывает вход в Академию. Доступ к обучению открывает куратор.
        </p>
        <Suspense fallback={null}>
          <RegisterForm />
        </Suspense>
      </section>
    </main>
  );
}
