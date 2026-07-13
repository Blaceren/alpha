# Alfa Trade Academy — Web V2

Последовательная образовательная платформа по трейдингу (100 уровней / 20 модулей). Pocket —
торговая площадка (деньги видны только там); ATA — обучение, progression, planning, analysis,
discipline и сопровождение. ATA не является торговым терминалом.

> **Статус: Phase D1A** — application foundation + art-direction board. Реальный продукт ещё не
> реализован: построены foundation, дизайн-токены, shell и три концепта Главной. Backend / CRM /
> Pocket / database / deploy — не подключены. Все данные synthetic.

## Требования

- Node.js ≥ 18.18 (разработка велась на Node 25)
- npm (не смешивать с другими package managers)

## Установка

```bash
npm install
npx playwright install chromium   # для e2e и screenshots
```

## Скрипты

| Скрипт | Действие |
|--------|----------|
| `npm run dev` | dev-сервер |
| `npm run build` | production build |
| `npm run start` | запуск production build |
| `npm run lint` | ESLint (flat config, eslint-config-next) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run test` / `npm run test:run` | Vitest (watch / однократно) |
| `npm run test:e2e` | Playwright smoke suite |
| `npm run screenshots` | Playwright — реальные screenshots концептов |

## Art-direction board (D1A)

Development-only маршруты (вне production sitemap):

- `/concepts` — доска сравнения
- `/concepts/product-portal` — Direction A
- `/concepts/market-atlas` — Direction B
- `/concepts/editorial-academy` — Direction C

Победитель на этом этапе не выбран. См. `docs/ART_DIRECTION_BOARD.md` и
`design-memory/reviews/d1a-art-directions-review.md`.

## Документация

Source of truth — `docs/` (product context, IA, design system, page inventory, curriculum,
user flows, states, motion, content/tone, QA-протокол, implementation plan/status, decisions),
главный бриф — `ATA_PRODUCT_DESIGN_BRIEF_V1.md`, guidance для агентов — `CLAUDE.md`.
Frontend-архитектура — `docs/FRONTEND_ARCHITECTURE.md`.

## Финансовая приватность

Продукт никогда не показывает баланс/депозиты/выводы пользователя и не рассчитывает «осталось $X».
Единственное денежное значение в UI — target ближайшей контрольной точки.
