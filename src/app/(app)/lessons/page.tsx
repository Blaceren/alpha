import { redirect } from "next/navigation";
import { levelCodeFor } from "@/features/lesson/model/lesson";
import { CURRENT_LESSON_LEVEL } from "@/features/lesson/data/lesson-fixtures";

/**
 * /lessons — the contextual default for the «Уроки» destination.
 *
 * ROUTE_MAP defines /lessons as the lesson library whose default is the active
 * lesson. D2B does not build a library (it builds the lesson experience), so
 * /lessons resolves to its documented default — the current lesson — instead of
 * the 404 the navigation used to hit. The library itself arrives with D3.
 */
export default function LessonsIndexPage() {
  redirect(`/lessons/${levelCodeFor(CURRENT_LESSON_LEVEL)}`);
}
