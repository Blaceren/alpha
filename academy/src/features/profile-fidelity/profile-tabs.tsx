import Link from "next/link";

/**
 * The profile's two parts: the account, and support (owner, 2026-10-03: «что бы
 * написать в поддержку можно было только из профиля, не по ссылке из хеда»).
 *
 * Two links between two pages, not a script-driven tab widget: each part has
 * its own address, Back works, and the current one says so with
 * `aria-current="page"` — the same contract every other navigation in the
 * product keeps.
 */
export type ProfilePart = "account" | "support";

export const PROFILE_PARTS: ReadonlyArray<{ id: ProfilePart; label: string; href: string }> = [
  { id: "account", label: "Аккаунт", href: "/profile" },
  { id: "support", label: "Поддержка", href: "/profile/support" },
];

export function ProfileTabs({ current }: { current: ProfilePart }) {
  return (
    <nav className="pp-tabs" aria-label="Разделы профиля">
      {PROFILE_PARTS.map((part) => (
        <Link
          key={part.id}
          className="pp-tab"
          href={part.href}
          data-part={part.id}
          aria-current={part.id === current ? "page" : undefined}
        >
          {part.label}
        </Link>
      ))}
    </nav>
  );
}
