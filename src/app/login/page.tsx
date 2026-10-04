import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAcademyConfig } from "@/config/academy-config";
import { LoginForm } from "@/features/auth/login-form";
import { AuthStage } from "@/features/auth/auth-stage";
import { readAccountCapabilities } from "@/server/auth/account-read";
import { readServerSession } from "@/server/auth/server-session";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Вход — Alpha Trade Academy",
  description: "Войдите в Alpha Trade Academy, чтобы продолжить обучение.",
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
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  /* A learner who is signed in has nothing to do here (2026-10-04, launch
     audit): signing in again replaced the session, and from /register a second
     account could be made over the first. They go where they were heading.
     Only a confirmed viewer is sent on — a Backend that cannot answer leaves
     the form on screen. */
  const session = await readServerSession();
  if (session.kind === "viewer") {
    const raw = (await searchParams)?.next;
    redirect(sanitizeReturnTo(Array.isArray(raw) ? raw[0] : raw));
  }

  const { turnstileSiteKey } = getAcademyConfig();
  /* ACCOUNT RECOVERY — «Забыли пароль?» is offered only where the Backend says a
     reset message can be sent. The read is fail-closed: unreachable means no. */
  const { passwordRecovery } = await readAccountCapabilities();

  return (
    <AuthStage
      headingId="login-heading"
      eyebrow="ATA / ВХОД"
      title="Продолжить свой путь."
      lead="Вернитесь к текущему уровню, своим решениям и сохранённому прогрессу."
    >
      <Suspense fallback={null}>
        <LoginForm turnstileSiteKey={turnstileSiteKey} passwordRecovery={passwordRecovery} />
      </Suspense>
    </AuthStage>
  );
}
