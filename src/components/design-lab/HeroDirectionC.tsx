import { labDisplayC } from "./lab-display-font";
import Link from "next/link";


const fieldWaves = [
  "0,150 120,120 240,160 360,110 480,150 600,95 720,140 840,90 960,130 1080,80 1200,115 1320,70 1440,100",
  "0,220 130,200 260,235 390,185 520,220 650,170 780,210 910,160 1040,195 1170,145 1300,180 1440,150",
  "0,80 140,60 280,95 420,50 560,85 700,40 840,75 980,30 1120,60 1260,20 1440,45",
];

function WaveLayer({ className }: { className: string }) {
  return (
    <div className={`hero-lab-c-layer ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1440 280" preserveAspectRatio="none">
        {fieldWaves.map((points, index) => (
          <polyline key={index} points={points} data-line={index} />
        ))}
      </svg>
    </div>
  );
}

const slabDots = ["done", "done", "done", "active", "next", "next"] as const;

export function HeroDirectionC() {
  return (
    <section className={`hero-lab hero-lab-c ${labDisplayC.variable}`}>
      <div className="hero-lab-c-field" aria-hidden="true">
        <WaveLayer className="hero-lab-c-layer--far" />
        <WaveLayer className="hero-lab-c-layer--mid" />
        <WaveLayer className="hero-lab-c-layer--near" />
      </div>

      <span className="hero-lab-c-word" aria-hidden="true">
        Система
      </span>

      <div className="hero-lab-c-slab">
        <p className="hero-lab-c-slab-tag font-data">Путь · уровень 2</p>
        <p className="hero-lab-c-slab-xp font-data">420 / 700 XP</p>
        <div className="hero-lab-c-slab-track" aria-hidden="true">
          <span style={{ width: "60%" }} />
        </div>
        <div className="hero-lab-c-slab-dots" aria-hidden="true">
          {slabDots.map((state, index) => (
            <span key={index} data-state={state} />
          ))}
        </div>
        <p className="hero-lab-c-slab-step">
          Шаг 04 · Пополнение баланса
          <span className="font-data">вы здесь</span>
        </p>
      </div>

      <div className="hero-lab-c-copy">
        <h2>Торгуй по системе, которую видно.</h2>
        <p>
          Маршрут из шести шагов: наставник проверяет отчёты, биржа подтверждает
          checkpoint&#8209;ы, прогресс считается в XP.
        </p>
        <span className="hero-lab-glow">
          <Link href="/register">Начать путь</Link>
        </span>
      </div>

      <ul className="hero-lab-c-proofs font-data">
        <li>
          <b>12 400+</b> учеников
        </li>
        <li>
          <b>48 000</b> отчётов проверено
        </li>
        <li>
          <b>4.8/5</b> средняя оценка
        </li>
      </ul>
    </section>
  );
}
