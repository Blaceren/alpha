# SCREENSHOT_QA_PROTOCOL

Обязательный протокол визуального QA для всех будущих UI-фаз (D2+). В D0 приложения нет — протокол вступает в силу с первой UI-фазы.

---

## 1. Базовое правило

Claude (и любой агент) **не имеет права** считать UI готовым без реальных browser screenshots работающего приложения.

**Не считаются** доказательством готовности:
- synthetic reconstruction;
- HTML inspection / чтение разметки;
- нарисованная вручную картинка / мокап;
- описание «как должно выглядеть».

Требуются **настоящие** скриншоты запущенного приложения в браузере.

---

## 2. Порядок для каждой UI-фазы

1. Запустить приложение (dev server).
2. Сделать настоящие browser screenshots.
3. Визуально проверить их.
4. Создать review markdown.
5. Исправить найденные проблемы.
6. Сделать финальные screenshots.
7. Только после этого завершить этап.

Этап без пройденного цикла 1–7 считается незавершённым.

---

## 3. Обязательные размеры

Каждый экран фазы снимается минимум в трёх размерах:
- **1440×900** (desktop)
- **1024×768** (tablet)
- **390×844** (mobile)

Дополнительно, где релевантно: tablet portrait, landscape (video, chart markup).

---

## 4. Хранение

```
design-memory/screenshots/<phase>/     # реальные screenshots
design-memory/reviews/<phase>-review.md # review markdown фазы
```

Именование файлов (рекомендация): `<phase>__<page>__<viewport>[__<state>].png`
Пример: `D2__home__1440x900.png`, `D2__path__390x844__locked-level.png`.

---

## 5. Что проверять в review

**Layout / responsive:**
- нет горизонтального overflow страницы;
- контент не обрезан, safe-area учтена;
- touch targets ≈ 44px;
- клавиатура не перекрывает форму (mobile);
- длинные польские строки не ломают верстку.

**Иерархия / UX:**
- виден один очевидный следующий шаг;
- primary CTA заметен и единственный;
- состояние (уровень/rank/прогресс) читается за секунды.

**Состояния:**
- сняты ключевые состояния из `STATE_MATRIX.md` (locked, active, pending, completed, checkpoint variants, empty, error).

**Визуал:**
- dark contrast достаточен;
- нет color-only смысла (есть иконка/текст);
- glow/motion соответствуют режиму (emotional vs functional);
- нет ultra-light текста.

**A11y (baseline):**
- visible focus;
- заголовки семантичны;
- captions для видео;
- 200% zoom не ломает.

**Финансовая приватность:**
- нет собственного баланса пользователя;
- нет «осталось $X»;
- checkpoint показывает только целевую сумму.

---

## 6. Формат review markdown

Рекомендуемая структура `design-memory/reviews/<phase>-review.md`:

```
# <phase> Visual Review

## Scope
Какие страницы/состояния сняты.

## Screenshots
Ссылки на файлы по viewport.

## Findings
| # | Страница | Viewport | Проблема | Severity | Статус |
|---|----------|----------|----------|----------|--------|

## Fixes applied
Что исправлено, ссылки на финальные screenshots.

## Sign-off
Все обязательные размеры сняты, критические findings закрыты.
```

Severity: blocker / major / minor.

---

## 7. Связь с фазами

Каждая фаза D2–D9 в `IMPLEMENTATION_PLAN.md` содержит пункт «screenshots» в acceptance. Stop condition фазы включает пройденный screenshot-QA цикл и закрытые blocker/major findings.
