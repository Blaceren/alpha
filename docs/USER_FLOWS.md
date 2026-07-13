# USER_FLOWS

Ключевые пользовательские флоу Alfa Trade Academy Web V2. Для каждого: entry · steps · decisions · failures · recovery · analytics · UX risks.

Аналитические события даны как provisional имена (snake_case). Финализируются с backend/CRM позже. Login фиксируется для retention, но **не** продлевает серию обучения.

---

## 1. First login (первое знакомство)

- **Entry:** первый вход в ATA после регистрации.
- **Steps:** приветствие Alex Curie → короткое объяснение (путь/один шаг/XP/checkpoints, без гарантий) → приземление на Главную с первым CTA (L1 «Подключение Pocket»).
- **Decisions:** пропустить intro / начать сразу.
- **Failures:** intro не догрузился → показать статичный fallback + CTA.
- **Recovery:** intro доступен позже из Профиля/справки.
- **Analytics:** `onboarding_started`, `onboarding_completed`, `home_first_view`.
- **UX risks:** перегрузить первый экран; нарушить правило одного шага.

## 2. Pocket registration task (L1)

- **Entry:** L1 «Подключение Pocket».
- **Steps:** объяснение зачем связывать аккаунт, отличие ATA/Pocket, сохранение прогресса, почему сначала demo → действие: зарегистрировать и подтвердить аккаунт Pocket → возврат в ATA.
- **Decisions:** новый Pocket-аккаунт vs существующий (см. флоу 3).
- **Failures:** регистрация не завершена/не подтверждена → уровень остаётся in progress.
- **Recovery:** повторить действие; инструкция сохранена.
- **Analytics:** `pocket_task_started`, `pocket_task_completed`.
- **UX risks:** ATA не должна запрашивать пароли/креденшелы Pocket в своём UI; действие выполняется на стороне Pocket.

## 3. Existing Pocket account (instruction state)

- **Entry:** у пользователя уже есть Pocket.
- **Steps:** показать инструкцию по корректной привязке к ATA-прогрессу (без ввода чувствительных данных в ATA) → подтверждение связи.
- **Decisions:** привязать существующий / создать новый.
- **Failures:** связь не подтверждается → instruction state сохраняется.
- **Recovery:** повтор; при затруднении — Support.
- **Analytics:** `pocket_existing_linked`.
- **UX risks:** путаница между «регистрация» и «привязка»; ясные две ветки.

## 4. Lesson (урок)

- **Entry:** активный урок с Главной/Пути/Уроков.
- **Steps:** цель → видео (subtitles, позиция сохраняется) → на 50% открывается тест → (опц.) связанный tool → completion.
- **Decisions:** смотреть/продолжить позже; открыть tool.
- **Failures:** видео не грузится → retry, позиция сохранена.
- **Recovery:** вернуться позже к сохранённой позиции.
- **Analytics:** `lesson_opened`, `video_progress_50`, `lesson_completed`.
- **UX risks:** просмотр 50% не завершает уровень; следующий урок не показывать до completion.

## 5. Lesson → Test

- **Entry:** тест-лаунчер под видео (после 50%).
- **Steps:** по одному вопросу, progress bar, ответ меняется до завершения, no timer → завершить → explanation.
- **Decisions:** изменить ответ; завершить.
- **Failures:** обрыв сессии → прогресс теста восстанавливается/или перезапуск.
- **Recovery:** повтор теста.
- **Analytics:** `test_started`, `test_submitted`, `test_passed`/`test_failed`.
- **UX risks:** не показывать таймер; scenario-вопросы и «отказаться от сделки» как валидный ответ.

## 6. Failed test

- **Entry:** тест не пройден.
- **Steps:** показать правильный ответ + explanation → предложить вернуться к материалу → повтор.
- **Decisions:** повторить сразу / вернуться к видео.
- **Failures:** несколько неудач подряд.
- **Recovery:** после нескольких неудач — предложить обратиться к mentor.
- **Analytics:** `test_failed`, `test_retry`, `mentor_offer_shown`.
- **UX risks:** тон без наказания; не блокировать обучение.

## 7. Report → Mentor

- **Entry:** practical-уровень с report (напр. L3, L14…).
- **Steps:** заполнить структурированную форму (autosave/draft, images/video, rubric, пример) → submit → pending («Обычно проверка занимает до одного дня») → approved/rejected.
- **Decisions:** сохранить draft / отправить.
- **Failures:** rejected.
- **Recovery:** комментарии к секциям → исправить в том же report → resubmit.
- **Analytics:** `report_draft_saved`, `report_submitted`, `report_approved`, `report_rejected`, `report_resubmitted`.
- **UX risks:** без countdown; без mentor avatar; версии сохраняются.

## 8. Rejected report

- **Entry:** статус rejected.
- **Steps:** прочитать комментарии к секциям → доработать → resubmit → pending.
- **Recovery:** version history доступна.
- **Analytics:** `report_rejected_viewed`, `report_resubmitted`.
- **UX risks:** конструктивный тон, без вины.

## 9. Checkpoint (обычный)

- **Entry:** checkpoint-уровень (L4…L100).
- **Steps:** Upcoming (цель + reward) → Current (min real balance, demo не учитывается, CTA «Проверить выполнение») → Checking → Completed (rank-up + unlock, CTA «Продолжить путь»).
- **Decisions:** проверить выполнение.
- **Failures:** условие не выполнено → остаётся Current; Data unavailable.
- **Recovery:** повторная проверка позже (авто/ручная).
- **Analytics:** `checkpoint_viewed`, `checkpoint_check_requested`, `checkpoint_completed`.
- **UX risks:** не показывать баланс юзера/«осталось $X»; CTA не открывает Pocket; без deposit-pressure.

## 10. Delayed checkpoint (data unavailable)

- **Entry:** проверка не может получить данные.
- **Steps:** «Данные обновляются. Подожди немного — проверка продолжится автоматически» → авто-retry.
- **Recovery:** статус обновится автоматически; можно уйти и вернуться.
- **Analytics:** `checkpoint_data_unavailable`, `checkpoint_auto_retry`.
- **UX risks:** без тревоги/ошибки-вины; без countdown.

## 11. Grace

- **Entry:** условие временно не подтверждено после прохождения.
- **Steps:** спокойный статус «…Всё, что ты уже открыл, остаётся доступно. Статус обновится автоматически» — **без countdown**.
- **Recovery:** авто-переоценка.
- **Analytics:** `checkpoint_grace_entered`, `checkpoint_grace_resolved`.
- **UX risks:** не пугать; сохранить доступ к открытому.

## 12. Suspension

- **Entry:** условие не подтверждается дольше grace.
- **Steps:** Suspended: сохраняются завершённые уровни, XP, прошлые уроки, инструменты предыдущего checkpoint, доступные community channels, news, support; закрывается только новый progression после checkpoint.
- **Recovery:** см. флоу 13.
- **Analytics:** `progression_suspended`.
- **UX risks:** без deposit-pressure copy; ясно, что именно сохранено.

## 13. Restoration

- **Entry:** условие снова подтверждено.
- **Steps:** авто-снятие suspension → доступ к новому progression восстановлен → при необходимости checkpoint Completed.
- **Analytics:** `progression_restored`.
- **UX risks:** плавный возврат без повторного «наказания».

## 14. Rank-up

- **Entry:** checkpoint completed.
- **Steps:** сцена 2–4 c (skippable, reduced-motion fallback) → показать practical unlock (tool/community/module) → CTA «Продолжить путь».
- **Analytics:** `rank_up_shown`, `rank_up_skipped`, `unlock_revealed`.
- **UX risks:** без casino/обязательного звука.

## 15. Tool unlock

- **Entry:** checkpoint открыл инструмент.
- **Steps:** milestone-оверлей → инструмент в Tools Hub (available/empty с примером).
- **Recovery:** доступ из Инструменты в любой момент.
- **Analytics:** `tool_unlocked`, `tool_first_open`.
- **UX risks:** объяснить назначение; empty state с примером.

## 16. Community unlock

- **Entry:** уровень открыл канал (L4/20/35/45/85).
- **Steps:** milestone → канал доступен (messages/replies/reactions/images).
- **Analytics:** `channel_unlocked`, `channel_first_open`.
- **UX risks:** до открытия — locked preview; нет leaderboards.

## 17. Return after inactivity

- **Entry:** вход после паузы.
- **Steps:** тёплое сообщение Alex → серия сброшена, лучший результат сохранён, «Продолжим с текущего этапа» → один следующий шаг.
- **Analytics:** `return_after_pause`, `streak_reset`.
- **UX risks:** без укора/красного наказания; login не продлевает серию.

## 18. Support ticket

- **Entry:** Support (Ticket Center).
- **Steps:** create ticket (category, thread, attachments) → waiting support → ответы → resolved; можно reopen.
- **Decisions:** категория, вложения.
- **Failures:** нет ответа вовремя → статус waiting support виден.
- **Recovery:** reopen resolved.
- **Analytics:** `ticket_created`, `ticket_replied`, `ticket_resolved`, `ticket_reopened`.
- **UX risks:** не смешивать с mentor.

## 19. Mentor conversation

- **Entry:** Mentor (образовательные вопросы/reviews).
- **Steps:** отправить вопрос/report/strategy/case → awaiting mentor → feedback → возможен revision.
- **Failures:** revision requested.
- **Recovery:** доработать и отправить снова.
- **Analytics:** `mentor_message_sent`, `mentor_feedback_received`, `mentor_revision_requested`.
- **UX risks:** отдельно от Support; без конкретного avatar.

## 20. Referral

- **Entry:** Реферальная программа.
- **Steps:** поделиться ссылкой → друг регистрируется в ATA → проходит Pocket registration → достигает L4 → оба получают reward.
- **Decisions:** поделиться каналом.
- **Failures:** друг не дошёл до L4 → статус qualifying.
- **Recovery:** статус обновляется по мере прогресса друга.
- **Analytics:** `referral_link_shared`, `referral_registered`, `referral_qualified`, `referral_reward_unlocked`.
- **UX risks:** приглашающий не видит email/Pocket ID/balance/deposit/trading; прозрачные условия.

## 21. Secret reward

- **Entry:** первый qualified referral.
- **Steps:** до открытия — silhouette + прозрачные условия + progress (no countdown, no fake scarcity) → при qualified обоим открывается «Секретный инструмент».
- **Analytics:** `secret_tool_teaser_view`, `secret_tool_unlocked`.
- **UX risks:** не раскрывать содержимое заранее; без искусственного дефицита.

## 22. Level 100 completion

- **Entry:** checkpoint.100 ($10,000) completed.
- **Steps:** значимая сцена (не «конец») → открытие Pro Workspace + preview уровней 101+ → сообщение о переходе к собственной системе, сохранении истории.
- **Analytics:** `level_100_completed`, `pro_workspace_unlocked`, `levels_101_preview_view`.
- **UX risks:** тон «переход, а не финал»; Pro Workspace — не терминал.

---

## Сводка аналитики (provisional, для будущей CRM)

Категории событий: onboarding, learning (lesson/test), reports, checkpoints (+grace/suspend/restore), progression/rank/unlock, tools, community, news, referral, mentor, support, retention (login/return/streak). Login-события фиксируются отдельно и не влияют на серию обучения (DD-033).
