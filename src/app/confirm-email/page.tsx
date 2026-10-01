import type { Metadata } from "next";
import { AuthStage } from "@/features/auth/auth-stage";
import { LinkConfirmation } from "@/features/auth/link-confirmation";
import "@/features/auth/auth.css";

export const metadata: Metadata = {
  title: "Новый адрес почты — Alfa Trade Academy",
  description: "Подтвердите новый адрес почты вашего аккаунта.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** ACCOUNT RECOVERY — the page a change-of-address link opens. Works signed in or not. */
export default function ConfirmEmailPage() {
  return (
    <AuthStage
      headingId="confirm-email-heading"
      eyebrow="ATA / ПОЧТА"
      title="Подтвердить новый адрес."
      lead="После подтверждения вход будет выполняться по новой почте."
    >
      <LinkConfirmation kind="email-change" />
    </AuthStage>
  );
}
