/** Metadata for the three D1A art directions (used by the /concepts board). */
export interface ConceptEntry {
  id: string;
  name: string;
  idea: string;
  href: string;
}

export const CONCEPTS: ConceptEntry[] = [
  {
    id: "product-portal",
    name: "Product Portal",
    idea: "Премиальный пространственный центр прогресса. Текущий шаг — центральный объект, путь ощущается как портал в следующие этапы.",
    href: "/concepts/product-portal",
  },
  {
    id: "market-atlas",
    name: "Market Atlas",
    idea: "Прогресс как профессиональная карта рынка и навыков. Горизонтальный путь — главный структурный объект; инструменты как рабочие capabilities.",
    href: "/concepts/market-atlas",
  },
  {
    id: "editorial-academy",
    name: "Editorial Academy",
    idea: "Спокойная премиальная образовательная среда: урок, эксперт и ясный следующий шаг. Сильная типографика, больше воздуха, Alex заметнее.",
    href: "/concepts/editorial-academy",
  },
];
