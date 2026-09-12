# D3-C-B — Report Revision Pass (реализация)

Production-реализация цикла доработки отчёта по выбранному направлению **B «Revision Pass»**
(`D3_REVISION_ART_DIRECTION.md`, DD-289). Baseline:
`b9caa8ac2d68ee09c7b03d3f34101c3d8952126f` (`design: define ATA report revision direction`).

**Статус: D3-C-B ✅.** D3-D (approved), D3-E (mentor feedback) и D3-F (practical) не начаты.

---

## 1. Композиция

Feedback — **порядок работы**, не dashboard:

- статус-чип **«Нужна доработка»** (полая точка — ход снова у пользователя) + строка
  «Все записи и итоговое наблюдение сохранены — доработка правит ту же работу» + browser-local
  правда о вердикте;
- над ледгером — **полоса «Комментарий проверки»** (взято из направления A) с пометкой
  `dev/test · provisional`, полным текстом комментария и **человекочитаемыми ссылками-переходами**
  (второй элемент из A): «Запись 03 · Что заметил после сделки», «Итоговое наблюдение» — фокус
  переводится в нужное поле, поле прокручивается в видимую область;
- **pass-строка словами**: «Доработка 1 из 2 · дальше — Итоговое наблюдение» → «Доработка 2 из 2 ·
  просмотрены — работа снова целиком ваша». Без процентов, колец, wizard-степперов (DD-274);
- первая отмеченная секция **открыта сразу**; отмеченные места несут словесное состояние
  «требует внимания · доработка N из 2» и холодную review-кромку `--gate-boundary`;
- обычные записи **спокойны и доступны**: обычное «заполнена», клик открывает, ничего не
  disabled, подписи «без пометок» нет (коррекция прототипа B);
- **цветовая дисциплина (DD-284):** blue — review/revision; green/cyan — только сохранение,
  готовность и успешное действие; красного нет.

**Не взято:** margin rail направления A (постоянная вертикаль с узлами); Review Contract
направления C (второй доминирующий объект, правая плита, дублированная closing zone).

Mobile сохраняет композицию D3-B: одна запись за раз, прежний prev/next для обычных записей,
pass-движение — ссылки полосы комментария и «дальше — …»; отмеченная запись подписана словами,
strip из пяти точек остаётся индикатором записей (кольцо внимания — вторичный признак); submit
inline, без sticky и без sheet; компенсация bottom navigation — канонический токен (DD-278).

## 2. Lifecycle

```
   pending-review ──(dev/test verdict adapter)──▶ revision-requested
        ▲                                          │ поля снова редактируемы
        │            подтверждённый resubmit       ▼
   ready-to-resubmit ◀──(readiness ∧ change)── editing-revision
```

| Состояние | Природа |
|---|---|
| `draft` / `pending-review` / `revision-requested` | **хранятся** (`ata.report-workspace.v2`) |
| `ready` / `editing-revision` / `ready-to-resubmit` | **вычисляются** (`report-experience.ts`) |

`approved` / `rejected` не существуют (DD-287): у статуса нет таких членов союза, у адаптера — таких
значений, у модели — таких переходов.

**Правило resubmit (DD-292):** обычное правило готовности (DD-274) ∧
`meaningfulRevision > review.atRevision`. Отмеченные секции — направление внимания, **не валидатор**:
содержательное изменение любого поля разблокирует повторную отправку. Whitespace-правка
(нормализация trim + схлопывание пробелов не меняет значение) автосохраняется (`revision` растёт),
но изменением **не считается** (`meaningfulRevision` не растёт).

До изменения: «Внесите изменения после комментария проверки.» После (при готовности): «Есть
изменения после вердикта — можно отправить на проверку повторно.» CTA — «Отправить на проверку
повторно» → диалог «Отправить отчёт на проверку повторно?» (focus trap, Escape, возврат фокуса;
действия «Продолжить доработку» / «Отправить повторно»; называет: блокировку редактирования,
browser-local отметку, закрытый уровень 4 до результата проверки — фраза выведена из резолвера, —
отсутствие автоодобрения и сервера). «Отправить наставнику» по-прежнему запрещено (DD-266).

**После resubmit:** `status = pending-review`, `submittedAt` обновлён, поля read-only по
конструкции, `review` сохранён как исторический контекст — блок «Комментарий последней проверки»
без ссылок и кромок; строка «Исправления отмечены как отправленные только в этом браузере.»;
`ata.lesson-progress.v1` не тронут; уровень 4 остаётся закрыт настоящим резолвером.

## 3. Storage v2 и миграция (DD-290)

Ключ **`ata.report-workspace.v2`**, версия 2 — схема изменилась, ключ новый (`REPORT_STORAGE.md`).
Запись: `levelCode · entries · summary · status · submittedAt · revision · meaningfulRevision ·
review {comment, sections, receivedAt, atRevision}`. Section ID — закрытое множество, выводимое из
definition (`report.003.entry.{1..5}.{when|decided|noticed}`, `report.003.summary`); raw ID никогда
не рендерятся — пользователь видит только человекочитаемые подписи.

Миграция v1→v2 — при чтении, односторонняя, идемпотентная (`readReportWorkspaceV2`):
валидный v2 **авторитетен** (битый v2 fail closed и **не** откатывается к v1); v2 отсутствует →
v1 читается нетронутым v1-парсером и поднимается (draft→draft, pending→pending, содержимое
дословно, `review: null`); битый v1 не создаёт v2; **v1-ключ никогда не удаляется и не
перезаписывается** (даже `clear()` стирает только v2). Инвариант v1 сохранён: подделка стоит
максимум черновика — никогда не откроет уровень и не сфабрикует вердикт (forged
`approved`/`rejected` → запись отброшена; битый review → вердикт отброшен, работа
сохранена как pending; неизвестный section ID → отброшен только ID).

## 4. Dev/test verdict adapter (DD-291)

`?verdict=revision-requested` — типизированный development/test адаптер по прецеденту `?scenario`
(DD-234/DD-272): резолвер fail closed (всё, кроме точного значения — включая `approved` — → null);
применяется **только** под явным `?scenario=report`, только к `pending-review` без вердикта (один
вердикт на итерацию); пишет только report-workspace; подставляет фиксированный provisional
feedback (`report-review-fixtures.ts`), помеченный в UI `dev/test · provisional`. Ни один
пользовательский href не содержит ни `scenario`, ни `verdict` (закреплено unit + E2E). Кнопки
«Запросить доработку» и интерфейса наставника не существует.

## 5. Library и Path

Без дублирования логики — оба читают `deriveReportLifecycle` через `useReportWorkspace` (v2):

- Library (непройденный L3): «Черновик» · «Готов к отправке» · «На проверке» · **«Нужна
  доработка»** · **«Готов к повторной отправке»**; CTA всегда `/lessons/level.003`
  («Перейти к отчёту» / «Открыть отчёт»);
- Path detail: «Отчёт: Нужна доработка» / «Отчёт: Готов к повторной отправке» / «Отчёт: На
  проверке»;
- канонический Артём (L18) не понижается: `availability === "completed"` побеждает локальную
  запись (DD-271) — на канон-профиле ни статуса, ни resubmit, уровни 4–18 не закрываются.

## 6. Границы

Не реализованы: `approved`, автоодобрение, mentor thread/identity/avatar/queue, countdown,
attachments, upload, version-history UI, секционные треды, rubric, score, торговая оценка,
practical, уровни 14/19, tools, backend/API/database/Pocket, XP. Curriculum fixture, thresholds,
session progression schema не изменялись. Home и D2B-урок не менялись; Path/Library изменены только
в объёме lifecycle-интеграции. Зависимости не менялись.

## 7. Проверки

| Проверка | Результат |
|---|---|
| `npm run lint` | ✅ чисто |
| `npm run typecheck` | ✅ чисто |
| `npm run test:run` | ✅ **518** (441 прежних сохранены + 77) |
| `npm run build` | ✅ |
| `npm run test:e2e` (gate) | ✅ **146** в 8 файлах (120 прежних сохранены + 26) |
| `npx playwright test --list` (discovery) | **224** в 18 файлах |
| `npm audit` | ⚠️ 2 moderate, pre-existing (`next → postcss`), fix не запускался |
| Horizontal overflow (1440/390/320/720×450/1440×650) | ✅ 0px |
| CTA/поля ↔ bottom nav (bounding boxes, DD-281) | ✅ ≥12px во всех revision-состояниях |
| Console errors / hydration warnings | ✅ 0 |

Visual QA: first-pass 14 кадров → ревью глазами (0 critical, 0 major, 5 minor) → final 14 кадров —
`docs/visual-reviews/D3_C_REVISION_IMPLEMENTATION.md`,
`design-memory/screenshots/d3-revision/{first-pass,final}/`.

---

## D3-D — от resubmit к approved

После resubmit (`pending-review`, `review` как история) следующий вердикт может быть `approved` —
терминальный, сохраняющий последний `review` как тихий «Комментарий последней проверки». Полностью
см. [D3_APPROVED_EXPERIENCE.md](D3_APPROVED_EXPERIENCE.md) (DD-297, DD-298). Adapter `?verdict=approved`
допускает approved на resubmitted pending-review с сохранённым review.
