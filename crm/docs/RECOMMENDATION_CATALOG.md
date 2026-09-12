# RECOMMENDATION_CATALOG.md — Alfa Trade Academy CRM (Phase 1B1)

Объяснимый каталог рекомендованных действий. Реализация: `src/domain/recommendations/catalog.ts` + `derive.ts`.

## Безопасность (жёсткое правило)
Каталог **не содержит** финансово-давящих действий. `PROHIBITED_ACTION_CODES` (проверяется тестом): `deposit_now, recover_losses, increase_trade_size, trade_more, restore_balance_by_deposit, urgent_redeposit`. После падения баланса допустимы только образовательные, mentor, support и communication-suppression действия (`review_risk_material`, `open_pause_protocol`, `restore_learning_path` и т.п. — все помечены `humanApprovalRequired` и `prohibitedWhen`, запрещающим предлагать депозит).

## 18 действий
`review_new_registration, help_complete_pocket_registration, remind_email_confirmation, continue_current_lesson, offer_learning_recap, review_failed_test, review_report, request_report_revision, mentor_follow_up, support_follow_up, verify_financial_data, review_checkpoint_grace, restore_learning_path, reduce_communication_frequency, review_risk_material, open_pause_protocol, celebrate_learning_return, no_action_required`.

Каждое содержит: `code, title, reason, sourceSignalCodes, allowedRoles, priority (critical/high/normal/low), suggestedChannel, cooldownHours, prohibitedWhen[], humanApprovalRequired`.

## Деривация (`derive.ts`)
`deriveRecommendations(user, signals)`: для каждого активного сигнала берёт `SIGNAL_TO_ACTIONS[code]`, дедуплицирует, сортирует по приоритету. Правила:
- **Communication-fatigue suppression:** при активном `communication_fatigue` исходящие nudge-каналы (`in_app`, `email`) подавляются — кроме `reduce_communication_frequency`.
- **Fallback:** если сигналов нет → единственная рекомендация `no_action_required`.
- `humanApprovalRequired` выставлен для всех финансово-чувствительных действий (verify_financial_data, review_checkpoint_grace, restore_learning_path, review_risk_material, open_pause_protocol).

## Signal → actions (карта)
Единый источник `SIGNAL_TO_ACTIONS` в каталоге; движок сигналов проставляет `recommendedActionCodes` из неё (не хардкодит в компонентах). Тесты проверяют: отсутствие запрещённых кодов, наличие allowedRoles/reason у каждого действия, покрытие каждого сигнала хотя бы одним действием, суппрессию при fatigue и образовательный ответ после decline.

_Связано: SIGNAL_ENGINE.md, ROLE_PERMISSION_MATRIX.md (allowedRoles)._
