/**
 * NEWS — the lists a news item is written from, kept by us (owner, 2026-09-21).
 *
 * A news item is an economic release on the calendar: when, which country and
 * currency, how important, forecast, previous and actual (lesson L26). The
 * currencies are those of the assets the learners trade (`tools/reference.ts`),
 * plus China, whose releases move AUD and NZD. The country decides the
 * currency: German data is EUR news.
 */

export type NewsCountry = {
  readonly code: string;
  readonly label: string;
  readonly currency: string;
};

export const NEWS_COUNTRIES = [
  { code: "US", label: "США", currency: "USD" },
  { code: "EA", label: "Еврозона", currency: "EUR" },
  { code: "DE", label: "Германия", currency: "EUR" },
  { code: "FR", label: "Франция", currency: "EUR" },
  { code: "IT", label: "Италия", currency: "EUR" },
  { code: "ES", label: "Испания", currency: "EUR" },
  { code: "GB", label: "Великобритания", currency: "GBP" },
  { code: "JP", label: "Япония", currency: "JPY" },
  { code: "CH", label: "Швейцария", currency: "CHF" },
  { code: "CA", label: "Канада", currency: "CAD" },
  { code: "AU", label: "Австралия", currency: "AUD" },
  { code: "NZ", label: "Новая Зеландия", currency: "NZD" },
  { code: "CN", label: "Китай", currency: "CNY" },
] as const satisfies readonly NewsCountry[];

export const NEWS_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"] as const;
export type NewsCurrency = (typeof NEWS_CURRENCIES)[number];

/** Importance as the calendar marks it: ● low, ●● medium, ●●● high. */
export const NEWS_IMPORTANCE = [
  { value: 1, label: "Низкая" },
  { value: 2, label: "Средняя" },
  { value: 3, label: "Высокая" },
] as const;

export function newsCountryByCode(code: string): NewsCountry | null {
  return NEWS_COUNTRIES.find((country) => country.code === code) ?? null;
}

export function isNewsCurrency(code: string): code is NewsCurrency {
  return (NEWS_CURRENCIES as readonly string[]).includes(code);
}

/** What a form needs to offer the lists above. */
export function newsReference() {
  return {
    countries: NEWS_COUNTRIES.map(({ code, label, currency }) => ({ code, label, currency })),
    currencies: [...NEWS_CURRENCIES],
    importance: NEWS_IMPORTANCE.map(({ value, label }) => ({ value, label })),
  };
}
