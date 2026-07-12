import Link from "next/link";
import { AdminPageHeader, AdminSection, AdminShell, AdminStatCard, StatusBadge } from "@/components/admin-ui";
import { ProtectedPage } from "@/components/ProtectedPage";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const adminSections = [
  { href: "/admin/users", title: "Пользователи", description: "Роли, статус, уровни и XP.", group: "Ядро" },
  { href: "/admin/tasks", title: "Задания", description: "Шаги обучения, XP, отчёты и контрольные точки.", group: "Контент" },
  { href: "/admin/rewards", title: "Награды", description: "Каталог наград и активные состояния.", group: "Контент" },
  { href: "/admin/promocodes", title: "Промокоды", description: "Лимиты, доступность и история активаций.", group: "Контент" },
  { href: "/admin/achievements", title: "Достижения", description: "Каталог, выдача пользователям и отзыв.", group: "Контент" },
  { href: "/admin/news", title: "Новости", description: "Черновики, публикация и редакторский workflow.", group: "Контент" },
  { href: "/admin/task-reports", title: "Отчёты по заданиям", description: "Очередь проверки для ментора и администратора.", group: "Команда" },
  { href: "/admin/feedback", title: "Проблемы пользователей", description: "Полный текст, контекст, severity и статусы обращений.", group: "Команда" },
  { href: "/admin/exchange", title: "Биржа", description: "Sandbox/manual аккаунты и состояние postback-событий.", group: "Операции" },
  { href: "/admin/chat-moderation", title: "Модерация чата", description: "Стоп-слова, мьюты и журнал модерации.", group: "Операции" },
  { href: "/admin/audit-logs", title: "Аудит", description: "Последние security/admin действия.", group: "Операции" },
  { href: "/crm", title: "CRM", description: "Когорты, лиды и атрибуция Pocket macros.", group: "Внутреннее" },
  { href: "/open-questions", title: "Открытые вопросы", description: "Внутренняя доска нерешённых вопросов.", group: "Внутреннее" },
];

export default async function AdminPage() {
  const groups = Array.from(new Set(adminSections.map((section) => section.group)));
  const [newFeedback, criticalFeedback, openSupport, pendingReports] = await Promise.all([
    prisma.testerFeedback.count({ where: { status: "new" } }),
    prisma.testerFeedback.count({ where: { severity: { in: ["high", "blocker"] }, status: { in: ["new", "triaged", "in_progress"] } } }),
    prisma.supportDialog.count({ where: { status: { in: ["new", "in_progress", "waiting_user"] } } }),
    prisma.taskReport.count({ where: { status: "pending" } }),
  ]);

  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <AdminShell>
        <AdminPageHeader
          title="Админ-консоль"
          description="Операционная панель для существующих MVP-разделов. Новая аналитика здесь не выводится."
          breadcrumbs={[{ label: "Админка" }]}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStatCard label="Новый feedback" value={newFeedback} detail={`Критичных нерешённых: ${criticalFeedback}`} />
          <AdminStatCard label="Открытый саппорт" value={openSupport} detail="Диалоги требуют внимания" />
          <AdminStatCard label="Отчёты" value={pendingReports} detail="Ожидают проверки" />
          <AdminStatCard label="Система" value={<StatusBadge value="readiness" />} detail="Проверяется RC smoke" />
        </div>

        {groups.map((group) => (
          <AdminSection key={group}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="section-title">{group}</h2>
              <StatusBadge value={`${adminSections.filter((section) => section.group === group).length} разделов`} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {adminSections
                .filter((section) => section.group === group)
                .map((section) => (
                  <Link
                    key={section.href}
                    href={section.href}
                    className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-bold text-[var(--text-primary)]">{section.title}</h3>
                      <span className="text-sm font-black text-[var(--primary)]">Открыть</span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">{section.description}</p>
                  </Link>
                ))}
            </div>
          </AdminSection>
        ))}
      </AdminShell>
    </ProtectedPage>
  );
}
