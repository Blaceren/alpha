import Link from "next/link";
import { LocalReleaseTime } from "./local-release-time";
import {
  IMPORTANCE_WORDS,
  NEWS_LIST_PATH,
  groupByDay,
  importanceDots,
  newsPath,
  releaseTimeUtc,
  type PublicNewsEvent,
  type PublicNewsListItem,
} from "./public-news-model";

/**
 * NEWS — the public pages' shared parts: the header, the footer and a day of
 * releases. Server components: nothing here needs JavaScript except the
 * reader's own clock, which `LocalReleaseTime` adds after the page arrives.
 *
 * The visual system is Public Home's (Ink/Signal, the three vendored families,
 * the same radii and buttons), read from `public-home.css` under `.ph`; what is
 * news-specific lives under `.pn` in `public-news.css`.
 */

export function PublicNewsHeader({ authenticated, current }: { authenticated: boolean; current: "list" | "item" }) {
  return (
    <header className="pn-header">
      <div className="shell pn-header__inner">
        <Link className="wordmark" href="/" aria-label="Alfa Trade Academy — на главную">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ata-logo.svg" alt="" width={362} height={200} />
        </Link>
        <nav className="pn-header__nav" aria-label="Основная навигация">
          <Link href="/">Об Академии</Link>
          <Link href={NEWS_LIST_PATH} aria-current={current === "list" ? "page" : undefined}>
            Новости
          </Link>
        </nav>
        <div className="pn-header__actions">
          {authenticated ? (
            <Link className="button button--small button--signal" href="/home">
              Перейти в Академию
            </Link>
          ) : (
            <>
              <Link className="button button--login" href="/login">
                Войти
              </Link>
              <Link className="button button--small button--signal pn-header__start" href="/register">
                Начать путь
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicNewsFooter() {
  return (
    <footer className="site-footer pn-footer">
      <div className="shell site-footer__grid">
        <p>© {new Date().getFullYear()} Alfa Trade Academy</p>
        <p>Новости — учебный материал Академии: не торговый сигнал и не инвестиционная рекомендация.</p>
        <p className="site-footer__legal">Обучение и прохождение ATA не гарантируют финансовый результат.</p>
      </div>
    </footer>
  );
}

/** «●●● Высокая важность» for the eye, one phrase for a screen reader. */
export function Importance({ value }: { value: number }) {
  return (
    <span className="pn-imp" data-importance={value}>
      <span aria-hidden="true">{importanceDots(value)}</span>
      <span className="pn-sr">{IMPORTANCE_WORDS[value]}</span>
    </span>
  );
}

function Values({ event, upcoming }: { event: PublicNewsEvent; upcoming: boolean }) {
  const rows: [string, string | null][] = upcoming
    ? [
        ["Прогноз", event.forecast],
        ["Пред.", event.previous],
      ]
    : [
        ["Факт", event.actual],
        ["Прогноз", event.forecast],
      ];
  return (
    <dl className="pn-values">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One section of the list: days, and in each day its releases in order. */
export function NewsDays({
  items,
  upcoming,
  headingLevel,
}: {
  items: readonly PublicNewsListItem[];
  upcoming: boolean;
  headingLevel: "h2" | "h3";
}) {
  const Day = headingLevel;
  return (
    <div className="pn-days">
      {groupByDay(items).map((group) => (
        <section key={group.key} className="pn-day" aria-label={group.label}>
          <Day className="pn-day__label">{group.label}</Day>
          <ol className="pn-rows">
            {group.items.map((item) => (
              <li key={item.slug} className="pn-row" data-importance={item.importance}>
                <time className="pn-row__time" dateTime={item.releaseAt}>
                  {releaseTimeUtc(item.releaseAt).replace(" UTC", "")}
                </time>
                <span className="pn-cur" title={item.countryLabel}>
                  {item.currency}
                </span>
                <div className="pn-row__main">
                  <Link className="pn-row__title" href={newsPath(item.slug)}>
                    {item.title}
                  </Link>
                  <p className="pn-row__summary">
                    <span className="pn-row__country">{item.countryLabel}.</span> {item.summary}
                  </p>
                </div>
                <Importance value={item.importance} />
                <Values event={item} upcoming={upcoming} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** «Другие новости» under an article. */
export function OtherNews({ items }: { items: readonly PublicNewsEvent[] }) {
  if (items.length === 0) return null;
  return (
    <section className="shell pn-others" aria-labelledby="pn-others-title">
      <h2 className="pn-section-title" id="pn-others-title">
        Другие новости
      </h2>
      <ul className="pn-others__list">
        {items.map((item) => (
          <li key={item.slug}>
            <Link className="pn-others__link" href={newsPath(item.slug)}>
              <span className="pn-others__meta">
                <span className="pn-cur">{item.currency}</span>
                <LocalReleaseTime iso={item.releaseAt} variant="short" />
              </span>
              <span className="pn-others__title">{item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
