import { cn } from "@/lib/cn";

export interface AvatarProps {
  /** Full name; initials are derived for the fallback. */
  name: string;
  size?: number;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * Provisional avatar: renders initials on a themed gradient. No real user photo.
 * Replaced by a real image asset later.
 */
export function Avatar({ name, size = 36, className }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center justify-center rounded-full",
        "font-ui font-semibold text-[#06080c]",
        "bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))]",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
