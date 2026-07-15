# Phase 1B2 — Users workspace screenshots

Реальный браузерный рендер (headless **Chromium 149**, Playwright), сгенерировано
`tests-e2e/users-screenshots.spec.ts`. Все PNG — точных размеров, консоль чистая
(no runtime / hydration / missing-key / failed-asset errors).

| Файл | Размер | Сценарий |
|---|---|---|
| `users-admin-1440x900.png` | 1440×900 | admin; exact-финансы открыты через «Колонки» |
| `users-support-1440x900.png` | 1440×900 | support; bucket-финансы (`$50–99`), exact отсутствует |
| `users-filtered-1440x900.png` | 1440×900 | compound-фильтр `Фондирован`+`Активен` (16 результатов) |
| `users-tablet-1024x768.png` | 1024×768 | toolbar-wrap, скрытие второстепенных колонок |
| `users-mobile-390x844.png` | 390×844 | mobile-карточки + фильтры в Sheet |

## Перегенерация
```
cd ata-crm
npx playwright install chromium     # либо системный Chrome через channel
npm run test:e2e
```
Спек одновременно ассертит чистую консоль. Ревью и найденные/исправленные проблемы —
`docs/visual-reviews/PHASE_1B2_USERS.md`.
