import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { getServerViewer } from "@/server/auth/server-session";
import { UnreadPresence } from "@/components/shell/unread-presence";
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
 *
 * THE SHELL SHOWS WHOEVER IS SIGNED IN. This route passed a hardcoded fixture
 * name, so the same authenticated learner read their own name on /tools and a
 * stranger's on /support. The viewer is read the way Tools, Profile and
 * Notifications already read it — the same server session, no new endpoint, no
 * change to auth — and the fallback is the same neutral «Ученик» those routes
 * use when there is no viewer to name.
 *
 * `frozenSurface` FOR THE CANVAS, NOT FOR A NEW MECHANISM. The shell paints two
 * decorative radial washes behind an ordinary route; over the field ground they
 * read as a greener canvas than every accepted surface beside it — Support
 * measured `rgb(17, 20, 15)` where Tools and Lessons measure `rgb(11, 13, 10)`.
 * The flag that flattens that wash to the flat Ink ground already exists and is
 * already carried by Tools, Profile and Notifications; Support was simply left
 * out of it. The shell is not changed, and no wrapper is added.
 */
export default async function SupportPage() {
  const viewer = await getServerViewer();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="support" frozenSurface notificationPresence={<UnreadPresence />}>
      <SupportHub />
    </AppShell>
  );
}
