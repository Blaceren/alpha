import Link from "next/link";

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * Profile access via the user's avatar (initials placeholder — no real photo).
 * This was a dead control while `/profile` did not exist. It does now, so the
 * avatar leads there.
 */
export function UserAvatar({ name }: { name: string }) {
  return (
    <Link href="/profile" className="avatar" aria-label={`Профиль — ${name}`} title="Профиль">
      <span aria-hidden="true">{initials(name)}</span>
    </Link>
  );
}
