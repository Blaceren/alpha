import type { Metadata } from "next";
import { AuthStage } from "@/features/auth/auth-stage";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Новый пароль — Alpha Trade Academy",
  description: "Задайте новый пароль для входа в Академию.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * ACCOUNT RECOVERY — the page a reset link opens.
 *
 * The link's token is in the URL fragment, which no server receives, so this
 * page renders the same for every visitor and the form reads the token in the
 * browser (see `reset-password-form.tsx`).
 */
export default function ResetPasswordPage() {
  return (
    <AuthStage
      headingId="reset-heading"
      eyebrow="ATA / НОВЫЙ ПАРОЛЬ"
      title="Задать новый пароль."
      lead="Ссылка из письма позволяет один раз задать новый пароль."
    >
      <ResetPasswordForm />
    </AuthStage>
  );
}
