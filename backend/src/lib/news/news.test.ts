import { describe, expect, it } from "vitest";
import { NewsError, parseNewsInput, toCrmNewsDto, toNewsEventDto, toPublicNewsDto, type NewsRow } from "./news";
import { newsReference } from "./reference";
import { SLUG_RE, newsSlugBase, transliterate, uniqueSlug } from "./slug";
import { instantToZonedWallTime, isValidTimeZone, zonedWallTimeToInstant } from "./zoned-time";

const NOW = new Date("2026-09-21T12:00:00.000Z");

/** The presentation's release: USD · Базовый ИПЦ м/м, 14:30 in Warsaw (UTC+2 in September). */
function form(overrides: Record<string, unknown> = {}) {
  return {
    title: "Базовый индекс потребительских цен, м/м",
    summary: "Инфляция без еды и энергии за август: рынок ждёт 0.3% после 0.2% месяцем раньше.",
    body: "Базовый ИПЦ показывает устойчивую инфляцию.\n\nПервое движение после публикации часто ложное.",
    country: "US",
    importance: 3,
    releaseDate: "2026-09-21",
    releaseTime: "14:30",
    timeZone: "Europe/Warsaw",
    forecast: "0.3%",
    previous: "0.2%",
    actual: "",
    sourceName: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/cpi/",
    ...overrides,
  };
}

function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof NewsError) return error.detail;
    throw error;
  }
}

describe("time zones", () => {
  it("reads a wall time in a zone as one instant, summer time included", () => {
    expect(new Date(zonedWallTimeToInstant("2026-09-21", "14:30", "Europe/Warsaw")!).toISOString()).toBe(
      "2026-09-21T12:30:00.000Z",
    );
    expect(new Date(zonedWallTimeToInstant("2026-12-21", "14:30", "Europe/Warsaw")!).toISOString()).toBe(
      "2026-12-21T13:30:00.000Z",
    );
    expect(new Date(zonedWallTimeToInstant("2026-09-21", "08:30", "America/New_York")!).toISOString()).toBe(
      "2026-09-21T12:30:00.000Z",
    );
    expect(new Date(zonedWallTimeToInstant("2026-09-21", "09:30", "Asia/Tokyo")!).toISOString()).toBe(
      "2026-09-21T00:30:00.000Z",
    );
  });

  it("refuses the hour summer time skips, and anything that is not a real date or zone", () => {
    // 29 March 2026: Warsaw jumps from 02:00 to 03:00.
    expect(zonedWallTimeToInstant("2026-03-29", "02:30", "Europe/Warsaw")).toBeNull();
    expect(zonedWallTimeToInstant("2026-02-30", "10:00", "Europe/Warsaw")).toBeNull();
    expect(zonedWallTimeToInstant("2026-09-21", "24:00", "Europe/Warsaw")).toBeNull();
    expect(zonedWallTimeToInstant("2026-09-21", "10:00", "Mars/Olympus")).toBeNull();
    expect(isValidTimeZone("Europe/Kyiv")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("../etc/passwd")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("shows an instant on a zone's clock", () => {
    expect(instantToZonedWallTime(Date.parse("2026-09-21T12:30:00Z"), "Europe/Moscow")).toEqual({
      date: "2026-09-21",
      time: "15:30",
    });
    expect(instantToZonedWallTime(Date.parse("2026-09-21T23:30:00Z"), "Asia/Tokyo")).toEqual({
      date: "2026-09-22",
      time: "08:30",
    });
  });
});

describe("the page address", () => {
  it("is Latin, hyphenated, and ends with the release date", () => {
    expect(transliterate("США · Базовый индекс потребительских цен, м/м")).toBe(
      "ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m",
    );
    const slug = newsSlugBase("США", "Базовый индекс потребительских цен, м/м", "2026-09-21");
    expect(slug).toBe("ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21");
    expect(SLUG_RE.test(slug)).toBe(true);
  });

  it("never splits a word, and stays inside the limit", () => {
    const slug = newsSlugBase("Еврозона", "Очень ".repeat(40) + "длинное название", "2026-09-21");
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-2026-09-21")).toBe(true);
    // Every word before the date is a whole word of the source.
    const words = slug.slice(0, -"-2026-09-21".length).split("-");
    expect(words.every((word) => ["evrozona", "ochen", "dlinnoe", "nazvanie"].includes(word))).toBe(true);
    expect(SLUG_RE.test(slug)).toBe(true);
  });

  it("takes the next free number when the address is taken", async () => {
    const taken = new Set(["a-2026-09-21", "a-2026-09-21-2"]);
    expect(await uniqueSlug("a-2026-09-21", async (slug) => taken.has(slug))).toBe("a-2026-09-21-3");
    expect(await uniqueSlug("b-2026-09-21", async (slug) => taken.has(slug))).toBe("b-2026-09-21");
  });
});

describe("the CRM form", () => {
  it("reads the presentation's release", () => {
    const input = parseNewsInput(form(), NOW);
    expect(input.releaseAt.toISOString()).toBe("2026-09-21T12:30:00.000Z");
    expect(input.country).toBe("US");
    expect(input.currency).toBe("USD");
    expect(input.importance).toBe(3);
    expect(input.forecast).toBe("0.3%");
    expect(input.actual).toBeNull();
    expect(input.sourceUrl).toBe("https://www.bls.gov/cpi/");
  });

  it("takes the currency from the country", () => {
    expect(parseNewsInput(form({ country: "DE" }), NOW).currency).toBe("EUR");
    expect(parseNewsInput(form({ country: "CN" }), NOW).currency).toBe("CNY");
  });

  it("keeps paragraphs and nothing else of the body's layout", () => {
    const input = parseNewsInput(form({ body: "  Первый\tабзац.\r\n\r\n\r\n\r\nВторой   абзац.  \r\n" }), NOW);
    expect(input.body).toBe("Первый абзац.\n\nВторой абзац.");
    expect(parseNewsInput(form({ body: "" }), NOW).body).toBe("");
  });

  it("collapses a pasted line break inside a one-line field", () => {
    expect(parseNewsInput(form({ title: "Базовый ИПЦ,\n м/м" }), NOW).title).toBe("Базовый ИПЦ, м/м");
  });

  it("names the field it refuses", () => {
    expect(refusal(() => parseNewsInput(form({ title: "ИП" }), NOW))).toBe("invalid_title");
    expect(refusal(() => parseNewsInput(form({ summary: "Коротко." }), NOW))).toBe("invalid_summary");
    expect(refusal(() => parseNewsInput(form({ country: "RU" }), NOW))).toBe("invalid_country");
    expect(refusal(() => parseNewsInput(form({ importance: 4 }), NOW))).toBe("invalid_importance");
    expect(refusal(() => parseNewsInput(form({ importance: "3" }), NOW))).toBe("invalid_importance");
    expect(refusal(() => parseNewsInput(form({ timeZone: "Warsaw" }), NOW))).toBe("invalid_time_zone");
    expect(refusal(() => parseNewsInput(form({ releaseDate: "2026-03-29", releaseTime: "02:30" }), NOW))).toBe(
      "invalid_release",
    );
    expect(refusal(() => parseNewsInput(form({ releaseDate: "2019-12-31" }), NOW))).toBe("invalid_release");
    expect(refusal(() => parseNewsInput(form({ releaseDate: "2027-12-31" }), NOW))).toBe("invalid_release");
    expect(refusal(() => parseNewsInput(form({ forecast: "0.3% ".repeat(10) }), NOW))).toBe("invalid_forecast");
    expect(refusal(() => parseNewsInput(form({ body: "x".repeat(20_001) }), NOW))).toBe("invalid_body");
    expect(refusal(() => parseNewsInput(form({ title: "Base\u202eCPI" }), NOW))).toBe("invalid_title");
    expect(refusal(() => parseNewsInput(null, NOW))).toBe("invalid_item");
  });

  it("accepts a source only as a name with an https address", () => {
    expect(parseNewsInput(form({ sourceName: "", sourceUrl: "" }), NOW).sourceName).toBeNull();
    expect(refusal(() => parseNewsInput(form({ sourceUrl: "" }), NOW))).toBe("invalid_source_url");
    expect(refusal(() => parseNewsInput(form({ sourceName: "" }), NOW))).toBe("invalid_source_name");
    expect(refusal(() => parseNewsInput(form({ sourceUrl: "http://www.bls.gov/" }), NOW))).toBe("invalid_source_url");
    expect(refusal(() => parseNewsInput(form({ sourceUrl: "javascript:alert(1)" }), NOW))).toBe("invalid_source_url");
    expect(refusal(() => parseNewsInput(form({ sourceUrl: "https://user:pw@bls.gov/" }), NOW))).toBe(
      "invalid_source_url",
    );
  });
});

describe("what each audience is sent", () => {
  const row: NewsRow = {
    id: "clnews0000000000000000001",
    slug: "ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21",
    title: "Базовый индекс потребительских цен, м/м",
    summary: "Инфляция без еды и энергии за август.",
    body: "Первый абзац.\n\nВторой абзац.",
    country: "US",
    currency: "USD",
    importance: 3,
    releaseAt: new Date("2026-09-21T12:30:00.000Z"),
    forecast: "0.3%",
    previous: "0.2%",
    actual: null,
    sourceName: null,
    sourceUrl: null,
    status: "published",
    publishedAt: new Date("2026-09-20T09:00:00.000Z"),
    firstPublishedAt: new Date("2026-09-19T09:00:00.000Z"),
    createdAt: new Date("2026-09-18T09:00:00.000Z"),
    updatedAt: new Date("2026-09-20T09:00:00.000Z"),
  };

  it("gives the public page no id, no status and no staff", () => {
    const dto = toPublicNewsDto(row);
    expect(dto).not.toHaveProperty("id");
    expect(dto).not.toHaveProperty("status");
    expect(JSON.stringify(dto)).not.toMatch(/createdBy|updatedBy|staff/i);
    expect(dto.paragraphs).toEqual(["Первый абзац.", "Второй абзац."]);
    expect(dto.countryLabel).toBe("США");
    expect(dto.publishedAt).toBe("2026-09-19T09:00:00.000Z");
  });

  it("gives the calendar a row", () => {
    expect(toNewsEventDto(row)).toEqual({
      slug: row.slug,
      title: row.title,
      country: "US",
      countryLabel: "США",
      currency: "USD",
      importance: 3,
      releaseAt: "2026-09-21T12:30:00.000Z",
      forecast: "0.3%",
      previous: "0.2%",
      actual: null,
    });
  });

  it("gives the CRM the public address only while published", () => {
    expect(toCrmNewsDto(row, "https://alfatrade.media").publicUrl).toBe(`https://alfatrade.media/news/${row.slug}`);
    expect(toCrmNewsDto({ ...row, status: "draft", publishedAt: null }, "https://alfatrade.media").publicUrl).toBeNull();
    expect(toCrmNewsDto(row, null).publicUrl).toBeNull();
    expect(toCrmNewsDto(row, null).slugLocked).toBe(true);
  });

  it("offers the lists the form is written from", () => {
    const reference = newsReference();
    expect(reference.countries.map((country) => country.code)).toContain("EA");
    expect(reference.importance.map((level) => level.value)).toEqual([1, 2, 3]);
  });
});
