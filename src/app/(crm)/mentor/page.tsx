import { SectionPlaceholder } from "@/components/navigation/section-placeholder";

export default function MentorPage() {
  return (
    <SectionPlaceholder
      title="Mentor"
      purpose="Очередь mentor-проверок reports и assignments с учётом SLA."
      plannedFeatures={[
        "Очередь по SLA",
        "Approve/Reject с follow-up",
        "Learning-контекст пользователя",
      ]}
    />
  );
}
