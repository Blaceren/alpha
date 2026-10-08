import type { RouteStateId } from "@/features/public-home/product-route-data";

/**
 * THE WINDOW'S STATES — eight presentations of the product, one per route step.
 *
 * Each state is the product's own object, rebuilt for presentation: the same
 * words the product uses (the Home's next action, the Path's module card, the
 * six tools' real fields and verdicts), at a scale that reads from a distance,
 * with a single moment of motion that shows what the object does. They are not
 * screenshots and they are not the product's components — the public page
 * cannot import a signed-in surface, and a presentation needs to be able to
 * leave things out.
 *
 * The material is synthetic and says so: the window's bar carries the
 * demonstration badge. No sum of money appears anywhere — the calculator and
 * the journal speak in percentages and in «прогноз верен / неверен» — no
 * broker, no balance, no person. `public-home.test.tsx` holds those lines.
 */

function HomeState() {
  return (
    <div className="pw-home">
      <div className="pw-home__rail">
        <p className="pw-mono">Главная · текущий приоритет</p>
        <p className="pw-mono pw-mono--signal pw-moment-1">Требуется действие</p>
      </div>
      <div className="pw-home__body">
        <p className="pw-home__level pw-moment-1">Как читать график: свеча, таймфрейм, масштаб</p>
        <h3 className="pw-home__title pw-moment-2">Пройдите проверку знаний</h3>
        <p className="pw-home__meta pw-moment-2">Модуль 01 · Уровень 4 · урок</p>
        <p className="pw-home__text pw-moment-3">
          Изучите урок и пройдите короткую проверку, чтобы завершить уровень.
        </p>
        <span className="pw-button pw-moment-3">Открыть уровень</span>
      </div>
    </div>
  );
}

/* The first module of the program learners have (2026-10-04, launch audit): it
   used to be the 100-level plan's — L1 «Подготовить среду», L3 a report, L4 a
   checkpoint — which is not what anyone who signs up finds. */
const MODULE_LEVELS = [
  { code: "L1", title: "Что такое бинарные опционы", kind: "done" },
  { code: "L2", title: "Как устроен ATA", kind: "done" },
  { code: "L3", title: "Регистрация и терминал", kind: "done" },
  { code: "L4", title: "Как читать график", kind: "current" },
  { code: "L5", title: "Жизненный цикл сделки", kind: "next" },
] as const;

function PathState() {
  return (
    <div className="pw-path">
      <div className="pw-path__head">
        <div>
          <p className="pw-path__h">Путь</p>
          <p className="pw-path__now">
            Сейчас: <strong>Уровень 4</strong> · Как читать график <span className="pw-mono">модуль 1 из 20</span>
          </p>
        </div>
        <p className="pw-path__count">Пройдено 3 из 100 уровней</p>
      </div>
      <div className="pw-path__bar" aria-hidden="true">
        <i />
      </div>
      <div className="pw-path__card">
        <div className="pw-path__card-head">
          <span className="pw-mono">Модуль 01 / 20</span>
          <span className="pw-mono">уровни 1–5</span>
        </div>
        <p className="pw-path__module">Первое знакомство</p>
        <ol className="pw-path__nodes" aria-label="Уровни модуля 01">
          {MODULE_LEVELS.map((level, index) => (
            <li key={level.code} className={`pw-node pw-node--${level.kind}`} style={{ "--i": index } as React.CSSProperties}>
              <i aria-hidden="true" />
              <span className="pw-mono">{level.code}</span>
              <strong>{level.title}</strong>
              {level.kind === "current" ? <em>текущий</em> : null}
              {level.kind === "done" ? <em>пройден</em> : null}
            </li>
          ))}
        </ol>
        <div className="pw-path__modules" aria-hidden="true">
          {Array.from({ length: 20 }, (_, index) => (
            <i key={index} className={index === 0 ? "is-active" : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TradeCardState() {
  return (
    <div className="pw-tool pw-trade">
      <div className="pw-tool__head">
        <p className="pw-tool__name">Trade Card</p>
        <p className="pw-tool__sub">План сделки до входа: актив, направление, экспирация и основание.</p>
      </div>
      <ol className="pw-trade__tabs" aria-hidden="true">
        <li className="is-active">Подготовка</li>
        <li>Открытие</li>
        <li>Экспирация</li>
        <li>Результат</li>
        <li>Разбор</li>
      </ol>
      <div className="pw-trade__grid">
        <div className="pw-field">
          <span>Актив</span>
          <strong>EUR/USD</strong>
        </div>
        <div className="pw-field pw-field--seg">
          <span>Направление</span>
          <strong>
            <b className="is-on">▲ Выше</b>
            <b>▼ Ниже</b>
          </strong>
        </div>
        <div className="pw-field">
          <span>Экспирация</span>
          <strong>3 мин</strong>
        </div>
        <div className="pw-field">
          <span>Payout</span>
          <strong>90 %</strong>
        </div>
        <div className="pw-field pw-field--wide pw-trade__reason">
          <span>Основание входа в сделку</span>
          <strong>
            <i className="pw-typing">Цена вернулась к уровню поддержки, отмеченному до сессии. Свеча закрылась выше уровня.</i>
          </strong>
        </div>
      </div>
      <div className="pw-trade__foot">
        <p className="pw-mono pw-mono--signal pw-trade__fixed">● Зафиксировано 17:20</p>
        <p className="pw-trade__note">После открытия условия сделки не меняются. Разбор — после экспирации: по плану или нет.</p>
      </div>
    </div>
  );
}

const JOURNAL_ROWS = [
  { time: "14:32", asset: "EUR/USD", dir: "▲ Выше", forecast: "прогноз верен", mark: "не отмечено", kind: "none" },
  { time: "14:02", asset: "EUR/USD", dir: "▼ Ниже", forecast: "прогноз неверен", mark: "нарушен", kind: "broken" },
  { time: "13:40", asset: "EUR/USD", dir: "▼ Ниже", forecast: "прогноз неверен", mark: "по плану", kind: "plan" },
  { time: "18:15", asset: "BTC/USD", dir: "▲ Выше", forecast: "прогноз верен", mark: "по плану", kind: "plan" },
] as const;

function JournalState() {
  return (
    <div className="pw-tool pw-journal">
      <div className="pw-tool__head">
        <p className="pw-tool__name">Trading Journal</p>
        <p className="pw-tool__sub">Ручной разбор отдельных сделок: основание, исполнение и вывод.</p>
      </div>
      <div className="pw-journal__counters">
        <div><span>Записей</span><strong>24</strong></div>
        <div><span>По плану</span><strong>12 <small>из 24</small></strong></div>
        <div><span>Без вывода</span><strong>13</strong></div>
      </div>
      <div className="pw-journal__filters" aria-hidden="true">
        <span className="is-on">Все</span><span>План нарушен 6</span><span>Нет вывода 13</span>
      </div>
      <p className="pw-mono pw-journal__day">21 сентября · понедельник</p>
      <ol className="pw-journal__rows">
        {JOURNAL_ROWS.map((row, index) => (
          <li key={row.time} className={`pw-row pw-row--${row.kind}`} style={{ "--i": index } as React.CSSProperties}>
            <span className="pw-mono">{row.time}</span>
            <strong>{row.asset}</strong>
            <span>{row.dir}</span>
            <span className="pw-row__forecast">{row.forecast}</span>
            <em className="pw-mono">{row.mark}</em>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RiskState() {
  return (
    <div className="pw-tool pw-risk">
      <div className="pw-tool__head">
        <p className="pw-tool__name">Risk Calculator</p>
        <p className="pw-tool__sub">Сумма сделки и дневной лимит по капиталу, доле риска и payout.</p>
      </div>
      <div className="pw-risk__grid">
        <div className="pw-risk__params">
          <div className="pw-field"><span>Payout</span><strong>90 %</strong></div>
          <div className="pw-field"><span>Дневной лимит потерь</span><strong>6 %</strong></div>
          <div className="pw-field pw-field--seg pw-field--wide">
            <span>Доля риска на сделку</span>
            <strong>
              <b>1 %</b><b className="is-on">2 %</b><b>3 %</b><b>5 %</b>
            </strong>
          </div>
        </div>
        <div className="pw-risk__calc">
          <p className="pw-mono">Расчёт</p>
          <p className="pw-risk__big pw-moment-1">Сумма сделки — <strong>2 %</strong> капитала</p>
          <p className="pw-risk__line pw-moment-2">Дневной лимит 6 % · <strong>3 убыточные сделки → стоп</strong></p>
          <p className="pw-risk__line pw-moment-2">Безубыточный win rate · <strong>52,6 %</strong></p>
          <p className="pw-mono pw-risk__series">Серия из 5 убытков подряд</p>
          <div className="pw-bar pw-moment-3" style={{ "--v": "10%" } as React.CSSProperties}>
            <span>Фиксированная сумма</span><em>10 % капитала</em><i />
          </div>
          <div className="pw-bar pw-bar--neg pw-moment-3" style={{ "--v": "62%" } as React.CSSProperties}>
            <span>Удвоение после убытка</span><em>62 % капитала</em><i />
          </div>
        </div>
      </div>
    </div>
  );
}

/* The seven conditions of the tool itself (owner 2026-10-07), none a stop factor. */
const CHECKS = [
  { group: "Среда", items: ["Актив из моего списка", "Время — подходящий период", "Payout посмотрел, планку посчитал — 85 %"] },
  { group: "График", items: ["Состояние определено: тренд, боковик или неясно", "Область названа"] },
  { group: "Сделка", items: ["Размер по плану", "Основание сформулировано словами"] },
] as const;

function ChecklistState() {
  let index = 0;
  return (
    <div className="pw-tool pw-check">
      <div className="pw-tool__head">
        <p className="pw-tool__name">Entry Checklist</p>
        <p className="pw-tool__sub">Условия допуска перед входом: среда, график и сделка.</p>
      </div>
      <div className="pw-check__grid">
        <div className="pw-check__list">
          <p className="pw-mono pw-check__count">EUR/USD · перед входом <b>7 / 7</b></p>
          {CHECKS.map((group) => (
            <div key={group.group} className="pw-check__group">
              <p className="pw-mono">{group.group}</p>
              {group.items.map((label) => {
                const i = index++;
                return (
                  <div key={label} className="pw-check__item" style={{ "--i": i } as React.CSSProperties}>
                    <i aria-hidden="true" />
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pw-check__verdict">
          <p className="pw-check__ok">Вход по плану допустим</p>
          <p>Все условия выполнены. Решение и сумму вы подтверждаете сами.</p>
          <span className="pw-button">Записать проверку</span>
          <p className="pw-check__note">Проверка записывается как есть — и «не входить» тоже: отказ от сделки остаётся в истории.</p>
        </div>
      </div>
    </div>
  );
}

function StatsState() {
  return (
    <div className="pw-tool pw-stats">
      <div className="pw-tool__head">
        <p className="pw-tool__name">Personal Stats</p>
        <p className="pw-tool__sub">Win rate, соблюдение плана и нарушения по записям журнала.</p>
      </div>
      <div className="pw-stats__range" aria-hidden="true">
        <span>7 дней</span><span>30 дней</span><span className="is-on">Всё время</span>
      </div>
      <div className="pw-stats__tiles">
        <div className="pw-moment-1"><span>Сделок</span><strong>38</strong><small>в журнале</small></div>
        <div className="pw-moment-1"><span>Win rate</span><strong>55 %</strong><small>21 из 38</small></div>
        <div className="pw-moment-2"><span>Безубыточность</span><strong>53,2 %</strong><small>при среднем payout 88 %</small></div>
        <div className="pw-moment-2"><span>По плану</span><strong>82 %</strong><small>31 из 38</small></div>
      </div>
      <div className="pw-stats__grid">
        <div>
          <p className="pw-stats__h">Win rate и соблюдение плана</p>
          <div className="pw-bar pw-moment-3" style={{ "--v": "61%", "--mark": "53.2%" } as React.CSSProperties}>
            <span>План соблюдён</span><em>61 % · 19 из 31</em><i />
          </div>
          <div className="pw-bar pw-bar--neg pw-moment-3" style={{ "--v": "29%", "--mark": "53.2%" } as React.CSSProperties}>
            <span>План нарушен</span><em>29 % · 2 из 7</em><i />
          </div>
        </div>
        <div>
          <p className="pw-stats__h">Нарушения <b>7</b></p>
          <div className="pw-bar pw-bar--neg pw-moment-3" style={{ "--v": "43%" } as React.CSSProperties}><span>Вход без записанного основания</span><em>3</em><i /></div>
          <div className="pw-bar pw-bar--neg pw-moment-3" style={{ "--v": "29%" } as React.CSSProperties}><span>Рядом важная новость</span><em>2</em><i /></div>
          <div className="pw-bar pw-bar--neg pw-moment-3" style={{ "--v": "29%" } as React.CSSProperties}><span>Сделка после дневного лимита</span><em>2</em><i /></div>
        </div>
      </div>
    </div>
  );
}

function NewsState() {
  return (
    <div className="pw-tool pw-news">
      <div className="pw-tool__head">
        <p className="pw-tool__name">News Calendar</p>
        <p className="pw-tool__sub">События дня в вашем часовом поясе и окна, когда вход закрыт по плану.</p>
      </div>
      <div className="pw-news__status pw-moment-2">
        <strong>Вход закрыт по вашему плану до 14:45</strong>
        <span>Через 12 мин: USD · Базовый индекс потребительских цен, <span className="pw-nowrap">м/м</span>.</span>
        <small>Первое движение после публикации — только наблюдение.</small>
      </div>
      <p className="pw-news__day">Сегодня, 21 сентября · понедельник <span className="pw-mono">по плану: USD, EUR · высокая важность · 15 мин до и 15 после</span></p>
      <div className="pw-news__track" aria-hidden="true">
        <span className="pw-news__now pw-moment-1">сейчас 14:18</span>
        <i className="pw-news__dot" style={{ "--x": "9%" } as React.CSSProperties} />
        <i className="pw-news__dot" style={{ "--x": "27%" } as React.CSSProperties} />
        <i className="pw-news__win" style={{ "--x": "48%", "--w": "5%" } as React.CSSProperties} />
        <i className="pw-news__dot pw-news__dot--plan" style={{ "--x": "50%" } as React.CSSProperties} />
        <i className="pw-news__dot" style={{ "--x": "62%" } as React.CSSProperties} />
        <i className="pw-news__win" style={{ "--x": "84%", "--w": "5%" } as React.CSSProperties} />
        <i className="pw-news__dot pw-news__dot--plan" style={{ "--x": "86%" } as React.CSSProperties} />
        <b className="pw-news__cursor pw-moment-1" />
        <span className="pw-news__h" style={{ "--x": "14%" } as React.CSSProperties}>09</span>
        <span className="pw-news__h" style={{ "--x": "36%" } as React.CSSProperties}>12</span>
        <span className="pw-news__h" style={{ "--x": "57%" } as React.CSSProperties}>15</span>
        <span className="pw-news__h" style={{ "--x": "79%" } as React.CSSProperties}>18</span>
        <span className="pw-news__h" style={{ "--x": "100%" } as React.CSSProperties}>21</span>
      </div>
      <ol className="pw-news__events">
        <li>
          <span className="pw-mono">14:30</span><b className="pw-news__cur">USD</b>
          <span className="pw-news__title">Базовый индекс потребительских цен, <span className="pw-nowrap">м/м</span> <em className="pw-mono">скоро</em></span>
          <small>США · ●●● · прогноз 0,3 % · вход закрыт 14:15–14:45</small>
        </li>
        <li>
          <span className="pw-mono">20:00</span><b className="pw-news__cur">USD</b>
          <span className="pw-news__title">Решение по процентной ставке ФРС</span>
          <small>США · ●●● · прогноз 5,25 % · вход закрыт 19:45–20:15</small>
        </li>
      </ol>
    </div>
  );
}

const STATES: Readonly<Record<RouteStateId, () => React.JSX.Element>> = {
  home: HomeState,
  path: PathState,
  "trade-card": TradeCardState,
  journal: JournalState,
  "risk-calculator": RiskState,
  "entry-checklist": ChecklistState,
  stats: StatsState,
  news: NewsState,
};

export function RouteWindowState({ id }: { id: RouteStateId }) {
  const State = STATES[id];
  return <State />;
}
