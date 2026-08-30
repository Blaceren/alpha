import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

/**
 * Notification access, and the slot where the shell's one honest claim about
 * unread goes.
 *
 * THIS FILE IMPORTS NOTHING SERVER-ONLY, AND THAT IS THE POINT. The shell is
 * rendered by server pages AND by the client error boundary at
 * `(app)/home/error.tsx`. A `next/headers` import anywhere in this module's
 * graph therefore lands in the client bundle and the build refuses it — which
 * is exactly what happened when the unread read lived here. The read is a
 * SERVER concern, so it is passed IN as an element and the shell stays neutral
 * about where it came from.
 *
 * AN ABSENT SLOT IS A WITHHELD CLAIM, NOT A FALSE ONE. The mark used to render
 * from `unread = true` — a literal default, so it was permanently lit on every
 * page for every learner, including the notifications page when it said there
 * was nothing. The frozen Notifications design records a hard-coded indicator
 * as INVALID PRODUCT TRUTH. Nothing is now shown unless something knew.
 */
export function NotificationButton({ presence }: { presence?: ReactNode }) {
  return (
    <Link href="/notifications" className="iconbtn" aria-label="Уведомления">
      <Icon name="bell" className="h-5 w-5" />
      {/* Streamed, so the bell is interactive whether or not the answer has
          arrived, and the page never waits on it. */}
      {presence ? <Suspense fallback={null}>{presence}</Suspense> : null}
    </Link>
  );
}
