import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { passportAccount, readProfile } from "@/server/profile/profile-read";
import { ProfilePassport } from "@/features/profile-fidelity/profile-passport";
import { ProfileTabs } from "@/features/profile-fidelity/profile-tabs";
import { SupportHub } from "@/features/support/components/support-hub";
import "@/features/support/support.css";
import "@/features/profile-fidelity/profile-fidelity.css";
import "@/features/profile-fidelity/profile-hifi.css";

export const metadata: Metadata = {
  title: "Поддержка — Alpha Trade Academy",
  description:
    "Обращения в поддержку Академии: задать вопрос, посмотреть ответы команды и продолжить переписку.",
};

export const dynamic = "force-dynamic";

/**
 * Поддержка, as a part of the profile (/profile/support).
 *
 * The owner, 2026-10-03: «поддержку тоже сюда переноси, что бы написать в
 * поддержку можно было только из профиля, не по ссылке из хеда». So the
 * learner's case desk — the same `SupportHub`, unchanged: their requests, the
 * conversation on each, a form for a new one — sits under the profile's
 * passport and its two parts, and the shell's bar no longer carries it.
 * `/support` answers with a redirect here, so an old link still arrives.
 *
 * The shell marks «Профиль» as the current section, because that is where the
 * learner is. The desk keeps its own h1, «Поддержка»; on screen the active part
 * already says it, so the heading is there for a screen reader.
 */
export default async function ProfileSupportPage() {
  const { viewer, account, position, tools } = await readProfile();
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="profile" frozenSurface notificationPresence={<UnreadPresence />}>
      <div className="pf pf--hifi">
        <div className="p-profile p-profile--frame" data-part="support">
          <p className="p-coord p-coord--page">Профиль</p>
          {viewer ? (
            <ProfilePassport name={viewer.name} account={passportAccount(account)} position={position} tools={tools} />
          ) : null}
          <ProfileTabs current="support" />
        </div>
      </div>
      <div className="pp-support">
        <SupportHub />
      </div>
    </AppShell>
  );
}
