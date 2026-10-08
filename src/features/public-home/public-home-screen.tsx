import Link from "next/link";
import { PublicHomeHeader } from "@/features/public-home/public-home-header";
import { PublicHomeEffects } from "@/features/public-home/public-home-effects";
import { PUBLIC_HOME_FAQ } from "@/features/public-home/public-home-faq";
import { ProductRoute } from "@/features/public-home/product-route";
import { ReviewWindow } from "@/features/public-home/review-window";
import { DecisionWindow } from "@/features/public-home/decision-window";
import { CycleObject } from "@/features/public-home/cycle-objects";
import { HeroFilm } from "@/features/public-home/hero-film";
import type { PublicFilm } from "@/server/media/public-film";

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

/** What others hand you — the kind, and a line of it. Authored examples, no
    instrument, no amount, no person. */
const OTHERS_ANSWERS = [
  { kind: "Разбор", said: "«У сильного уровня — жду отскок»" },
  { kind: "Стратегия", said: "«Три свечи подряд — входи по тренду»" },
  { kind: "Сигнал", said: "«Вверх, пять минут»" },
  { kind: "Прогноз", said: "«К пятнице будет ниже»" },
  { kind: "Мнение", said: "«Рынок перегрет»" },
  { kind: "Чужой вывод", said: "«Все уже в покупках»" },
] as const;

export function PublicHomeScreen({
  authenticated,
  film = null,
}: {
  authenticated: boolean;
  /** The film on the host, or null while there is none (`server/media/public-film.ts`). */
  film?: PublicFilm | null;
}) {
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
              <p className="eyebrow">ALPHA TRADE ACADEMY · СРЕДА РАБОТЫ С РЫНКОМ</p>
              {/* DD-364 (owner, 2026-10-08): «тут меняем на АТА - инновационная
                  платформа обучения трейдингу». The line under it used to begin
                  «Рынок — одна из таких сред», which pointed back at the old
                  headline; with nothing left to point at, it begins with the
                  learner and names the market itself. */}
              <h1 className="display display--hero">
                ATA — инновационная платформа обучения трейдингу.
              </h1>
              <p className="hero__definition">
                Здесь вы последовательно учитесь понимать ситуацию на рынке, формулировать
                собственное решение и его основание, действовать, проверять работу и исправлять её.
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

            {/* THE FILM (2026-10-04). The frame kept here since 2026-09-22 for
                the film about the platform holds it now — its cover with
                «Скоро» until the video is on the host, then the player.
                hero-film.tsx */}
            <HeroFilm film={film} />
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
            {/* The program learners have (2026-10-04, launch audit): the first test
                is level 4, the first practice with a report is level 9. DD-365
                (owner, 2026-10-08): «вместо L4 — первая проверка знаний ждёт вас
                уже на 4 уровне, вместо L9 — практика начинается уже с 9 урока»;
                set as sentences in their own type they «stood out and did not
                stack with the other cells», so each is the rail's own two tiers:
                the level as the lit figure, the owner's words as the caption
                that continues it («4 | уровень, на котором…»). */}
            <div>
              <strong>4</strong>
              <span>уровень, на котором вас уже ждёт первая проверка знаний</span>
            </div>
            <div>
              <strong>9</strong>
              <span>урок, с которого уже начинается практика</span>
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
              {/* Phones only (CSS): stacked, the device needs its two words —
                  what recedes and what is written. DD-342. */}
              <p className="reframe__caption" aria-hidden="true">Чужие ответы</p>
              {/* OTHERS' ANSWERS, SAID (2026-10-04, owner: «тут нужен хай фай»).
                  Six pale pills only named the kinds of answer. Each is now a
                  line someone else said — what a review, a signal, a forecast
                  actually hands you — in the page's ink, fading as it recedes.
                  None of them is the learner's reason: that is written in the
                  card the line leads to. */}
              <ul className="source-cloud" aria-label="Чужие ответы">
                {OTHERS_ANSWERS.map((item) => (
                  <li className="src" key={item.kind}>
                    <span className="src__kind">{item.kind}</span>
                    <span className="src__said">{item.said}</span>
                  </li>
                ))}
              </ul>
              <div className="reframe__axis" aria-hidden="true" />
              <p className="reframe__caption reframe__caption--own" aria-hidden="true">Ваше решение</p>

              {/* The same object, now determinate — in the Trade Card, where
                  the product holds it. decision-window.tsx */}
              <DecisionWindow />
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
                <CycleObject step={1} />
              </li>
              <li data-reveal>
                <span>02</span>
                <h3>Решить</h3>
                <p>Сформулировать собственное решение и назвать его основание.</p>
                <CycleObject step={2} />
              </li>
              <li data-reveal>
                <span>03</span>
                <h3>Действовать</h3>
                <p>Перевести решение в конкретную практическую работу.</p>
                <CycleObject step={3} />
              </li>
              <li data-reveal>
                <span>04</span>
                <h3>Проверить</h3>
                <p>Подтвердить понимание проверкой знаний, а работу — разбором.</p>
                <CycleObject step={4} />
              </li>
              <li data-reveal>
                <span>05</span>
                <h3>Исправить</h3>
                <p>Учесть замечания и, если требуется, отправить новую версию.</p>
                <CycleObject step={5} />
              </li>
              <li data-reveal>
                <span>06</span>
                <h3>Продвинуться</h3>
                <p>После выполнения условий открывается следующий уровень.</p>
                <CycleObject step={6} />
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

            {/* The product's own report workspace, moved through the four
                states, with the strip of words beneath it. review-window.tsx */}
            <ReviewWindow />
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
                {/* Said to a visitor, not to the team (2026-10-04, launch audit): the
                    line ended «…не является центральным ценностным предложением ATA». */}
                Для части практического пути используется внешняя торговая среда. Она нужна
                для практики, а учит вас Академия.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- 11 · faq */}
        {/* On Ink since DD-360 (owner 2026-10-07: «избавиться от эффекта блоков
            на белом фоне»): the page is a dark showcase, and its fine print
            reads on the same ground as everything else. */}
        <section className="faq surface surface--ink" id="faq">
          <div className="shell faq__grid">
            <div className="faq__heading" data-reveal>
              <p className="eyebrow">Частые вопросы · подтверждённые ответы</p>
              <h2 className="display display--section">
                До начала пути не должно оставаться скрытых условий.
              </h2>
              <p>Каждый ответ проверен на том, как Академия работает сейчас.</p>
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
        </section>

        {/* ------------------------------------------ 12 · first step */}
        {/* The page's last word is the action, on Signal — the colour every
            «next step» of the product wears (DD-360). Its own sheet, laid
            over the dark fine print; the footer's dark sheet closes it. */}
        <section className="first-step surface surface--signal" id="first-step">
          {/* Alias: `#start` addressed the final call to action. */}
          <span className="anchor-alias" id="start" aria-hidden="true" />
          <div className="shell final-step" data-reveal>
            <p className="eyebrow">Первый шаг</p>
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
                  Уже учитесь? <strong>Войти</strong>
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell site-footer__grid">
          <p>© <span data-year>{new Date().getFullYear()}</span> Alpha Trade Academy</p>
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
