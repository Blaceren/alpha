import type { Metadata } from "next";
import { AuthStage } from "@/features/auth/auth-stage";
import { LinkConfirmation } from "@/features/auth/link-confirmation";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Подтверждение почты — Alfa Trade Academy",
  description: "Подтвердите адрес почты вашего аккаунта.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** ACCOUNT RECOVERY — the page a confirmation link opens. Works signed in or not. */
export default function VerifyEmailPage() {
  return (
    <AuthStage
      headingId="verify-heading"
      eyebrow="ATA / ПОЧТА"
      title="Подтвердить почту."
      lead="Подтверждённый адрес — это способ вернуть доступ к аккаунту."
    >
      <LinkConfirmation kind="verify-email" />
    </AuthStage>
  );
}
