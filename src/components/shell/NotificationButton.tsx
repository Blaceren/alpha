import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icon";

/** Notification access with an unread indicator (synthetic). */
export function NotificationButton({ unread = true }: { unread?: boolean }) {
  return (
    <span className="relative inline-flex">
      <IconButton label="Уведомления">
        <Icon name="bell" className="h-5 w-5" />
      </IconButton>
      {unread && (
        <span
          className="pointer-events-none absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--background-base)]"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
