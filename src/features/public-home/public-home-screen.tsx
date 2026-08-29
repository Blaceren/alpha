import Link from "next/link";

/**
 * Public Home surface — the marketing entry at `/`.
 *
 * TRANSLATED, NOT COPIED. The accepted design authority
 * (ATA-Integration 560a0f30…, surfaces/public-home/) is a static HTML/CSS
 * prototype whose CTAs point at a sibling `authenticated-home/index.html` file.
 * Here the structure, copy and section order are preserved and the destinations
 * are rebound to real product routes.
 *
 * IT HAS ITS OWN SKIP LINK AND ITS OWN `<main>`. Every authenticated surface
 * gets both from `AppShell`; this surface is deliberately outside that shell —
 * the design keeps Public Home on a separate header family — so it carries them
 * itself. There is exactly one of each on the page, and no `AppShell` skip link
 * can reach here to duplicate them.
 *
 * IT READS NO LEARNER DATA. The only thing it knows about the visitor is
 * whether a session exists, and the only thing that changes is which primary
 * call to action is offered. No name, no progress, no notification, no balance.
 */
export function PublicHomeScreen({ authenticated }: { authenticated: boolean }) {
  /**
   * The one behavioural difference between the two audiences.
   *
   * Signed out, the page's job is to invite a first level. Signed in, inviting
   * an existing learner to "начать путь" would be nonsense — and worse, would
   * push them toward registering a second account — so the same button becomes
   * the way back into the Academy.
   */
  const primaryCta = authenticated
    ? { href: "/home", label: "Перейти в Академию" }
    : { href: "/register", label: "Начать путь" };

  return (
    <div className="ph">
      <a href="#main" className="ph-skip">
        Перейти к содержимому
      </a>

      <header className="ph-header">
        <Link href="/" className="ph-wordmark" aria-label="Alfa Trade Academy — на главную">
          <span className="ph-wordmark__mark" aria-hidden="true" />
          Alfa Trade Academy
        </Link>

        <nav className="ph-nav" aria-label="Основная навигация">
          <a href="#mechanism">Как это работает</a>
          <a href="#path">Путь</a>
          <a href="#review">Практика и обратная связь</a>
          <a href="#tools">Инструменты</a>
          <a href="#faq">Вопросы</a>
        </nav>

        <div className="ph-header__actions">
          {authenticated ? null : (
            <Link href="/login" className="ph-button ph-button--quiet">
              Войти
            </Link>
          )}
          <Link href={primaryCta.href} className="ph-button ph-button--signal ph-button--small">
            {primaryCta.label}
          </Link>
        </div>
      </header>

      <main id="main" className="ph-main">
        <section id="top" className="ph-section ph-section--ink ph-hero">
          <h1 className="ph-display ph-display--hero">
            Не ещё один источник информации о трейдинге. Система, где знание
            превращается в действие, проверку, обратную связь и следующий шаг.
          </h1>
          <Link href={primaryCta.href} className="ph-button ph-button--signal">
            {primaryCta.label}
          </Link>
        </section>

        <section id="recognition" className="ph-section ph-section--signal">
          <h2 className="ph-display">Информации много. Системы — мало.</h2>
          <h3 className="ph-sub">Один понятный следующий шаг</h3>
        </section>

        <section id="mechanism" className="ph-section ph-section--ink">
          <h2 className="ph-display">Путь, в котором каждый шаг должен что-то изменить.</h2>
          <ol className="ph-steps">
            <li><h3>Понять</h3></li>
            <li><h3>Проверить себя</h3></li>
            <li><h3>Применить</h3></li>
            <li><h3>Получить разбор</h3></li>
            <li><h3>Исправить</h3></li>
            <li><h3>Двигаться дальше</h3></li>
          </ol>
        </section>

        <section id="product" className="ph-section ph-section--signal ph-section--signal-deep">
          <h2 className="ph-display">Не витрина контента. Последовательная работа.</h2>
          <h3 className="ph-sub">Главный экран Academy</h3>
        </section>

        <section id="review" className="ph-section ph-section--ink">
          <h2 className="ph-display">Посмотрел — не значит освоил.</h2>
          <ol className="ph-steps ph-steps--review">
            <li><h3>Работа отправлена</h3></li>
            <li><h3>Работа проверена</h3></li>
            <li><h3>Замечания исправлены</h3></li>
            <li><h3>Работа принята</h3></li>
          </ol>
        </section>

        <section id="first-journey" className="ph-section ph-section--signal">
          <h2 className="ph-display">Первые уровни быстро приводят к практике.</h2>
          <ol className="ph-steps">
            <li><h3>Создать аккаунт</h3></li>
            <li><h3>Подготовить среду</h3></li>
            <li><h3>Понять устройство ATA</h3></li>
            <li><h3>Выполнить практику</h3></li>
            <li><h3>Получить разбор</h3></li>
          </ol>
          <Link href={primaryCta.href} className="ph-button ph-button--dark">
            {primaryCta.label}
          </Link>
        </section>

        <section id="path" className="ph-section ph-section--ink">
          <h2 className="ph-display">100 уровней. Но только один следующий шаг.</h2>
        </section>

        <section id="tools" className="ph-section ph-section--signal">
          <h2 className="ph-display">Инструмент появляется в контексте задачи.</h2>
          <h3 className="ph-sub">Trading Journal</h3>
          <h3 className="ph-sub">Risk Calculator</h3>
        </section>

        <section id="fit" className="ph-section ph-section--signal ph-section--signal-deep">
          <h2 className="ph-display">Право сказать «не сейчас» тоже создаёт доверие.</h2>
          <h3 className="ph-sub">Хотите выстроить собственное понимание.</h3>
          <h3 className="ph-sub">Ищете быстрый или гарантированный результат.</h3>
        </section>

        <section id="boundaries" className="ph-section ph-section--ink">
          <h2 className="ph-display">Образовательная система для развития самостоятельности.</h2>
        </section>

        <section id="faq" className="ph-section ph-section--paper">
          <h2 className="ph-display">До начала пути не должно оставаться скрытых условий.</h2>
        </section>

        <section id="start" className="ph-section ph-section--ink ph-final">
          <h2 className="ph-display">
            Если вам нужен не ещё один источник информации, а понятный путь —
            начните с первого уровня.
          </h2>
          <Link href={primaryCta.href} className="ph-button ph-button--signal">
            {primaryCta.label}
          </Link>
          {authenticated ? null : (
            <Link href="/login" className="ph-client-entry">
              Уже клиент? Войти
            </Link>
          )}
        </section>
      </main>

      <footer className="ph-footer">
        <nav aria-label="Юридическая информация">
          <span className="ph-footer__note">
            Образовательная платформа. Не инвестиционная рекомендация.
          </span>
        </nav>
      </footer>
    </div>
  );
}
