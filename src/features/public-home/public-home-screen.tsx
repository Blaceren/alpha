import Link from "next/link";
import { PublicHomeHeader } from "@/features/public-home/public-home-header";
import { PublicHomeEffects } from "@/features/public-home/public-home-effects";
import { PUBLIC_HOME_FAQ } from "@/features/public-home/public-home-faq";
import { ProductRoute } from "@/features/public-home/product-route";

/**
 * PUBLIC HOME — the brand-evolution composition.
 *
 * WHAT THIS PAGE WAS, AND WHY IT IS NO LONGER THAT. Until this phase Public Home
 * was a byte-faithful port of the frozen HomeATA page @ e82bba3a: every section
 * in the frozen order, every string unabridged, every class name unchanged. That
 * identity was deliberately broken here, and ONLY here, on the owner's explicit
 * authorisation (N-4). The permission covers this route alone — Auth, AppShell,
 * the Academy Home, Path, Lessons, Reader, Workspace, Tools, Support, Profile and
 * Notifications keep their own contracts untouched, and so do Backend, CRM and
 * Partner.
 *
 * WHAT SURVIVES THE BREAK. The visual system is unchanged: the same Ink/Signal
 * surfaces, the same three vendored families, the same grid, spacing, radii,
 * focus ring and reveal mechanism. This is a recomposition, not a restyle. The
 * stylesheet is still namespaced under `.ph` and still makes no remote request.
 *
 * WHAT CHANGED, AND WHY:
 *
 *   * The page used to open by negating a category — "не ещё один источник
 *     информации". An argument against competitors leaves no room for the
 *     learner's own agency, which is exactly the thing the product asks for. It
 *     now opens on the human situation: opportunity without a ready answer.
 *
 *   * `#recognition` became `#decide`: the same «many → one» device, retargeted
 *     from "too much content" to "someone else's answer vs your own decision".
 *
 *   * The six-step loop gained DECIDE and lost its duplicated CHECK. The product
 *     audit (N-2) confirmed the report REQUIRES a decision and its basis —
 *     `pre-trade-reason`, a required field graded by its own rubric criterion.
 *
 *   * `#first-journey` merged into `#product`. Four consecutive numbered
 *     sequences was one too many, and the journey is a detail of the product.
 *
 *   * Every reserved slot is gone. The page used to ship four production notes
 *     to the public («ожидает утверждённый скриншот», «Контент-слот…»). Nothing
 *     here is empty and nothing announces its own emptiness (N-5).
 *
 * OLD ANCHORS STILL RESOLVE. `#recognition`, `#first-journey` and `#start` are
 * kept as dimensionless alias targets placed at the content that replaced them,
 * so every published deep link still lands in the right place.
 *
 * THE SYNTHETIC MATERIAL IS MARKED AS SYNTHETIC. The report entry that runs
 * through the Decision Frame, the Academy panel and the two tool panels are
 * demonstrations of structure, authored for this page. They are labelled
 * «Демонстрационный пример» wherever they appear. No learner work, no learner
 * data, no screenshot of a real account, and nothing that depicts profit or a
 * financial outcome.
 *
 * It reads NO learner data and performs no request. The only thing it knows
 * about the visitor is whether a session exists.
 */

/** The one decision object the Frame carries, in its two settled readings. */
const DECISION_FIELD = "Причина входа до сделки";
const DECISION_UNSET = "Ещё не сформулировано";
const DECISION_WEAK = "Вошёл, потому что показалось, что цена развернётся.";
const DECISION_STRONG =
  "До сделки зафиксировал условие: вход только после подтверждения заранее " +
  "отмеченного уровня. Дождался его выполнения и не менял план во время сделки.";

export function PublicHomeScreen({ authenticated }: { authenticated: boolean }) {
  const account = authenticated
    ? { href: "/home", label: "Перейти в Академию" }
    : { href: "/register", label: "Начать путь" };

  return (
    <div className="ph" data-ph-root>
      <PublicHomeEffects />

      <a className="skip-link" href="#main">
        Перейти к содержанию
      </a>

      <PublicHomeHeader authenticated={authenticated} />

      <main id="main">
        {/* ------------------------------------------ 02 · opportunity */}
        <section className="hero surface surface--ink" id="top">
          <div className="hero__inner shell">
            <div className="hero__copy" data-reveal>
              <p className="eyebrow">ALFA TRADE ACADEMY · СРЕДА РАБОТЫ С РЫНКОМ</p>
              <h1 className="display display--hero">
                Возможности не приходят с готовыми ответами.
              </h1>
              <p className="hero__definition">
                Рынок — одна из таких сред. В ATA вы последовательно учитесь понимать ситуацию,
                формулировать собственное решение и его основание, действовать, проверять работу и
                исправлять её.
              </p>
              <div className="hero__actions">
                <a className="button button--signal" href="#mechanism">
                  Посмотреть, как работает ATA
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h11M11 6l4 4-4 4" />
                  </svg>
                </a>
                <Link className="button button--ghost" href={account.href}>
                  {account.label}
                </Link>
              </div>
              <p className="hero__boundary">
                ATA — образовательная среда. Мы не даём торговых сигналов и не обещаем
                гарантированный финансовый результат.
              </p>
            </div>

            {/* Decision Frame — stage 1. NOT an empty reserve: the object inside
                is a real report field, legible and deliberately unfinished. */}
            <figure className="dframe dframe--open" data-reveal data-frame-stage="open">
              <figcaption className="dframe__label">
                <span className="demo-badge">Демонстрационный пример</span>
                <span className="dframe__stage">Решение ещё не определено</span>
              </figcaption>
              <div className="dframe__object">
                <p className="dframe__field">{DECISION_FIELD}</p>
                <p className="dframe__value dframe__value--empty">
                  {DECISION_UNSET}
                  <i className="dframe__caret" aria-hidden="true" />
                </p>
                <div className="dframe__unresolved" aria-hidden="true">
                  <i />
                  <i />
                </div>
              </div>
            </figure>
          </div>

          <div className="hero__facts shell" aria-label="Ключевые факты о пути ATA" data-reveal>
            <div>
              <strong>20</strong>
              <span>модулей</span>
            </div>
            <div>
              <strong>100</strong>
              <span>последовательных уровней</span>
            </div>
            <div>
              <strong>L2</strong>
              <span>первая проверка знаний</span>
            </div>
            <div>
              <strong>L3</strong>
              <span>первая практика и разбор</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- 03 · decide */}
        <section className="recognition surface surface--signal" id="decide">
          {/* Alias: `#recognition` was this section's published address. */}
          <span className="anchor-alias" id="recognition" aria-hidden="true" />
          <div className="shell recognition__grid">
            <div className="section-intro" data-reveal>
              <p className="eyebrow eyebrow--dark">От чужого ответа — к собственному решению</p>
              <h2 className="display display--section">
                На рынке решение нельзя полностью делегировать.
              </h2>
              <p className="lead">
                Можно изучать чужие разборы, стратегии и мнения. Но действовать приходится вам — и
                понимать, на чём основано ваше решение.
              </p>
            </div>

            <div className="reframe" data-reveal>
              <div className="source-cloud" aria-label="Чужие ответы">
                <span>Разборы</span>
                <span>Стратегии</span>
                <span>Сигналы</span>
                <span>Прогнозы</span>
                <span>Мнения</span>
                <span>Чужие выводы</span>
              </div>
              <div className="reframe__axis" aria-hidden="true" />

              {/* Decision Frame — stage 2: the same object, now determinate. */}
              <figure className="dframe dframe--set" data-frame-stage="set">
                <figcaption className="dframe__label">
                  <span className="demo-badge">Демонстрационный пример</span>
                  <span className="dframe__stage">Основание сформулировано</span>
                </figcaption>
                <div className="dframe__object">
                  <p className="dframe__field">{DECISION_FIELD}</p>
                  <p className="dframe__value">
                    {/* The wrapper is what the «many → one» sequence writes into;
                        the string is the same one #review carries. */}
                    <i className="dframe__type">{DECISION_STRONG}</i>
                  </p>
                </div>
                <p className="dframe__statement">
                  Собственное решение — не чужой вывод. Это действие, основание которого вы можете
                  объяснить.
                </p>
              </figure>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- 04 · mechanism */}
        <section className="mechanism surface surface--ink" id="mechanism">
          <div className="shell">
            <div className="section-intro section-intro--wide" data-reveal>
              <p className="eyebrow">Как это работает</p>
              <h2 className="display display--section">
                Цикл, в котором решение принимаете вы.
              </h2>
              <p className="lead">
                На предусмотренных уровнях путь ATA связывает понимание, собственное решение,
                практическую работу, проверку и исправление.
              </p>
            </div>

            {/* The list itself reveals too: its `is-visible` is what draws the
                line and lights the nodes, once, in order. */}
            <ol className="learning-loop" aria-label="Шесть этапов цикла ATA" data-reveal>
              <li data-reveal>
                <span>01</span>
                <h3>Понять</h3>
                <p>Изучить принцип и увидеть его в контексте.</p>
              </li>
              <li data-reveal>
                <span>02</span>
                <h3>Решить</h3>
                <p>Сформулировать собственное решение и назвать его основание.</p>
              </li>
              <li data-reveal>
                <span>03</span>
                <h3>Действовать</h3>
                <p>Перевести решение в конкретную практическую работу.</p>
              </li>
              <li data-reveal>
                <span>04</span>
                <h3>Проверить</h3>
                <p>Подтвердить понимание проверкой знаний, а работу — разбором.</p>
              </li>
              <li data-reveal>
                <span>05</span>
                <h3>Исправить</h3>
                <p>Учесть замечания и, если требуется, отправить новую версию.</p>
              </li>
              <li data-reveal>
                <span>06</span>
                <h3>Продвинуться</h3>
                <p>После выполнения условий открывается следующий уровень.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* --------------------------------------- 05 · signature evidence */}
        <section className="review-proof surface surface--ink" id="review">
          <div className="shell">
            <div className="review-proof__heading" data-reveal>
              <div>
                <p className="eyebrow">Главное доказательство · проверка работы</p>
                <h2 className="display display--section">Пройдено — ещё не значит освоено.</h2>
              </div>
              <p className="lead">
                На предусмотренных уровнях работа проходит полный цикл: первая версия, разбор
                человеком, исправление и принятие.
              </p>
            </div>

            <p className="demo-badge demo-badge--block" data-reveal>
              Демонстрационный пример структуры работы
            </p>

            <ol className="evidence-track" data-evidence aria-label="Цикл проверки практической работы">
              <li data-reveal data-frame-stage="v1">
                <p className="evidence__index">V1</p>
                <h3>Работа отправлена</h3>
                <div className="evidence__object">
                  <p className="dframe__field">{DECISION_FIELD}</p>
                  <p className="dframe__value">{DECISION_WEAK}</p>
                </div>
                <p className="evidence__note">
                  Учащийся фиксирует решение и его основание в отчёте уровня.
                </p>
              </li>

              <li data-reveal data-frame-stage="feedback">
                <p className="evidence__index">Разбор</p>
                <h3>Получен разбор</h3>
                <div className="evidence__object evidence__object--flagged">
                  <p className="dframe__field">Критерий · Причина до сделки</p>
                  <p className="evidence__verdict">Требуется доработка</p>
                  <p className="evidence__action">
                    Опишите условие, которое вы определили заранее, а не ощущение в момент входа.
                  </p>
                </div>
                <p className="evidence__note">
                  Проверяющий возвращает работу по конкретному критерию рубрики.
                </p>
              </li>

              <li data-reveal data-frame-stage="v2">
                <p className="evidence__index">V2</p>
                <h3>Замечание исправлено</h3>
                <div className="evidence__object evidence__object--corrected">
                  <p className="dframe__field">{DECISION_FIELD}</p>
                  <p className="dframe__value">{DECISION_STRONG}</p>
                </div>
                <p className="evidence__note">
                  Меняется то же самое место — основание решения, а не оформление.
                </p>
              </li>

              <li data-reveal data-frame-stage="accepted">
                <p className="evidence__index">✓</p>
                <h3>Работа принята</h3>
                <div className="evidence__object evidence__object--accepted">
                  <p className="evidence__accepted">Условия уровня выполнены</p>
                  <p className="evidence__action">Следующий уровень открывается.</p>
                </div>
                <p className="evidence__note">
                  Принятие подтверждает выполненную работу — не результат сделок.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* ------------------------------ 06–08 · the route and the window */}
        {/* `#product` is the route; `#path` and `#tools` are its segments, in
            the same document order as before. See product-route.tsx. */}
        <ProductRoute />

        {/* ---------------------------------------------------- 09 · fit */}
        <section className="fit surface surface--signal surface--signal-deep" id="fit">
          <div className="shell">
            <div className="section-intro section-intro--wide" data-reveal>
              <p className="eyebrow eyebrow--dark">Подходит ли вам ATA</p>
              <h2 className="display display--section">
                Право сказать «не сейчас» тоже создаёт доверие.
              </h2>
              <p className="lead">
                ATA может подойти тем, кто хочет понимать основания собственного решения и готов
                проверять качество своей работы.
              </p>
            </div>

            <div className="fit__columns">
              <article data-reveal>
                <p className="micro-label">ATA может подойти, если вы</p>
                <h3>Хотите выстроить собственное понимание.</h3>
                <ul className="plain-list">
                  <li>не являетесь профессиональным трейдером;</li>
                  <li>готовы учиться и выполнять задания;</li>
                  <li>цените последовательность и обратную связь;</li>
                  <li>хотите лучше понимать собственные решения;</li>
                  <li>можете выделять время на самостоятельную работу.</li>
                </ul>
              </article>

              <article data-reveal>
                <p className="micro-label">Лучше не начинать сейчас, если вы</p>
                <h3>Ищете быстрый или гарантированный результат.</h3>
                <ul className="plain-list">
                  <li>хотите получать только сигналы или копировать сделки;</li>
                  <li>не готовы проходить проверки и исправлять работу;</li>
                  <li>ожидаете пассивного решения без обучения;</li>
                  <li>пытаетесь немедленно компенсировать прошлые потери;</li>
                  <li>планируете использовать деньги для обязательных расходов.</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        {/* --------------------------------------------- 10 · boundaries */}
        <section className="boundaries surface surface--ink" id="boundaries">
          <div className="shell boundaries__grid">
            <div data-reveal>
              <p className="eyebrow">Что такое ATA</p>
              <h2 className="display display--section">
                Образовательная система для развития самостоятельности.
              </h2>
              <p className="lead">
                ATA соединяет обучение, проверку понимания, практику, обратную связь и
                последовательное продвижение по одному пути.
              </p>
            </div>

            <div className="not-list" data-reveal>
              <p className="micro-label">ATA — это не</p>
              <ul>
                <li>сигнальный сервис;</li>
                <li>копирование сделок;</li>
                <li>торговый терминал;</li>
                <li>управление капиталом;</li>
                <li>обещание прибыли.</li>
              </ul>
            </div>

            <div className="environment-note" data-reveal>
              <span>Практическая среда</span>
              <p>
                Для части практического пути используется внешняя торговая среда. Она
                поддерживает обучение, но не является центральным ценностным предложением ATA.
              </p>
            </div>
          </div>
        </section>

        {/* --------------------------------------- 11 · faq + final cta */}
        <section className="faq surface surface--paper" id="faq">
          <div className="shell faq__grid">
            <div className="faq__heading" data-reveal>
              <p className="eyebrow eyebrow--dark">Частые вопросы · подтверждённые ответы</p>
              <h2 className="display display--section">
                До начала пути не должно оставаться скрытых условий.
              </h2>
              <p>В первую версию включены только ответы, подтверждённые действующим продуктом.</p>
            </div>

            <div className="faq-list" data-reveal>
              {PUBLIC_HOME_FAQ.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>

          {/* Alias: `#start` addressed the final call to action. */}
          <span className="anchor-alias" id="start" aria-hidden="true" />
          <div className="shell final-step" data-reveal>
            <p className="eyebrow eyebrow--dark">Первый шаг</p>
            <h2 className="display display--section final-step__title">
              Если вы хотите учиться принимать собственные решения — начните с первого уровня.
            </h2>
            <p className="final-step__support">
              После регистрации вы увидите один понятный следующий шаг.
            </p>
            <div className="final-step__actions">
              <Link className="button button--dark" href={account.href}>
                {account.label}
              </Link>
              {authenticated ? null : (
                <Link className="client-entry" href="/login">
                  Уже клиент? <strong>Войти</strong>
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell site-footer__grid">
          <p>© <span data-year>{new Date().getFullYear()}</span> Alfa Trade Academy</p>
          <p>Обучение и прохождение ATA не гарантируют финансовый результат.</p>
          {/* The three legal labels have no destination pages yet. They are NOT
              links and NOT a navigation landmark — an affordance that goes
              nowhere is worse than plain text (N-6). */}
          <p className="site-footer__legal">Конфиденциальность · Условия · Риски</p>
        </div>
      </footer>
    </div>
  );
}
