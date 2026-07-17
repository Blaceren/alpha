# STATE_MATRIX

Матрица состояний ключевых объектов ATA: level, checkpoint, test, report, tool, community channel, mentor, support ticket, referral, notification. Каждое состояние = визуальный + поведенческий контракт.

---

## 1. Level (узел пути) — 10 состояний

| State | Значение | Визуал | Действие |
|-------|----------|--------|----------|
| hidden | далеко впереди, ещё не раскрыт | скрыт/затемнён на дальнем участке | — |
| locked | закрыт, порядок не достигнут | приглушённый node, замок | клик → explainer (что/почему/что нужно/что откроется), без перепрыгивания |
| XP eligible | достаточно XP/условий для старта | node готов к активации | «Начать» |
| active | текущий шаг | центрирован, акцент, glow (emotional) | primary CTA |
| in progress | начат, не завершён | индикатор частичного прогресса | «Продолжить» |
| pending review | ждёт mentor | статус-бейдж «На проверке» | открыть report/ждать |
| completed | завершён | галочка, награда важнее номера | можно переоткрыть материал |
| checkpoint | финансовая контрольная точка | особый node, целевая сумма | см. checkpoint-состояния ниже |
| grace | условие временно не подтверждено | спокойный warning, без countdown | доступ сохранён, статус обновится авто |
| temporarily suspended | новый progression закрыт после checkpoint | приглушение будущего пути | всё открытое остаётся доступно |

Правила: линия пути может напоминать движение рынка, но не буквальный ценовой график; тип активности — иконкой; после ручной прокрутки — кнопка «К текущему уровню».

---

## 2. Checkpoint — 7 состояний

| State | Копирайт-суть | CTA | Заметки |
|-------|---------------|-----|---------|
| Upcoming | ближайшая цель + reward | нет dominant CTA до момента checkpoint | показать reward превью |
| Current | min required balance, объяснение real balance, demo не учитывается | «Проверить выполнение» | CTA не открывает Pocket |
| Checking | «Проверяем выполнение условия. Обычно это занимает немного времени» | disabled/loading | — |
| Completed | rank-up + module/tool/community unlock | «Продолжить путь» | запускает emotional-сцену (skippable) |
| Data unavailable | «Данные обновляются. Подожди немного — проверка продолжится автоматически» | нет | авто-retry |
| Grace | «Условие контрольной точки временно не подтверждено. Всё, что ты уже открыл, остаётся доступно. Статус обновится автоматически» | нет | **без countdown** |
| Suspended | новый progression закрыт; всё открытое сохранено | нет deposit-pressure | сохраняются: завершённые уровни, XP, прошлые уроки, инструменты предыдущего checkpoint, доступные community channels, news, support |

Запрещено: собственный balance рядом с целью, «осталось $X», deposit pressure copy, countdown в grace/checking.

---

## 3. Test — состояния

> **D2B привёл этот раздел к реализации.** Фактические состояния проверки:
> `locked` → `ready` → `answering` → `feedback_correct` / `feedback_incorrect` → `completed`
> (`LESSON_STATE_MACHINE.md`). Отличия от таблицы ниже: правильный ответ при ошибке **не** показывается
> (DD-247); `passed`/`failed` не вводятся — обязательны все вопросы, проходного процента нет (DD-245);
> ответ фиксируется по submit и меняется через повтор.

| State | Визуал | Поведение |
|-------|--------|-----------|
| locked (video <50%) | launcher недоступен | подсказка «после 50% видео» |
| available | кнопка старта под видео | старт |
| in progress | по одному вопросу, progress bar | ответ меняется до завершения, no timer |
| answered/review | все вопросы отвечены | завершить |
| passed | success | explanation, переход к completion |
| failed | показывает правильный ответ + explanation | повтор, возврат к материалу; после нескольких неудач — mentor |

History attempts / best score пользователю не обязательны.

---

## 4. Report — статусы

> **D3-A уточнил этот раздел.** Отчёт — это **сам curriculum-level** (`kind: "report"`), а не
> приложение к нему; канонический адрес — `/lessons/level.003`, маршрут `/reports/[reportCode]` не
> используется (DD-264). Реализация разбита: **D3-B** строит только `draft → pending`; остальные
> статусы — отдельные будущие этапы, потому что все они производны от **вердикта наставника**,
> которого без backend не существует и который **не имитируется** (DD-265, `D3_REPORT_SCOPE.md`).

| State | Значение | Действие | Этап |
|-------|----------|----------|------|
| draft | browser-local autosave, не отправлен | продолжить заполнение | **D3-B ✅** |
| ready | правило готовности выполнено; **вычисляется, не хранится** | submit доступен | **D3-B ✅** |
| pending | отмечен отправленным **в этом браузере**; ждёт проверки, которой в прототипе нет | «Обычно проверка занимает до одного дня»; без countdown; без mentor avatar; read-only; **progression остановлен** | **D3-B ✅** |
| approved | принят | продолжить путь | D3-D |
| rejected | нужна доработка | комментарии к секциям, исправить в том же report | D3-C |
| resubmitted | повторно отправлен | pending снова | D3-C |

Возможности: images, video attachments, rubric, пример хорошего ответа, version history, комментарии к
конкретным секциям. **В D3-B ни одна из них не реализуется:** вложения и версии требуют хранилища,
секционные комментарии — вердикта; rubric остаётся структурной и **prototype-only** (completeness ·
evidence attached · reflection present), торговая методология не выдумывается (DD-268).

**Хранилище (D3-B, реализовано):** versioned **localStorage**, ключ `ata.report-workspace.v1` —
сознательное расхождение с `sessionStorage` урока (DD-255): потеря отметки просмотра — неудобство,
потеря черновика отчёта — потеря работы пользователя (DD-266). Схема, нормализация и fail-closed
правила — `REPORT_STORAGE.md`; lifecycle — `REPORT_STATE_MACHINE.md`.

Канонический копирайт: «Черновик сохранён в этом браузере. Синхронизация с сервером пока не
подключена.» После отправки: «Отчёт отмечен как отправленный только в этом браузере. Серверная
проверка пока не подключена.» Формулировки «Сохранено на сервере», «Синхронизировано», «Отправлено
наставнику», «Наставник уже получил отчёт» — **запрещены** (закреплено тестами).

**Правило готовности (D3-B, prototype-only, DD-274):** все пять записей имеют непустое «Что заметил
после сделки» **и** заполнено «Итоговое наблюдение». Показывается словами, без процентов и score.

---

## 5. Tool — состояния доступа/данных

| State | Значение |
|-------|----------|
| locked | уровень unlock не достигнут → locked preview (что даёт, когда откроется) |
| available (empty) | открыт, нет записей → EmptyState с примером |
| in use (draft) | есть незавершённая запись/draft |
| saved | сохранённая запись/план/версия |
| pending mentor review | инструменты с mentor (Strategy Builder, Personal Playbook, Mentor Case Room и practical с mentor) |
| versioned | есть история версий |

Инварианты: только manual data; никакой автоподгрузки Pocket balance/broker wallet; Risk Calculator — «сумма для расчёта», не «баланс»; Chart Markup — uploaded screenshot; Performance Dashboard — journal data; Psychology Check-in — private by default.

---

## 6. Community channel

| State | Значение |
|-------|----------|
| locked preview | уровень не достигнут → превью канала + условие открытия |
| unlocked | доступ к messages/replies/reactions/images |
| moderation flagged | сообщение отправлено на report |

Нет financial/profit/volume leaderboards.

---

## 7. Mentor

| State | Значение |
|-------|----------|
| no active thread | пусто/история |
| awaiting mentor | вопрос/review отправлен |
| feedback received | есть ответ/ревью |
| revision requested | нужна доработка (report/strategy/case) |
| resolved | закрыт |

Mentor не показывает конкретный avatar; отдельная система от Support.

---

## 8. Support ticket

| State | Значение |
|-------|----------|
| open | создан |
| waiting support | ждёт ответа поддержки |
| waiting user | ждёт ответа пользователя |
| resolved | решён |
| reopened | переоткрыт |

---

## 9. Referral

| State | Значение |
|-------|----------|
| not shared | ссылка не использована |
| invited (registered) | друг зарегистрировался в ATA |
| pocket in progress | проходит Pocket registration |
| qualifying (→L4) | движется к level 4 |
| qualified | достиг L4 → reward обоим |
| reward unlocked | секретный инструмент открыт (первый qualified) |

Secret tool до открытия: silhouette, прозрачные условия, progress, no countdown, no fake scarcity. Пригласивший видит: сокращённое имя, avatar, progress state, reward state. Не видит: email, Pocket ID, balance, deposit, trading info.

---

## 10. Notification

| Категория | Отключаема? |
|-----------|:-----------:|
| Обучение | частично |
| Mentor | частично |
| Community | частично (можно часть) |
| Система | нет (critical/security) |
| Новости | да |
| Награды | да |

Нельзя отключать: security, critical system, статус обязательного задания. Каналы: in-app, email, push.

---

## 11. Streak (Серия обучения)

| State | Значение |
|-------|----------|
| active | продлена meaningful action сегодня/в срок |
| at risk | приближается окончание окна |
| reset | пропуск → начинается заново, лучший результат сохранён, без красного наказания, «Продолжим с текущего этапа» |

Продлевают: lesson, test, report, journal, weekly review, practical task. Не продлевают: login, открытие страницы, trading, deposit.
