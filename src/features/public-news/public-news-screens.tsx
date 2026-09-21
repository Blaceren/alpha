import Link from "next/link";
import { LocalReleaseTime } from "./local-release-time";
import { Importance, NewsDays, OtherNews, PublicNewsFooter, PublicNewsHeader } from "./public-news-parts";
import { NEWS_LIST_PATH, inlineJson, type PublicNewsItemView, type PublicNewsListAnswer } from "./public-news-model";

/**
 * NEWS — the two public pages: the list (`/news`) and one news page
 * (`/news/<slug>`). Server components; the only script is the reader's clock.
 *
 * WHAT A PAGE SAYS. Every published release, what it is, when it comes out,
 * what is expected and what came out — and, for a trader, why it matters. The
 * Academy's modules on news (L26–L29) teach how to read exactly this, which is
 * the one sentence of promotion on the page.
 */

export function NewsListScreen({ answer, authenticated }: { answer: PublicNewsListAnswer; authenticated: boolean }) {
  const { upcoming, past, page, pageCount } = answer;
  const empty = upcoming.length === 0 && past.length === 0;
  return (
    <div className="ph pn">
      <a className="skip-link" href="#main">
        Перейти к содержанию
      </a>
      <PublicNewsHeader authenticated={authenticated} current="list" />
      <main id="main" className="pn-main">
        <section className="surface surface--paper pn-hero" aria-labelledby="pn-title">
          <div className="shell">
            <p className="eyebrow eyebrow--dark">Экономический календарь</p>
            <h1 className="display pn-hero__title" id="pn-title">
              Новости рынка
            </h1>
            <p className="lead pn-hero__lead">
              Выходы экономических данных, которые двигают валюты: когда, что ожидают, что вышло — и что это значит для
              сделки.
            </p>
            <p className="pn-hero__note">Время — по UTC; на странице новости — и по вашим часам.</p>
          </div>
        </section>

        {empty ? (
          <section className="shell pn-empty">
            <h2 className="pn-section-title">Новостей пока нет</h2>
            <p>Редакция добавляет выходы данных по мере календаря. Загляните позже.</p>
          </section>
        ) : null}

        {upcoming.length > 0 ? (
          <section className="shell pn-section" aria-labelledby="pn-upcoming">
            <h2 className="pn-section-title" id="pn-upcoming">
              Ближайшие
            </h2>
            <NewsDays items={upcoming} upcoming headingLevel="h3" />
          </section>
        ) : null}

        {past.length > 0 ? (
          <section className="shell pn-section" aria-labelledby="pn-past">
            <h2 className="pn-section-title" id="pn-past">
              {page === 1 ? "Прошедшие" : `Прошедшие · страница ${page}`}
            </h2>
            <NewsDays items={past} upcoming={false} headingLevel="h3" />
          </section>
        ) : null}

        {pageCount > 1 ? (
          <nav className="shell pn-pages" aria-label="Страницы новостей">
            {page > 1 ? (
              <Link className="button button--small pn-pages__link" rel="prev" href={page === 2 ? NEWS_LIST_PATH : `${NEWS_LIST_PATH}?page=${page - 1}`}>
                ← Новее
              </Link>
            ) : (
              <span />
            )}
            <span className="pn-pages__where">
              Страница {page} из {pageCount}
            </span>
            {page < pageCount ? (
              <Link className="button button--small pn-pages__link" rel="next" href={`${NEWS_LIST_PATH}?page=${page + 1}`}>
                Старее →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}

        <AcademyInvitation authenticated={authenticated} />
      </main>
      <PublicNewsFooter />
    </div>
  );
}

export function NewsItemScreen({
  answer,
  authenticated,
  jsonLd,
}: {
  answer: PublicNewsItemView;
  authenticated: boolean;
  jsonLd: object | null;
}) {
  const { item, others, released } = answer;
  const figures: [string, string | null, string][] = [
    ["Прогноз", item.forecast, "—"],
    ["Предыдущее", item.previous, "—"],
    ["Факт", item.actual, released ? "—" : "ожидается"],
  ];
  return (
    <div className="ph pn">
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: inlineJson(jsonLd) }} /> : null}
      <a className="skip-link" href="#main">
        Перейти к содержанию
      </a>
      <PublicNewsHeader authenticated={authenticated} current="item" />
      <main id="main" className="pn-main">
        <article className="surface surface--paper pn-article" aria-labelledby="pn-article-title">
          <div className="shell pn-article__inner">
            <nav className="pn-crumbs" aria-label="Вы здесь">
              <Link href={NEWS_LIST_PATH}>Новости</Link>
              <span aria-hidden="true"> / </span>
              <span>{item.countryLabel}</span>
            </nav>
            <p className="pn-meta">
              <span className="pn-cur">{item.currency}</span>
              <span>{item.countryLabel}</span>
              <Importance value={item.importance} />
            </p>
            <h1 className="display pn-article__title" id="pn-article-title">
              {item.title}
            </h1>
            <p className="pn-release">
              <span className="pn-release__label">Выход данных:</span> <LocalReleaseTime iso={item.releaseAt} variant="full" />
            </p>
            <dl className="pn-figures">
              {figures.map(([label, value, missing]) => (
                <div key={label} className="pn-figure" data-empty={value === null || undefined}>
                  <dt>{label}</dt>
                  <dd>{value ?? missing}</dd>
                </div>
              ))}
            </dl>
            <p className="lead pn-article__lead">{item.summary}</p>
            {item.paragraphs.length > 0 ? (
              <div className="pn-article__body">
                {item.paragraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            ) : null}
            {item.source ? (
              <p className="pn-source">
                Источник:{" "}
                <a href={item.source.url} rel="nofollow noopener noreferrer" target="_blank">
                  {item.source.name}
                </a>
              </p>
            ) : null}
          </div>
        </article>

        <AcademyInvitation authenticated={authenticated} />
        <OtherNews items={others} />
      </main>
      <PublicNewsFooter />
    </div>
  );
}

/** The one invitation: what the Academy teaches about news, and the way in. */
function AcademyInvitation({ authenticated }: { authenticated: boolean }) {
  return (
    <aside className="surface surface--ink pn-invite" aria-labelledby="pn-invite-title">
      <div className="shell pn-invite__inner">
        <div>
          <p className="eyebrow">Модуль «Новости» · уровни 26–30</p>
          <h2 className="pn-invite__title" id="pn-invite-title">
            Решение о торговле на новости принимается до её выхода
          </h2>
          <p className="pn-invite__text">
            В Alfa Trade Academy это отдельный модуль: экономический календарь, реакция цены, когда не торговать и ваш план
            вокруг новостей. На уровне 30 открывается News Calendar — он показывает, когда ваш план закрывает вход.
          </p>
        </div>
        {authenticated ? (
          <Link className="button button--signal" href="/tools/news">
            Открыть News Calendar
          </Link>
        ) : (
          <Link className="button button--signal" href="/register">
            Начать путь
          </Link>
        )}
      </div>
    </aside>
  );
}
