import { redirect } from "next/navigation";

/**
 * Production "Главная" (/) is intentionally NOT built in Phase D1A.
 * During art-direction exploration, root redirects to the concepts board.
 */
export default function RootPage() {
  redirect("/concepts");
}
