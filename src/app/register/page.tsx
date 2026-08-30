import type { Metadata } from "next";
import { Suspense } from "react";
import { getAcademyConfig } from "@/config/academy-config";
import { RegisterForm } from "@/features/auth/register-form";
import { AuthStage } from "@/features/auth/auth-stage";
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
 * The public registration surface (AFD-3A, Turnstile added in AFD-3A2).
 *
 * Reuses the anonymous auth layout established by `/login`. The copy below
 * states only what the Backend registration owner actually does: it creates an
 * account. It does not promise enrolment, level access, a mentor, a Pocket
 * account or earnings — none of which registration performs.
 *
 * The Turnstile SITE key is read here, on the server, at request time (the page
 * is `force-dynamic`) and passed down as a prop. It is public by design, but
 * runtime injection means one build serves every deployment and rotating the
 * widget does not require a release. The SECRET never leaves the Backend.
 */
export default function RegisterPage() {
  const { turnstileSiteKey } = getAcademyConfig();

  return (
    <AuthStage
      headingId="register-heading"
      title="Создать аккаунт"
      lead="Аккаунт открывает вход в Академию. Доступ к обучению открывает куратор."
    >
      <Suspense fallback={null}>
        <RegisterForm turnstileSiteKey={turnstileSiteKey} />
      </Suspense>
    </AuthStage>
  );
}
