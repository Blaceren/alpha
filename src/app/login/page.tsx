import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Вход — Alfa Trade Academy",
  description: "Войдите в Alfa Trade Academy, чтобы продолжить обучение.",
};

// The guard/redirect logic depends on the request; never statically prerender.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="login">
      <section className="login-card" aria-labelledby="login-heading">
        <p className="login-brand">Alfa Trade Academy</p>
        <h1 id="login-heading" className="login-title">
          Вход
        </h1>
        <p className="login-subtitle">Продолжите свой путь обучения.</p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
