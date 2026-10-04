import type { Metadata } from "next";
import { Suspense } from "react";
import { getAcademyConfig } from "@/config/academy-config";
import { RegisterForm } from "@/features/auth/register-form";
import { AuthStage } from "@/features/auth/auth-stage";
import { readAccountCapabilities, readRegistrationOpensLearning } from "@/server/auth/account-read";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Регистрация — Alpha Trade Academy",
  description: "Создайте аккаунт Alpha Trade Academy, чтобы начать обучение.",
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
export default async function RegisterPage() {
  const { turnstileSiteKey } = getAcademyConfig();
  /* ACCOUNT RECOVERY — where the Backend can send mail, a new account's address
     gets a confirmation message, and the completed state says so. */
  const [{ emailVerification }, opensLearning] = await Promise.all([
    readAccountCapabilities(),
    readRegistrationOpensLearning(),
  ]);

  return (
    <AuthStage
      headingId="register-heading"
      eyebrow="ATA / НАЧАЛО"
      title="Начать путь."
      /* THE SUPPORTING LINE SAYS WHAT THIS DEPLOYMENT DOES (2026-10-04,
         launch audit). It used to say «Доступ к обучению открывает куратор»
         always — true when a curator enrolled learners, false since
         registration enrols on the program by itself (pre-production since
         2026-10-02), and the one line a new visitor reads first told them to
         wait for a person. The Backend now says which it is; when it cannot
         say, the cautious line stays. Tuition is free (owner, 2026-09-22). */
      lead={
        opensLearning
          ? "Регистрация бесплатная. Сразу после неё откроется первый уровень пути."
          : "Аккаунт открывает вход в Академию. Доступ к обучению открывает куратор."
      }
    >
      <Suspense fallback={null}>
        <RegisterForm turnstileSiteKey={turnstileSiteKey} verificationMail={emailVerification} />
      </Suspense>
    </AuthStage>
  );
}
