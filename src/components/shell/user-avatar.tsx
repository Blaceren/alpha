function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * Profile access via the user's avatar (initials placeholder — no real photo).
 * The profile page is not built in D1B, so this is a focusable dev-safe control
 * (no 404). The real profile route arrives in a later phase.
 */
export function UserAvatar({ name }: { name: string }) {
  return (
    <button type="button" className="avatar" aria-label={`Профиль — ${name}`} title="Профиль">
      <span aria-hidden="true">{initials(name)}</span>
    </button>
  );
}
