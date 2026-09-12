# LESSON_STATE_MACHINE

Детерминированная модель урока (Phase D2B). **Единственный владелец продуктовых правил** — бизнес-логика
не размазана по React-компонентам: компоненты только рендерят производное состояние и отправляют события.

Raw enum-значения **никогда** не показываются пользователю: для каждого состояния есть label-функция.

Файлы:

| Файл | Роль |
|------|------|
| `src/features/lesson/model/lesson.ts` | типы контента; парсинг `levelCode`; форматирование |
| `src/features/lesson/model/lesson-progress.ts` | media/watch progress (чистые функции) |
| `src/features/lesson/model/assessment.ts` | вопросы, ответы, retry, completion (чистые функции) |
| `src/features/lesson/model/lesson-state-machine.ts` | композиция → `LessonExperience` |
| `src/features/lesson/model/lesson-scenarios.ts` | dev-scenario adapter (только seed) |
| `src/features/lesson/model/lesson-session-progress.ts` | схема и правила session progress (D2B.1) |
| `src/features/lesson/model/lesson-progress-store.ts` | единственный порт к Web Storage (D2B.1) |
| `src/features/lesson/model/lesson-availability.ts` | route availability resolver (D2B.1) |
| `src/features/lesson/hooks/use-lesson-experience.ts` | reducer: события → модель |
| `src/features/lesson/hooks/use-lesson-media.ts` | единственный таймер (fixed delta) |

Всё в `model/` — чистое, без React, без `Date.now()`, без `Math.random()`, без мутаций.

---

## 1. Состояния

### LessonAvailability
`locked` · `available` · `completed`

Выводится из **общего** sequential marker (`path-state.ts` — того же, что у Главной и Пути),
уточняется completion в текущей сессии.

> `available` на Пути означает «следующий по очереди» — это **не** открытый урок. Для урока такой
> уровень = `locked` (DD-062).

### MediaPlaybackState
`idle` · `playing` · `paused` · `ended`

### MediaProgressState
`not_started` · `watching` · `threshold_reached` · `watched_beyond_threshold`

Выводится из **verified** percent относительно порога, не из playhead.

### AssessmentState
`locked` · `ready` · `answering` · `feedback_correct` · `feedback_incorrect` · `completed`

### LessonExperienceState
`locked` · `available` · `watching` · `test_unlocked` · `testing` · `completed`

```
locked ── (уровень достигнут) ──► available
available ── (verified > 0) ──► watching
watching ── (verified >= 50%) ──► test_unlocked
test_unlocked ── (начать проверку) ──► testing
testing ── (все обязательные вопросы верны) ──► completed
```

## 2. Переходы media

| Событие | Эффект |
|---------|--------|
| `play` | `playing`; из `ended` — playhead в 0, граница не трогается |
| `pause` | `paused` (иначе no-op) |
| `seek(p)` | двигает **только** playhead, clamp 0..duration; граница не меняется |
| `tick(Δ)` | только в `playing`; двигает playhead; границу двигает **только** если участок непрерывен с ней |
| `toggleMuted` / `toggleCaptions` | не влияют на прогресс |

**Contiguity.** Пролёт засчитывается, если позиция *до* тика была в пределах `CONTIGUITY_TOLERANCE_SECONDS`
(1 c) от границы. Иначе пользователь смотрит участок за пропуском — граница не растёт.

Следствия (все покрыты тестами):

- перемотка назад прогресс **не снижает**;
- scrub в конец **не** открывает тест;
- воспроизведение после прыжка вперёд **не** засчитывается;
- воспроизведение, продолжающееся от границы, **засчитывается**;
- повторный просмотр уже пройденного участка не двигает границу;
- 49.99% → закрыто, **50% → открыто** (включительно);
- 100% просмотра **не** требуется и сам по себе урок **не** завершает.

## 3. Переходы assessment

| Событие | Правило |
|---------|---------|
| `start` | отклоняется, пока тест закрыт |
| `select` | игнорируется после submit (ответ зафиксирован до retry) |
| `submit` | отклоняется, пока закрыт / не начат / уже отправлен. **Без выбора не проваливается молча** — фиксирует попытку, чтобы UI объяснил, чего не хватает |
| `retry` | только после incorrect; чистит выбор; **ничего не отнимает** |
| `next` | **только** после correct и не дальше последнего вопроса |

- Порядок вопросов — порядок fixture, shuffle запрещён (DD-248).
- Правильный вариант не раскрывается ни до submit, ни при incorrect (DD-247).
- Correct засчитывается один раз; повторная отправка не дублирует запись.

## 4. Completion rule (provisional)

```
lessonComplete = verifiedWatchPercent >= 50  &&  каждый required-вопрос отвечен верно хотя бы раз
```

**Это frontend development rule, а не backend-контракт** (DD-245). Проходной процент не вводится:
все вопросы обязательны. Полный просмотр не требуется.

Ответы без просмотра 50% урок **не** завершают: тест в этом состоянии вообще закрыт.

## 5. Next-lesson gate

`nextLessonUnlocked = lessonComplete && nextLevelNumber !== null`

До completion ссылки на следующий уровень **нет вообще** — только предложение, объясняющее условие
(disabled-кнопку без объяснения не используем). На уровне 100 следующего нет.

## 6. XP

State machine **не** трогает XP. Единственный источник инструментария — общий marker; завершение урока
его не меняет (2 480 XP). Канонического правила награды за урок нет — придумывать его нельзя (DD-250).

## 7. Persistence и ownership состояния (уточнено в D2B.1)

Backend'а нет: ни базы, ни `localStorage`, ни claim «сохранено на сервере».

Роли строго разделены — session store **не дублирует** state machine:

- **lesson state machine** решает, завершён ли **текущий** урок (просмотр 50% + все вопросы);
- **session progress adapter** хранит результат completion между navigation/reload
  (`sessionStorage`, ключ `ata.lesson-progress.v1`, схема `{version, completed[], unlocked[]}`);
- **route availability resolver** объединяет три источника: curriculum sequence → dev scenario override
  (только dev/tests) → session completion.

Сессия может только **открыть** недостигнутый уровень; закрыть уже открытое или дать перепрыгнуть — нет.
Любой сбой (битый JSON, чужая версия, подделка, недоступное хранилище) деградирует в **locked**.

Внутрисессионное состояние урока (media/assessment) по-прежнему живёт только в runtime страницы.

Adapter сценариев только **seed'ит** стартовую сессию и в production-модель не вмешивается; неизвестный
сценарий → `initial`, без исключений. **Пользовательские ссылки `scenario` не содержат** (DD-255).

Детали — `D2B_1_ACCEPTANCE_FIX.md`.

## 8. Тесты

`lesson-progress.test.ts` (20) · `assessment.test.ts` (23) · `lesson-state-machine.test.ts` (26) ·
`lesson-fixtures.test.ts` (28) · `lesson-workspace.test.tsx` (30) · `lesson-gates.test.tsx` (9) ·
`lesson-session-progress.test.ts` (31, D2B.1) · `lesson-session-progression.test.tsx` (18, D2B.1).
E2E: `e2e/lesson-smoke.spec.ts` (27) + `e2e/lesson-session-smoke.spec.ts` (4, D2B.1) +
`e2e/lesson-screenshots.spec.ts` (3) + `e2e/d2b-1-screenshots.spec.ts` (1).
