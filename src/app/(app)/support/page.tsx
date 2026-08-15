import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { SupportHub } from "@/features/support/components/support-hub";
import "@/features/support/support.css";

export const metadata: Metadata = {
  title: "Поддержка — Alfa Trade Academy",
  description:
    "Обращения в поддержку Академии: задать вопрос, посмотреть ответы команды и продолжить переписку.",
};

/**
 * Поддержка (/support).
 *
 * The navigation canon has offered this route since the design system phase and
 * nothing answered it — `PRIMARY_NAV` and `MORE_MENU` both carried a link to a
 * page that did not exist. LEARNER-OPERATIONS-V1 connects it to the real
 * operational department rather than adding a new entry beside the dead one.
 */
export default function SupportPage() {
  return (
    <AppShell userName="Артём" activeId="support">
      <SupportHub />
    </AppShell>
  );
}
