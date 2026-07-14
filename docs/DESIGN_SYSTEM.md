# DESIGN_SYSTEM

Provisional design system для Alfa Trade Academy Web V2. Dark-only. Все visual-значения — **provisional** и будут заменены токенами прелендинга. Именование семантическое: код ссылается на роль токена, не на конкретный HEX.

> **D1A статус (реализовано).** Токены живут в `src/styles/tokens.css` (`:root`, dark-only), маппятся в Tailwind (`tailwind.config.ts`) на `var(--token)` и типизированы в `src/design-system/tokens/tokens.ts`. Реализованы все 25 семантических токенов из брифа D1A (background-base/deep, surface-primary/secondary/elevated/interactive, border-subtle/default, text-primary/secondary/muted, accent-primary/secondary, success, warning, danger, info, locked, completed, active, suspended, focus-ring, overlay, path-line, path-glow). Provisional HEX-значения ниже соответствуют реализованным. Замена палитры прелендинга = правка только `tokens.css`.

> ⚠️ Не хардкодить HEX в компонентах. Использовать только semantic tokens. Provisional-значения ниже — placeholder до получения палитры прелендинга.

---

## 1. Принципы

- Dark-only, глубокие тёмные поверхности, холодные акценты, controlled glow, premium lighting.
- Два режима: **Emotional/premium** (глубина, свечение, движение) и **Functional** (спокойствие, читаемость, скорость).
- Токены → примитивы → компоненты. Никаких «магических» значений в UI.
- Готовность к длинным польским строкам: компоненты не ломаются от +30–40% длины текста.

---

## 2. Токены цвета (semantic, provisional)

Слои даны как роли. HEX — provisional placeholder.

### Поверхности (dark)
| Token | Роль | Provisional |
|-------|------|-------------|
| `--surface-base` | самый глубокий фон приложения | `#0A0C10` |
| `--surface-raised` | карточки, панели | `#12151C` |
| `--surface-overlay` | sheets, dialogs, popovers | `#171B24` |
| `--surface-inset` | поля ввода, вложенные блоки | `#0E1116` |
| `--surface-emotional` | фон premium-сцен (Главная/Путь/milestone) | градиент на базе `--surface-base` + glow |

### Границы и разделители
| Token | Роль | Provisional |
|-------|------|-------------|
| `--border-subtle` | тихие разделители | `rgba(255,255,255,0.06)` |
| `--border-default` | границы карточек/полей | `rgba(255,255,255,0.10)` |
| `--border-strong` | фокус контейнеров, active | `rgba(255,255,255,0.18)` |

### Текст
| Token | Роль | Provisional |
|-------|------|-------------|
| `--text-primary` | основной текст | `#EDF1F7` |
| `--text-secondary` | вторичный | `#A6AEBF` |
| `--text-muted` | подписи, hint | `#6B7385` |
| `--text-on-accent` | текст на акценте | `#0A0C10` |
| `--text-inverse` | на светлых пятнах | `#0A0C10` |

> Запрет ultra-light текста: минимальный вес body — regular; `--text-muted` не используется для важной информации.

### Акценты (холодные, provisional)
| Token | Роль | Provisional |
|-------|------|-------------|
| `--accent-primary` | основной интерактив/CTA | `#4C8DFF` |
| `--accent-primary-hover` | hover | `#3F7CEC` |
| `--accent-cool` | холодное свечение/данные | `#2FD6C6` |
| `--accent-glow` | controlled glow в emotional-режиме | `rgba(76,141,255,0.35)` |

### Статусы (семантика без color-only)
| Token | Роль | Provisional | Всегда с иконкой/текстом |
|-------|------|-------------|:-----------------------:|
| `--status-success` | approved, completed | `#3FBF87` | ✔ |
| `--status-warning` | grace, attention | `#E0A54B` | ✔ |
| `--status-danger` | rejected, error | `#E5635F` | ✔ |
| `--status-info` | pending, informational | `#4C8DFF` | ✔ |
| `--status-neutral` | locked, hidden, muted | `#6B7385` | ✔ |

> Цвет никогда не единственный носитель смысла (DD-162). Каждый статус сопровождается иконкой и/или текстом.

### Rank families (акцент по семье, provisional)
| Family | Token | Provisional |
|--------|-------|-------------|
| Наблюдатель | `--rank-observer` | `#7F9BB8` |
| Аналитик | `--rank-analyst` | `#4C8DFF` |
| Тактик | `--rank-tactician` | `#2FD6C6` |
| Стратег | `--rank-strategist` | `#9B7DF0` |
| Архитектор рынка | `--rank-architect` | `#E0A54B` |

---

## 3. Типографика (provisional)

Семейства:
- `--font-display` = Manrope Variable — крупные заголовки, ranks, milestones.
- `--font-ui` = Inter Variable — основной UI и тексты.
- `--font-mono` = JetBrains Mono Variable — формулы, интервалы, технические значения.

Требования: open-source, Cyrillic+Latin, PL-ready, body ≥ 16px на mobile, без ultra-light, usable при zoom 200%.

Шкала (provisional, rem при 16px base):
| Token | Size / line-height | Использование |
|-------|--------------------|---------------|
| `--text-display-xl` | 44 / 48 | rank-up, level 100, hero milestone |
| `--text-display-l` | 34 / 40 | заголовки premium-сцен |
| `--text-h1` | 28 / 34 | заголовок страницы |
| `--text-h2` | 22 / 28 | секции |
| `--text-h3` | 18 / 24 | подсекции, карточки |
| `--text-body-l` | 17 / 26 | ведущий текст |
| `--text-body` | 16 / 24 | базовый body (mobile min) |
| `--text-caption` | 14 / 20 | подписи |
| `--text-mono` | 15 / 22 | значения, формулы |

Веса: regular 400, medium 500, semibold 600, bold 700. Минимум для body — 400.

---

## 4. Spacing, radius, elevation

Spacing scale (4px base): `--space-1`=4, `-2`=8, `-3`=12, `-4`=16, `-5`=24, `-6`=32, `-7`=48, `-8`=64.

Radius: `--radius-sm`=8, `--radius-md`=12, `--radius-lg`=16, `--radius-xl`=24, `--radius-pill`=999.

Elevation (dark — тень + тонкая светящаяся кромка, не тяжёлые тени):
| Token | Использование |
|-------|---------------|
| `--elev-0` | плоские поверхности |
| `--elev-1` | карточки |
| `--elev-2` | popovers, dropdowns |
| `--elev-3` | dialogs, sheets |
| `--glow-emotional` | controlled glow только в emotional-сценах |

Touch target ≥ 44px. Safe-area padding учитывается на mobile.

---

## 5. Motion токены

| Token | Значение | Использование |
|-------|----------|---------------|
| `--motion-fast` | 140 ms | hover, tabs, мелкие переходы |
| `--motion-base` | 200 ms | navigation, dialog, sheet |
| `--motion-slow` | 240 ms | path node transitions |
| `--motion-milestone` | 2000–4000 ms | rank-up, checkpoint, unlock (skippable) |
| `--ease-standard` | cubic-bezier(0.2, 0, 0, 1) | стандарт |
| `--ease-emphasized` | cubic-bezier(0.2, 0, 0, 1.1) | milestone |

Правила — `MOTION_AND_PERFORMANCE.md`. Reduced-motion: milestone заменяется мгновенным состоянием, ambient выключается.

---

## 6. Breakpoints и режимы

| Breakpoint | Диапазон | Навигация |
|------------|----------|-----------|
| mobile | ≤ 599 | bottom nav (5: Главная/Путь/Уроки/Инструменты/Ещё) + профиль через avatar в top bar |
| tablet-portrait | 600–899 | icon rail / compact sidebar |
| tablet-landscape | 900–1199 | compact sidebar, two-pane tools |
| desktop | ≥ 1200 | сворачиваемый sidebar + top bar |

Reference viewports для QA: 1440×900, 1024×768, 390×844 (+ tablet portrait).

---

## 7. Компонентные примитивы (обзор)

Полный список — `COMPONENT_INVENTORY.md`. Базовые: Button (primary/secondary/ghost/danger), Input/Textarea/Select, Checkbox/Radio/Switch, Card, Badge/Tag, RankBadge, Dialog, Sheet, Tabs, ProgressBar, Toast, Tooltip, EmptyState, Skeleton, PathNode, CheckpointCard, LessonPlayer, TestQuestion, ReportForm, NotificationItem, CommunityMessage, ArticleCard, ToolShell.

---

## 8. Provisional-статус и замена токенов

- Все HEX выше — placeholder. При получении палитры прелендинга обновляется только слой значений токенов; имена и компоненты не меняются.
- Финальные visual tokens остаются provisional до assets (DD-004, DD-005).
- Missing assets: см. `IMPLEMENTATION_PLAN.md` → раздел Missing assets.

---

## 9. D1B — применённые токены (Route Field Home)

Первое реальное применение провизорных семантических токенов: deep-navy поверхности
(`--background-base/-field`, `--surface-context`), холодный синий + green/cyan сигнал
(`--route-*`, `--signal-*`, `--gate-boundary`), controlled glow (`--glow-current`), дивайдеры.
Шрифты через `@fontsource-variable` (Manrope/Inter/JetBrains Mono). Все значения остаются
provisional до assets прелендинга (DD-004/005) — заменяется только слой значений. Детали —
`D1B_REACT_HOME_IMPLEMENTATION.md`.
