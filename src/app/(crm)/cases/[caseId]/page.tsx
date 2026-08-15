import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

/**
 * One Learner Operations work item.
 *
 * This file exists so the route resolves at all — without it Next answers 404
 * and the api-mode shell never gets a chance to run.
 *
 * In **api mode** this child is never rendered: `AppShell` matches the pathname
 * and mounts `CaseDetailWorkspace` inside `ApiShell` instead, exactly as it does
 * for `/users/{id}`.
 *
 * In **mock mode** there is no Learner Operations data provider and no backend,
 * so this renders the honest section placeholder rather than a fabricated case.
 * Showing a synthetic conversation with a synthetic learner would imply an
 * operator could reply to somebody.
 */
export default function LearnerOpsCasePage() {
  return (
    <SectionPlaceholder
      title="Обращение"
      purpose="Одно обращение: переписка с учеником, внутренние заметки, история, SLA и эскалации."
      plannedFeatures={[
        "Переписка, видимая ученику",
        "Внутренние заметки, недоступные ученику",
        "Назначение, статус, приоритет и SLA",
      ]}
    />
  );
}
