import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

/**
 * Mentor report review.
 *
 * This file exists so the route resolves at all — without it Next answers 404 and
 * the api-mode shell never gets a chance to run.
 *
 * In **api mode** these children are never rendered: `AppShell` matches the
 * pathname and mounts `ReportReviewWorkspace` inside `ApiShell` instead, exactly as
 * it does for `/users`.
 *
 * In **mock mode** there is no report-review data provider and no backend, so this
 * renders the honest section placeholder rather than a fabricated queue. Showing
 * synthetic reports awaiting "review" would imply an operator could act on them.
 */
export default function ReportReviewPage() {
  return (
    <SectionPlaceholder
      title="Проверка отчётов"
      purpose="Очередь отчётов учеников на проверку наставником: рубрика R1–R7, отправка на доработку и приём отчёта."
      plannedFeatures={[
        "Очередь отчётов, ожидающих проверки",
        "Отчёт по 5 demo-сделкам и итоги",
        "Рубрика R1–R7 и решение по отчёту",
      ]}
    />
  );
}
