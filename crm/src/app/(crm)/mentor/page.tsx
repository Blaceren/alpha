import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

/**
 * Mentor practice review (G3).
 *
 * This file exists so the route resolves at all — without it Next answers 404
 * and the api-mode shell never gets a chance to run.
 *
 * In **api mode** these children are never rendered: `AppShell` matches the
 * pathname and mounts `MentorReviewWorkspace` inside `ApiShell` instead, exactly
 * as it does for `/report-review` and `/users`.
 *
 * In **mock mode** there is no mentor-review data provider and no backend, so
 * this renders the honest section placeholder rather than a fabricated queue.
 * Showing synthetic work awaiting "review" would imply an operator could act on
 * it.
 *
 * Note what the planned-features list no longer promises: an approve/**reject**
 * pair. The canonical mentor-review lifecycle has exactly two transitions and
 * approval is the only exit from `pending_review`, so advertising a rejection
 * step here would describe a workflow the platform does not implement.
 */
export default function MentorPage() {
  return (
    <SectionPlaceholder
      title="Проверка практики"
      purpose="Очередь практических работ, отправленных учениками на проверку наставником. Приём работы засчитывает уровень и начисляет XP."
      plannedFeatures={[
        "Очередь работ, ожидающих проверки",
        "Учебный контекст ученика",
        "Приём работы",
      ]}
    />
  );
}
