import { Icon } from "@/components/ui/icon";

/** Notification access with an unread indicator (synthetic). Icon-only → labelled. */
export function NotificationButton({ unread = true }: { unread?: boolean }) {
  return (
    <button type="button" className="iconbtn" aria-label="Уведомления">
      <Icon name="bell" className="h-5 w-5" />
      {unread && <span className="dot" aria-hidden="true" />}
    </button>
  );
}
