import Link from "next/link";
import { PublicHomeHeader } from "@/features/public-home/public-home-header";
import { PublicHomeEffects } from "@/features/public-home/public-home-effects";

/**
 * PUBLIC HOME — the frozen HomeATA page, rendered by the product.
 *
 * VISUAL AND CONTENT AUTHORITY: HomeATA @ e82bba3a4cb282ba1d0e7814d04db950f0905cb8
 * (index.html sha256 13a40303…9b4364a0). Every section, in the frozen order;
 * every string, unabridged; every class name, unchanged — so the namespaced
 * stylesheet, which is that page's own CSS, applies to it exactly.
 *
 * WHAT IS NOT HomeATA, AND WHY — the complete list:
 *
 *   * `<html>`, `<head>`, `<body>` are the app's, not this page's. The favicon
 *     and theme colour move to the route's metadata, and the stylesheet and
 *     controller are imported rather than <link>ed and <script>ed.
 *   * Anchors that leave the page (`/register`, `/login`, `/home`) are Next
 *     <Link>s. In-page anchors (`#mechanism`, `#top`, …) stay plain <a>, because
 *     they are fragment navigation and must not be intercepted by the router.
 *   * Asset paths point at the vendored copies under /brand/.
 *   * The footer year is rendered on the server instead of written by a script.
 *   * AUTH_STATE_ONLY: for a signed-in visitor the primary call to action
 *     becomes «Перейти в Академию» → /home, and the three service login
 *     affordances are omitted. Composition, order and geometry are untouched.
 *     Nothing else differs between the two states.
 *
 * It reads NO learner data. The only thing it knows about the visitor is whether
 * a session exists.
 */
export function PublicHomeScreen({ authenticated }: { authenticated: boolean }) {
  const primary = authenticated
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
        {/* ---------------------------------------------------------- hero */}
        <section className="hero surface surface--ink" id="top">
          <div className="hero__inner shell">
            <div className="hero__copy" data-reveal>
              <p className="eyebrow">Alfa Trade Academy · образовательная платформа</p>
              <h1 className="display display--hero">
                Не ещё один источник информации о трейдинге.{" "}
                <span>
                  Система, где знание превращается в действие, проверку, обратную связь и
                  следующий шаг.
                </span>
              </h1>
              <p className="hero__definition">
                Уроки, проверки знаний, практические задания и разбор работы человеком собраны в
                один последовательный путь из 100 уровней.
              </p>
              <div className="hero__actions">
                <Link className="button button--signal" href={primary.href}>
                  {primary.label}
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h11M11 6l4 4-4 4" />
                  </svg>
                </Link>
              </div>
              <p className="hero__boundary">
                ATA не является сигнальным сервисом и не обещает гарантированный финансовый
                результат.
              </p>
            </div>

            <div
              className="video-reserve"
              data-reveal
              role="img"
              aria-label="Зарезервированное место для будущего бренд-видео и собственного плеера ATA"
            />
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

        {/* --------------------------------------------------- recognition */}
        <section className="recognition surface surface--signal" id="recognition">
          <div className="shell recognition__grid">
            <div className="section-intro" data-reveal>
              <p className="eyebrow eyebrow--dark">Проблема · не в количестве материалов</p>
              <h2 className="display display--section">Информации много. Системы — мало.</h2>
              <p className="lead">
                Можно смотреть разборы, читать статьи и знать термины — но всё ещё не понимать,
                что делать следующим и правильно ли применено знание.
              </p>
            </div>

            <div className="reframe" data-reveal>
              <div className="source-cloud" aria-label="Разрозненные источники информации">
                <span>YouTube</span>
                <span>Telegram</span>
                <span>Статьи</span>
                <span>Стратегии</span>
                <span>Сигналы</span>
                <span>Разные мнения</span>
              </div>
              <div className="reframe__axis" aria-hidden="true" />
              <div className="next-action-concept">
                <div className="frame-mark frame-mark--compact" aria-hidden="true">
                  <i />
                  <i />
                </div>
                <p className="micro-label">Принцип ATA · не интерфейс продукта</p>
                <h3>Один понятный следующий шаг</h3>
                <p>Не выбирать из двадцати действий. Выполнить текущую задачу и открыть следующую.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- mechanism */}
        <section className="mechanism surface surface--ink" id="mechanism">
          <div className="shell">
            <div className="section-intro section-intro--wide" data-reveal>
              <p className="eyebrow">Как это работает</p>
              <h2 className="display display--section">
                Путь, в котором каждый шаг должен что-то изменить.
              </h2>
              <p className="lead">
                ATA превращает обучение в повторяемый цикл, а ошибку — в часть процесса развития.
              </p>
            </div>

            <ol className="learning-loop" aria-label="Шесть этапов учебного цикла ATA">
              <li data-reveal>
                <span>01</span>
                <h3>Понять</h3>
                <p>Изучить принцип и увидеть его в контексте.</p>
              </li>
              <li data-reveal>
                <span>02</span>
                <h3>Проверить себя</h3>
                <p>Подтвердить понимание через проверку знаний.</p>
              </li>
              <li data-reveal>
                <span>03</span>
                <h3>Применить</h3>
                <p>Перевести знание в конкретную практическую работу.</p>
              </li>
              <li data-reveal>
                <span>04</span>
                <h3>Получить разбор</h3>
                <p>На ключевых этапах работа проверяется человеком.</p>
              </li>
              <li data-reveal>
                <span>05</span>
                <h3>Исправить</h3>
                <p>Учесть замечания и повторно отправить работу.</p>
              </li>
              <li data-reveal>
                <span>06</span>
                <h3>Двигаться дальше</h3>
                <p>После выполнения условий открывается следующий уровень.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------- product proof */}
        <section
          className="product-proof surface surface--signal surface--signal-deep"
          id="product"
        >
          <div className="shell product-proof__grid">
            <div className="product-proof__copy" data-reveal>
              <p className="eyebrow eyebrow--dark">Реальный продукт · один следующий шаг</p>
              <h2 className="display display--section">
                Не витрина контента. Последовательная работа.
              </h2>
              <p className="lead">
                В каждый момент Academy показывает текущее действие. Следующий уровень
                открывается после выполнения условий предыдущего — не за XP и не случайным
                выбором.
              </p>

              <div className="activity-grid" aria-label="Подтверждённые форматы работы ATA">
                <div>
                  <span>01</span>
                  <strong>Уроки и проверки знаний</strong>
                </div>
                <div>
                  <span>02</span>
                  <strong>Практические задания</strong>
                </div>
                <div>
                  <span>03</span>
                  <strong>Отчёты и проверка работы</strong>
                </div>
                <div>
                  <span>04</span>
                  <strong>Контрольные точки и прогресс</strong>
                </div>
              </div>
            </div>

            <div className="asset-slot asset-slot--product" data-reveal>
              <div className="asset-slot__corner asset-slot__corner--tl" aria-hidden="true" />
              <div className="asset-slot__corner asset-slot__corner--br" aria-hidden="true" />
              <div>
                <p className="micro-label">
                  Только реальный продукт · ожидает утверждённый скриншот
                </p>
                <h3>Главный экран Academy</h3>
                <p>Текущее действие и состояние прогресса</p>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- review proof */}
        <section className="review-proof surface surface--ink" id="review">
          <div className="shell">
            <div className="review-proof__heading" data-reveal>
              <div>
                <p className="eyebrow">Главное доказательство · проверка работы</p>
                <h2 className="display display--section">Посмотрел — не значит освоил.</h2>
              </div>
              <p className="lead">
                На ключевых уровнях работа должна пройти полный цикл: первая версия, проверка,
                исправление, повторная отправка и принятие.
              </p>
            </div>

            <ol className="review-sequence" aria-label="Цикл проверки практической работы">
              <li data-reveal>
                <span className="review-sequence__index">V1</span>
                <div className="review-sequence__slot" />
                <h3>Работа отправлена</h3>
                <p>Пользователь фиксирует результат практического этапа в отчёте.</p>
              </li>
              <li data-reveal>
                <span className="review-sequence__index">01</span>
                <div className="review-sequence__slot review-sequence__slot--annotated" />
                <h3>Работа проверена</h3>
                <p>Проверяющий возвращает структурированную обратную связь.</p>
              </li>
              <li data-reveal>
                <span className="review-sequence__index">V2</span>
                <div className="review-sequence__slot review-sequence__slot--resolved" />
                <h3>Замечания исправлены</h3>
                <p>Обновлённая версия повторно отправляется на проверку.</p>
              </li>
              <li data-reveal>
                <span className="review-sequence__index">✓</span>
                <div className="review-sequence__slot review-sequence__slot--approved" />
                <h3>Работа принята</h3>
                <p>Требования этапа выполнены, и путь может продолжаться.</p>
              </li>
            </ol>

            <p className="asset-note" data-reveal>
              Контент-слот: до публикации схема заменяется утверждённым обезличенным
              демо-материалом «V1 → проверка → V2 → принято».
            </p>
          </div>
        </section>

        {/* ------------------------------------------------- first journey */}
        <section className="first-journey surface surface--signal" id="first-journey">
          <div className="shell">
            <div className="section-intro section-intro--wide" data-reveal>
              <p className="eyebrow eyebrow--dark">Что произойдёт после регистрации</p>
              <h2 className="display display--section">
                Первые уровни быстро приводят к практике.
              </h2>
              <p className="lead">
                После создания аккаунта пользователь попадает в Academy и видит один текущий шаг.
              </p>
            </div>

            <ol className="journey-line" aria-label="Первые шаги пользователя ATA">
              <li data-reveal>
                <span>Старт</span>
                <h3>Создать аккаунт</h3>
                <p>Регистрация и автоматическое зачисление в действующий путь ATA.</p>
              </li>
              <li data-reveal>
                <span>L1</span>
                <h3>Подготовить среду</h3>
                <p>Создать необходимую внешнюю торговую среду для практической части.</p>
              </li>
              <li data-reveal>
                <span>L2</span>
                <h3>Понять устройство ATA</h3>
                <p>Пройти вводный урок и первую проверку знаний.</p>
              </li>
              <li data-reveal>
                <span>L3</span>
                <h3>Выполнить практику</h3>
                <p>Сделать первую практическую работу и отправить отчёт.</p>
              </li>
              <li data-reveal>
                <span>L3</span>
                <h3>Получить разбор</h3>
                <p>При необходимости исправить работу и отправить её повторно.</p>
              </li>
            </ol>

            <Link className="button button--dark" href={primary.href} data-reveal>
              {primary.label}
            </Link>
          </div>
        </section>

        {/* ---------------------------------------------------------- path */}
        <section className="path surface surface--ink" id="path">
          <div className="shell path__grid">
            <div className="path__copy" data-reveal>
              <p className="eyebrow">Путь и прогресс</p>
              <h2 className="display display--section">100 уровней. Но только один следующий шаг.</h2>
              <p className="lead">
                20 модулей превращают масштаб в карту: завершённое остаётся позади, текущий
                уровень получает фокус, будущее открывается последовательно.
              </p>

              <dl className="path-facts">
                <div>
                  <dt>Структура</dt>
                  <dd>20 модулей / 100 уровней</dd>
                </div>
                <div>
                  <dt>Переход</dt>
                  <dd>После подтверждённого завершения текущего уровня</dd>
                </div>
                <div>
                  <dt>Пропуск</dt>
                  <dd>Последовательность обязательна</dd>
                </div>
                <div>
                  <dt>XP</dt>
                  <dd>Мотивирует, но не открывает следующий уровень</dd>
                </div>
              </dl>
            </div>

            <div
              className="path-map"
              data-reveal
              role="img"
              aria-label="Схема из двадцати модулей и ста последовательных уровней"
            >
              <div className="path-map__status">
                <span>Текущий сегмент</span>
                <strong>Модуль 01</strong>
              </div>
              <div className="path-map__current">
                <span className="is-complete">L1</span>
                <span className="is-complete">L2</span>
                <span className="is-current">L3</span>
                <span>L4</span>
                <span>L5</span>
              </div>
              <div className="path-map__modules" aria-hidden="true">
                <i className="is-active" />
                {Array.from({ length: 19 }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
              <div className="path-map__scale">
                <span>01</span>
                <span>20 модулей</span>
                <span>100</span>
              </div>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- tools */}
        <section className="tools surface surface--signal" id="tools">
          <div className="shell">
            <div className="tools__heading" data-reveal>
              <div>
                <p className="eyebrow eyebrow--dark">Инструменты · по мере готовности</p>
                <h2 className="display display--section">
                  Инструмент появляется в контексте задачи.
                </h2>
              </div>
              <p className="lead">
                Не витрина из будущих функций. На Home показываем только два подтверждённых
                примера.
              </p>
            </div>

            <div className="tool-grid">
              <article className="tool-card" data-reveal>
                <div className="tool-card__meta">
                  <span>Открывается на L10</span>
                  <strong>01</strong>
                </div>
                <div className="asset-slot asset-slot--tool">
                  <p className="micro-label">Ожидает утверждённый скриншот</p>
                </div>
                <h3>Trading Journal</h3>
                <p>
                  Помогает сохранять контекст решений и превращать опыт в материал для обучения.
                </p>
              </article>

              <article className="tool-card" data-reveal>
                <div className="tool-card__meta">
                  <span>Открывается на L15</span>
                  <strong>02</strong>
                </div>
                <div className="asset-slot asset-slot--tool asset-slot--calculator">
                  <p className="micro-label">Ожидает утверждённый скриншот</p>
                </div>
                <h3>Risk Calculator</h3>
                <p>
                  Помогает связать размер риска с конкретным сценарием и заранее заданными
                  условиями.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- fit */}
        <section className="fit surface surface--signal surface--signal-deep" id="fit">
          <div className="shell">
            <div className="section-intro section-intro--wide" data-reveal>
              <p className="eyebrow eyebrow--dark">Подходит ли вам ATA</p>
              <h2 className="display display--section">
                Право сказать «не сейчас» тоже создаёт доверие.
              </h2>
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

        {/* ---------------------------------------------------- boundaries */}
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

        {/* ----------------------------------------------------------- faq */}
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
              <details>
                <summary>С чего начинается путь?</summary>
                <p>
                  С создания аккаунта ATA и первого уровня, связанного с подготовкой внешней
                  торговой среды.
                </p>
              </details>
              <details>
                <summary>Нужен ли опыт в трейдинге?</summary>
                <p>
                  Нет. ATA рассчитана на непрофессиональных пользователей и строит путь
                  последовательно.
                </p>
              </details>
              <details>
                <summary>Когда начинается практика?</summary>
                <p>Первая практическая работа и отчёт появляются уже на уровне L3.</p>
              </details>
              <details>
                <summary>Что происходит, если не пройти проверку знаний?</summary>
                <p>Проверку можно пройти повторно. Для её завершения требуется результат 100%.</p>
              </details>
              <details>
                <summary>Кто проверяет практические работы?</summary>
                <p>
                  На предусмотренных уровнях работу проверяет человек. При необходимости
                  пользователь исправляет её и отправляет повторно.
                </p>
              </details>
              <details>
                <summary>Можно ли пропустить уровень?</summary>
                <p>
                  Нет. Путь последовательный: следующий уровень открывается после выполнения
                  условий текущего.
                </p>
              </details>
              <details>
                <summary>Что такое контрольная точка?</summary>
                <p>
                  Это отдельный уровень, который проверяет выполнение определённого условия через
                  доступные авторитетные данные.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- final cta */}
        <section className="final-cta surface surface--ink" id="start">
          <div className="shell final-cta__grid" data-reveal>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/ata-logo.svg" alt="Alfa Trade Academy" width={362} height={200} />
            <div>
              <p className="eyebrow">Первый шаг</p>
              <h2 className="display display--section">
                Если вам нужен не ещё один источник информации, а понятный путь — начните с
                первого уровня.
              </h2>
            </div>
            <div className="final-cta__action">
              <p>После регистрации вы попадёте в Academy и увидите свой первый шаг.</p>
              <div className="final-cta__buttons">
                <Link className="button button--signal" href={primary.href}>
                  {primary.label}
                </Link>
                {authenticated ? null : (
                  <Link className="client-entry" href="/login">
                    Уже клиент? <strong>Войти</strong>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell site-footer__grid">
          <p>© <span data-year>{new Date().getFullYear()}</span> Alfa Trade Academy</p>
          <p>Обучение и прохождение ATA не гарантируют финансовый результат.</p>
          <nav aria-label="Юридическая информация">
            <span>Конфиденциальность</span>
            <span>Условия</span>
            <span>Риски</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
