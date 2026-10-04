/**
 * THE CYCLE'S SIX OBJECTS — `#mechanism`, one per step.
 *
 * Every step of the cycle happens somewhere in the product, and that
 * somewhere is what sits under each title: the lesson a learner reads, the
 * field where the decision is written, the practical step the Home asks for,
 * the assessment that confirms understanding, the returned report that asks
 * for a correction, the level that completes and opens the next. Six objects
 * of six different shapes, in the product's own materials and words — the
 * Home's real next actions («Выполните практический шаг», «Пройдите проверку
 * знаний»), the status panel's real lines, the real titles of L5 and L6.
 *
 * Nothing here is captured from a learner, and no number is a sum of money.
 */
export function CycleObject({ step }: { step: 1 | 2 | 3 | 4 | 5 | 6 }) {
  switch (step) {
    case 1:
      return (
        <div className="cyc cyc--lesson" data-step="1" aria-label="Урок в продукте">
          <p className="pw-mono">Урок · уровень 5</p>
          <p className="cyc__title">Жизненный цикл сделки</p>
          <div className="cyc__progress" aria-hidden="true">
            <i style={{ "--v": "50%" } as React.CSSProperties} />
          </div>
          <p className="cyc__sub">Прочитано 2 из 4 разделов</p>
        </div>
      );
    case 2:
      return (
        <div className="cyc cyc--decide" data-step="2" aria-label="Поле решения в продукте">
          <p className="pw-mono">Причина входа до сделки</p>
          <p className="cyc__field">Вход только после подтверждения уровня — не раньше.</p>
          <p className="pw-mono pw-mono--signal">● Зафиксировано</p>
        </div>
      );
    case 3:
      return (
        <div className="cyc cyc--act" data-step="3" aria-label="Практический шаг в продукте">
          <p className="pw-mono pw-mono--signal">Требуется действие</p>
          <p className="cyc__title">Выполните практический шаг</p>
          <span className="pw-button pw-button--sm">Открыть уровень</span>
        </div>
      );
    case 4:
      return (
        <div className="cyc cyc--check" data-step="4" aria-label="Проверка знаний в продукте">
          <p className="pw-mono">Вопрос 3 из 5</p>
          <p className="cyc__q">Что записывается до входа в сделку?</p>
          <ul className="cyc__options" aria-hidden="true">
            <li className="is-on">Причина входа</li>
            <li>Результат сделки</li>
            <li>Настроение</li>
          </ul>
          <p className="cyc__sub">Для завершения — 100 %</p>
        </div>
      );
    case 5:
      return (
        <div className="cyc cyc--fix" data-step="5" aria-label="Возврат на доработку в продукте">
          <p className="cyc__feedback">↩︎ Наставник запросил доработку</p>
          <p className="cyc__sub">Что сделать: описать условие, а не ощущение.</p>
          <span className="pw-button pw-button--sm">Создать исправленную версию</span>
        </div>
      );
    default:
      return (
        <div className="cyc cyc--next" data-step="6" aria-label="Следующий уровень в продукте">
          <p className="cyc__done">✓ Уровень завершён</p>
          <ol className="cyc__path" aria-hidden="true">
            <li className="is-done">L5</li>
            <li className="is-current">L6</li>
            <li>L7</li>
          </ol>
          <p className="cyc__sub">Открылся L6 · Выбор актива</p>
        </div>
      );
  }
}
