import { describe, expect, it } from "vitest";
import type { NewsItem } from "@/data/contracts/api/news";
import {
  checkNewsForm,
  emptyNewsForm,
  fieldForRefusal,
  formFromItem,
  importanceDots,
  instantToZonedWallTime,
  isFormChanged,
  newsItemPath,
  releaseWords,
  zoneLabel,
  zonedWallTimeToInstant,
} from "./news-model";

const ITEM: NewsItem = {
  id: "clnews0000000000000000001",
  slug: "ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21",
  title: "Базовый индекс потребительских цен, м/м",
  summary: "Инфляция без еды и энергии за август: рынок ждёт 0.3%.",
  body: "Первый абзац.\n\nВторой абзац.",
  country: "US",
  countryLabel: "США",
  currency: "USD",
  importance: 3,
  releaseAt: "2026-09-21T12:30:00.000Z",
  forecast: "0.3%",
  previous: "0.2%",
  actual: null,
  sourceName: null,
  sourceUrl: null,
  status: "draft",
  slugLocked: false,
  publishedAt: null,
  publicUrl: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
};

describe("the release on a clock", () => {
  it("turns a wall time in a zone into the instant the backend will store", () => {
    expect(new Date(zonedWallTimeToInstant("2026-09-21", "14:30", "Europe/Warsaw")!).toISOString()).toBe(
      "2026-09-21T12:30:00.000Z",
    );
    expect(new Date(zonedWallTimeToInstant("2026-12-21", "14:30", "Europe/Warsaw")!).toISOString()).toBe(
      "2026-12-21T13:30:00.000Z",
    );
    expect(zonedWallTimeToInstant("2026-03-29", "02:30", "Europe/Warsaw")).toBeNull();
    expect(zonedWallTimeToInstant("2026-02-30", "10:00", "UTC")).toBeNull();
  });

  it("shows an instant on another zone's clock", () => {
    expect(instantToZonedWallTime(Date.parse("2026-09-21T12:30:00Z"), "Europe/Moscow")).toEqual({
      date: "2026-09-21",
      time: "15:30",
    });
  });

  it("names a zone with its offset at that moment", () => {
    expect(zoneLabel("Europe/Warsaw", Date.parse("2026-09-21T12:00:00Z"))).toBe("Варшава · UTC+2");
    expect(zoneLabel("Europe/Warsaw", Date.parse("2026-12-21T12:00:00Z"))).toBe("Варшава · UTC+1");
    expect(zoneLabel("Europe/London", Date.parse("2026-12-21T12:00:00Z"))).toBe("Лондон · UTC+0");
    expect(zoneLabel("UTC")).toBe("UTC");
  });

  it("writes a release for a list row", () => {
    expect(releaseWords(ITEM.releaseAt, "Europe/Warsaw")).toMatch(/^21 сент\.?, 14:30$/);
  });
});

describe("the form", () => {
  it("shows a saved item on the chosen zone's clock", () => {
    const form = formFromItem(ITEM, "Europe/Warsaw");
    expect(form.releaseDate).toBe("2026-09-21");
    expect(form.releaseTime).toBe("14:30");
    expect(form.actual).toBe("");
    expect(isFormChanged(form, ITEM)).toBe(false);
    expect(isFormChanged({ ...form, timeZone: "Europe/Moscow", releaseTime: "15:30" }, ITEM)).toBe(false);
    expect(isFormChanged({ ...form, actual: "0.4%" }, ITEM)).toBe(true);
    expect(isFormChanged({ ...form, title: `${form.title} ` }, ITEM)).toBe(false);
  });

  it("names what must be fixed before saving", () => {
    const blank = emptyNewsForm("Europe/Warsaw", "2026-09-21");
    const errors = checkNewsForm(blank);
    expect(Object.keys(errors)).toEqual(["release", "title", "summary"]);
    const ok = { ...formFromItem(ITEM, "Europe/Warsaw") };
    expect(checkNewsForm(ok)).toEqual({});
    expect(checkNewsForm({ ...ok, releaseDate: "2026-03-29", releaseTime: "02:30" }).release).toMatch(/переводят часы/);
    expect(checkNewsForm({ ...ok, sourceName: "BLS" }).sourceUrl).toBeDefined();
    expect(checkNewsForm({ ...ok, sourceName: "BLS", sourceUrl: "http://bls.gov" }).sourceUrl).toMatch(/https/);
    expect(checkNewsForm({ ...ok, forecast: "0.3% ".repeat(10) }).forecast).toBeDefined();
  });

  it("points a backend refusal at its field", () => {
    expect(fieldForRefusal("invalid_title").field).toBe("title");
    expect(fieldForRefusal("invalid_release").field).toBe("release");
    expect(fieldForRefusal("invalid_source_url").field).toBe("sourceUrl");
    expect(fieldForRefusal("body_too_large").field).toBe("body");
    expect(fieldForRefusal("something_else").field).toBeNull();
    expect(fieldForRefusal(null).field).toBeNull();
  });

  it("draws importance and addresses", () => {
    expect(importanceDots(3)).toBe("●●●");
    expect(importanceDots(1)).toBe("●");
    expect(newsItemPath("abc")).toBe("/news/abc");
  });
});
