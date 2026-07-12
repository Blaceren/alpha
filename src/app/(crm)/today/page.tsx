import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { ProviderSmoke } from "@/components/crm-shell/provider-smoke";

export default function TodayPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Сегодня"
        description="Стартовый экран смены: приоритезированные очереди и рекомендованные действия."
        actions={<Badge tone="info">Каркас · Phase 1A</Badge>}
      />
      <p className="text-sm text-text-secondary">
        Полноценные очереди Today появятся в Phase 1B. Ниже — техническая проверка того, что
        оболочка получает данные строго через <code className="text-text-primary">CrmDataProvider</code>.
      </p>
      <ProviderSmoke />
    </div>
  );
}
