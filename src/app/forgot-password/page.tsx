import type { Metadata } from "next";
import Link from "next/link";
import { getAcademyConfig } from "@/config/academy-config";
import { AuthStage } from "@/features/auth/auth-stage";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { readAccountCapabilities } from "@/server/auth/account-read";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Сброс пароля — Alfa Trade Academy",
  description: "Получите ссылку для нового пароля на почту аккаунта.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * ACCOUNT RECOVERY — the request for a reset link.
 *
 * The page asks the Backend whether this deployment can send mail before it
 * shows a form: a form that produces no message would leave the person waiting
 * for one. Where it cannot, the page says so and offers the way back — the
 * login page does not link here in that case, so this is what a bookmarked or
 * typed address finds.
 */
export default async function ForgotPasswordPage() {
  const { turnstileSiteKey } = getAcademyConfig();
  const capabilities = await readAccountCapabilities();

  return (
    <AuthStage
      headingId="forgot-heading"
      eyebrow="ATA / ВОССТАНОВЛЕНИЕ"
      title="Сбросить пароль."
      lead="Укажите почту аккаунта — мы отправим на неё ссылку для нового пароля."
    >
      {capabilities.passwordRecovery ? (
        <ForgotPasswordForm turnstileSiteKey={turnstileSiteKey} />
      ) : (
        <div className="register-success" role="status" data-role="recovery-unavailable">
          <h2 className="register-success__title">Пока недоступно</h2>
          <p className="register-success__body">Восстановление пароля по почте сейчас не работает.</p>
          <Link className="register-submit register-submit--link" href="/login">
            Вернуться ко входу
          </Link>
        </div>
      )}
    </AuthStage>
  );
}
