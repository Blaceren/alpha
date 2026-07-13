import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { ProviderSmoke } from "@/components/crm-shell/provider-smoke";
import { isDevelopment } from "@/config/env";

export default function TodayPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Сегодня"
        description="Стартовый экран смены: приоритезированные очереди и рекомендованные действия."
        actions={isDevelopment ? <Badge tone="info">Каркас · Phase 1A</Badge> : undefined}
      />
      {isDevelopment ? (
        <>
          <p className="text-sm text-text-secondary">
            Полноценные очереди Today появятся на следующем этапе. Ниже — dev-диагностика
            доменного слоя.
          </p>
          <ProviderSmoke />
        </>
      ) : (
        <p className="text-sm text-text-secondary">
          Рабочие очереди появятся на следующем этапе.
        </p>
      )}
    </div>
  );
}
