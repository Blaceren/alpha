import type { Metadata } from "next";
import { Suspense } from "react";
import { getAcademyConfig } from "@/config/academy-config";
import { LoginForm } from "@/features/auth/login-form";
import { AuthStage } from "@/features/auth/auth-stage";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Вход — Alfa Trade Academy",
  description: "Войдите в Alfa Trade Academy, чтобы продолжить обучение.",
};

// The guard/redirect logic depends on the request; never statically prerender.
export const dynamic = "force-dynamic";

/**
 * The Turnstile SITE key is read here, on the server, at request time (the page
 * is `force-dynamic`) and passed down as a prop — the same contract `/register`
 * uses. It is public by design, but runtime injection means one build serves
 * every deployment and rotating the widget does not require a release. The
 * SECRET never leaves the Backend and is not readable from this package.
 */
export default function LoginPage() {
  const { turnstileSiteKey } = getAcademyConfig();

  return (
    <AuthStage headingId="login-heading" title="Вход" lead="Продолжите свой путь обучения.">
      <Suspense fallback={null}>
        <LoginForm turnstileSiteKey={turnstileSiteKey} />
      </Suspense>
    </AuthStage>
  );
}
