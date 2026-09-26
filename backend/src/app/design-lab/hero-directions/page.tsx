import type { Metadata } from "next";
import { HeroDirectionA } from "@/components/design-lab/HeroDirectionA";
import { HeroDirectionB } from "@/components/design-lab/HeroDirectionB";
import { HeroDirectionB2 } from "@/components/design-lab/HeroDirectionB2";
import { HeroDirectionC } from "@/components/design-lab/HeroDirectionC";
import { HeroDirectionC2 } from "@/components/design-lab/HeroDirectionC2";
import { HeroDirectionD } from "@/components/design-lab/HeroDirectionD";

export const metadata: Metadata = {
  title: "Design Lab · Hero Directions | TradeQuest",
  robots: { index: false, follow: false },
};

const directions = [
  {
    id: "dir-a",
    tag: "A · Editorial Premium",
    name: "«Тезис»",
    note: "Дорогая editorial-сцена: крупная типографика, воздух, линия дисциплины поверх рыночного графика.",
  },
  {
    id: "dir-b",
    tag: "B · Product Journey Map",
    name: "«Маршрут» — Original",
    note: "Главный визуал — путь трейдера: слева хаотичный график, справа уверенная система из шести шагов.",
  },
  {
    id: "dir-b2",
    tag: "B2 · Journey + Signal Field",
    name: "«Маршрут» — Signal Field",
    note: "Тот же маршрут «хаос → система», но в живой trading-сцене: сигнальное поле рынка, editorial-типографика из A, янтарная цель.",
  },
  {
    id: "dir-c",
    tag: "C · Cinematic Command Scene",
    name: "«Сцена»",
    note: "Кинематографичная сцена: дрейфующее поле сигнальных линий, слово-декорация и стеклянная плита прогресса.",
  },
  {
    id: "dir-c2",
    tag: "C2 · Cinematic Signal Hero",
    name: "«Сигнальный путь» — Alpha Academy",
    note: "Зрелая версия C: сцена от C, смысл «хаос → система» от B, типографическая дисциплина от A; маршрут проходит через всю сцену, тексты — только approved copy.",
  },
  {
    id: "dir-d",
    tag: "D · Product Dashboard Hero",
    name: "«Панель прогресса» — Alpha Academy",
    note: "Product-led hero: главный объект — большой тёплый дашборд одной поверхностью с 4 зонами (путь 01–06, XP, статусы); тексты — только approved copy.",
  },
];

export default function HeroDirectionsPage() {
  return (
    <div className="hero-lab-page">
      <header className="hero-lab-pagehead">
        <p className="page-kicker">Design Lab</p>
        <h1 className="page-title">Hero Directions</h1>
        <p className="muted mt-3 max-w-3xl">
          Три принципиально разных направления первого экрана TradeQuest.
          Прототипы на mock-данных, живая главная не затронута.
        </p>
        <nav className="hero-lab-pagenav font-data" aria-label="Направления">
          {directions.map((direction) => (
            <a key={direction.id} href={`#${direction.id}`}>
              {direction.tag}
            </a>
          ))}
        </nav>
      </header>

      {[HeroDirectionA, HeroDirectionB, HeroDirectionB2, HeroDirectionC, HeroDirectionC2, HeroDirectionD].map((Direction, index) => {
        const meta = directions[index];
        return (
          <section key={meta.id} id={meta.id} className="hero-lab-slot">
            <div className="hero-lab-slothead">
              <span className="hero-lab-tag font-data">{meta.tag}</span>
              <div>
                <h2>{meta.name}</h2>
                <p>{meta.note}</p>
              </div>
            </div>
            <Direction />
          </section>
        );
      })}
    </div>
  );
}
