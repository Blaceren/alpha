# Alfa Trade Academy CRM — Phase 0 / 0.5 Blueprint

Набор проектных документов для отдельной внутренней CRM-системы Alfa Trade Academy. Только проектирование на synthetic/mock data — **код не написан, production не затронут**.

## Решения и модель состояний (Phase 0.5)

- [DECISIONS.md](./DECISIONS.md) — зафиксированные решения (D-01…D-12), ответы на 10 вопросов Phase 0.
- [STATE_MODEL.md](./STATE_MODEL.md) — **каноническая 5-мерная модель состояний** (заменяет прежний lifecycle mega-enum).
- [SIGNAL_CATALOG.md](./SIGNAL_CATALOG.md) — каталог сигналов и пороговые значения.
- [SLA_POLICY.md](./SLA_POLICY.md) — SLA-политика.
- [PII_ACCESS_POLICY.md](./PII_ACCESS_POLICY.md) — доступ к PII, Reveal-flow.

## Базовые документы (Phase 0, обновлены в 0.5)

1. [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — продуктовый контекст и назначение CRM.
2. [CRM_INFORMATION_ARCHITECTURE.md](./CRM_INFORMATION_ARCHITECTURE.md) — навигация, разделы, сценарии сотрудников.
3. [CRM_DOMAIN_MODEL.md](./CRM_DOMAIN_MODEL.md) — TypeScript domain entities (5-мерное состояние).
4. [ROLE_PERMISSION_MATRIX.md](./ROLE_PERMISSION_MATRIX.md) — матрица ролей, финансовые бакеты, PII.
5. [DATA_PROVIDER_CONTRACT.md](./DATA_PROVIDER_CONTRACT.md) — интерфейс `CrmDataProvider`.
6. [MOCK_DATA_PLAN.md](./MOCK_DATA_PLAN.md) — 30 synthetic personas в 5-мерной нотации.
7. [UX_BLUEPRINT.md](./UX_BLUEPRINT.md) — desktop-first UX и состояния экранов.
8. [FUTURE_INTEGRATION.md](./FUTURE_INTEGRATION.md) — будущие API от backend (без прямого доступа к БД).
9. [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — этапы, утверждённый стек, структура, риски, остаточные вопросы.

## Статус

Phase 0 архитектурно принят. Phase 0.5 (исправление модели состояний + Decision Lock) завершён. Все 10 блокирующих вопросов Phase 0 закрыты (DECISIONS.md). Следующий шаг — Phase 1 (app foundation, дизайн-система, CRM shell, mock provider). Реализация не начата.

## Границы первого этапа

Никакого доступа к production DB / Prisma / Pocket / production-коду. Только mock-данные. Все изменяющие действия помечаются как mock/local. Интеграция с продуктом — позже, через отдельный защищённый API, без переписывания UI.
