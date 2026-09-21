import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  groupByDay,
  inlineJson,
  isPublicNewsItemAnswer,
  isPublicNewsListAnswer,
  newsArticleJsonLd,
  parseNewsPage,
  releaseDayWords,
  releaseTimeUtc,
  type PublicNewsItemAnswer,
  type PublicNewsListAnswer,
} from "./public-news-model";
import { NewsItemScreen, NewsListScreen } from "./public-news-screens";

function event(slug: string, releaseAt: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    title: "Базовый индекс потребительских цен, м/м",
    country: "US",
    countryLabel: "США",
    currency: "USD",
    importance: 3,
    releaseAt,
    forecast: "0.3%",
    previous: "0.2%",
    actual: null,
    ...overrides,
  };
}

const LIST: PublicNewsListAnswer = {
  upcoming: [{ ...event("ssha-ipts-2026-09-22", "2026-09-22T12:30:00.000Z"), summary: "Инфляция без еды и энергии." }],
  past: [
    { ...event("ssha-roznichnye-2026-09-21", "2026-09-21T12:30:00.000Z", { title: "Розничные продажи, м/м", actual: "0.4%" }), summary: "Потребитель." },
    { ...event("germaniya-pmi-2026-09-21", "2026-09-21T07:30:00.000Z", { currency: "EUR", countryLabel: "Германия", importance: 2 }), summary: "Деловая активность." },
  ],
  page: 1,
  pageCount: 2,
};

const ITEM: PublicNewsItemAnswer = {
  item: {
    ...event("ssha-bazovyy-ipts-2026-09-21", "2026-09-21T12:30:00.000Z"),
    summary: "Инфляция без еды и энергии за август: рынок ждёт 0.3% после 0.2% месяцем раньше.",
    paragraphs: ["Первый абзац.", "Второй абзац\nс переносом."],
    source: { name: "U.S. Bureau of Labor Statistics", url: "https://www.bls.gov/cpi/" },
    publishedAt: "2026-09-19T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
  },
  others: [event("ssha-roznichnye-2026-09-21", "2026-09-21T12:30:00.000Z", { title: "Розничные продажи, м/м" })],
};

describe("the public news model", () => {
  it("accepts what the Backend sends and nothing malformed", () => {
    expect(isPublicNewsListAnswer(LIST)).toBe(true);
    expect(isPublicNewsItemAnswer(ITEM)).toBe(true);
    expect(isPublicNewsItemAnswer({ ...ITEM, item: { ...ITEM.item, slug: "../etc" } })).toBe(false);
    expect(isPublicNewsItemAnswer({ ...ITEM, item: { ...ITEM.item, source: { name: "x", url: "javascript:alert(1)" } } })).toBe(false);
    expect(isPublicNewsListAnswer({ ...LIST, upcoming: [{ ...LIST.upcoming[0], importance: 7 }] })).toBe(false);
  });

  it("reads ?page as a whole number from one, and nothing else", () => {
    expect(parseNewsPage(undefined)).toBe(1);
    expect(parseNewsPage("2")).toBe(2);
    for (const raw of ["0", "-1", "1.5", "abc", "1001", ["1", "2"]]) expect(parseNewsPage(raw as string)).toBeNull();
  });

  it("writes a release in UTC and groups a list by day", () => {
    expect(releaseDayWords("2026-09-21T12:30:00.000Z")).toBe("21 сентября 2026");
    expect(releaseTimeUtc("2026-09-21T12:30:00.000Z")).toBe("12:30 UTC");
    const groups = groupByDay(LIST.past);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("21 сентября · понедельник");
  });

  it("escapes structured data so no text can close its script tag", () => {
    expect(inlineJson({ a: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    const json = newsArticleJsonLd(ITEM.item, "https://alfatrade.media/news/x", "https://alfatrade.media");
    expect(json).toMatchObject({ "@type": "NewsArticle", datePublished: ITEM.item.publishedAt, url: "https://alfatrade.media/news/x" });
    expect(JSON.stringify(json)).not.toMatch(/staff|createdBy/);
  });
});

describe("the public news pages", () => {
  it("lists what is coming, then what has been, each linking to its page", () => {
    render(<NewsListScreen answer={LIST} authenticated={false} />);
    expect(screen.getByRole("heading", { level: 1, name: "Новости рынка" })).toBeInTheDocument();
    const upcoming = screen.getByRole("heading", { name: "Ближайшие" }).closest("section")!;
    expect(within(upcoming).getByRole("link", { name: "Базовый индекс потребительских цен, м/м" })).toHaveAttribute(
      "href",
      "/news/ssha-ipts-2026-09-22",
    );
    const past = screen.getByRole("heading", { name: "Прошедшие" }).closest("section")!;
    expect(within(past).getAllByRole("listitem")).toHaveLength(2);
    expect(within(past).getByText("0.4%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Старее →" })).toHaveAttribute("href", "/news?page=2");
    for (const start of screen.getAllByRole("link", { name: "Начать путь" })) expect(start).toHaveAttribute("href", "/register");
  });

  it("gives a signed-in learner the way into the Academy instead of registration", () => {
    render(<NewsListScreen answer={LIST} authenticated />);
    expect(screen.getByRole("link", { name: "Перейти в Академию" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "Открыть News Calendar" })).toHaveAttribute("href", "/tools/news");
    expect(screen.queryByRole("link", { name: "Войти" })).toBeNull();
  });

  it("shows one article: its figures, its text in paragraphs, and its source outside the Academy", () => {
    const { container } = render(<NewsItemScreen answer={{ ...ITEM, released: false }} authenticated={false} jsonLd={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Базовый индекс потребительских цен, м/м" })).toBeInTheDocument();
    expect(screen.getByText("21 сентября 2026, 12:30 UTC")).toBeInTheDocument();
    const figures = container.querySelector(".pn-figures")!;
    expect(figures).toHaveTextContent("Прогноз0.3%");
    expect(figures).toHaveTextContent("Предыдущее0.2%");
    expect(figures).toHaveTextContent("Фактожидается");
    expect(container.querySelectorAll(".pn-article__body p")).toHaveLength(2);
    const source = screen.getByRole("link", { name: "U.S. Bureau of Labor Statistics" });
    expect(source).toHaveAttribute("rel", "nofollow noopener noreferrer");
    expect(source).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("heading", { name: "Другие новости" })).toBeInTheDocument();
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it("carries structured data only when it is given, escaped", () => {
    const jsonLd = newsArticleJsonLd({ ...ITEM.item, title: "</script>" }, "https://alfatrade.media/news/x", "https://alfatrade.media");
    const { container } = render(<NewsItemScreen answer={{ ...ITEM, released: true }} authenticated={false} jsonLd={jsonLd} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(script.innerHTML).not.toContain("</script>");
    expect(JSON.parse(script.innerHTML.replace(/\\u003c/g, "<")).headline).toContain("</script>");
  });
});
