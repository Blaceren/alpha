import Link from "next/link";
import { Icon } from "@/components/ui/icon";

/**
 * Notification access. It used to be a `<button>` that did nothing because the
 * route did not exist; the route exists now, so this is a link and the bell
 * actually leads to the learner's notifications.
 */
export function NotificationButton({ unread = true }: { unread?: boolean }) {
  return (
    <Link href="/notifications" className="iconbtn" aria-label="Уведомления">
      <Icon name="bell" className="h-5 w-5" />
      {unread && <span className="dot" aria-hidden="true" />}
    </Link>
  );
}
