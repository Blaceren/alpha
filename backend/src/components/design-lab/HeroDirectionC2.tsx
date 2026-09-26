import { labDisplayC } from "./lab-display-font";
import Link from "next/link";


type C2State = "done" | "active" | "next" | "goal";

const stations: Array<{
  n: string;
  label: string;
  x: number;
  y: number;
  state: C2State;
  sub?: string;
}> = [
  { n: "01", label: "Диагностика", x: 380, y: 442, state: "done" },
  { n: "02", label: "Уроки", x: 530, y: 402, state: "done" },
  { n: "03", label: "Практика", x: 672, y: 336, state: "active", sub: "Активный этап" },
  { n: "04", label: "Наставник", x: 802, y: 266, state: "next", sub: "Отчёт наставнику" },
  { n: "05", label: "Pocket", x: 930, y: 194, state: "next", sub: "Checkpoint" },
  { n: "06", label: "Прогресс", x: 1072, y: 118, state: "goal", sub: "Проверяемый прогресс" },
];

const chaosPoints = "60,470 100,438 132,486 168,428 204,468 240,420 272,452 310,430 340,452 380,442";
const doneD = "M380,442 C430,428 480,414 530,402 S 620,368 672,336";
const futureD = "M672,336 C716,312 758,290 802,266 S 886,222 930,194 S 1020,150 1072,118 L1150,84";

const chaosStrands = [
  "0,300 60,272 100,318 150,262 195,306 245,254 290,292 330,266",
  "0,380 55,352 105,396 160,344 210,384 260,336 305,368 345,346",
];

const structureWaves = [
  "420,300 560,282 700,292 840,258 980,266 1120,232 1200,238",
  "460,380 600,366 740,374 880,344 1020,352 1160,320 1200,324",
  "400,210 540,196 680,204 820,172 960,180 1100,148 1200,152",
];

export function HeroDirectionC2() {
  return (
    <section className={`hero-lab hero-lab-c2 ${labDisplayC.variable}`}>
      <div className="hero-lab-c2-field" aria-hidden="true">
        <div className="hero-lab-c2-layer hero-lab-c2-layer--far">
          <svg viewBox="0 0 1200 480" preserveAspectRatio="none">
            {structureWaves.map((points, index) => (
              <polyline key={index} points={points} data-kind="structure" data-line={index} />
            ))}
          </svg>
        </div>
        <div className="hero-lab-c2-layer hero-lab-c2-layer--near">
          <svg viewBox="0 0 1200 480" preserveAspectRatio="none">
            {chaosStrands.map((points, index) => (
              <polyline key={index} points={points} data-kind="chaos" data-line={index} />
            ))}
            <polyline points={structureWaves[0]} data-kind="structure" data-line="0" />
          </svg>
        </div>
      </div>

      <svg className="hero-lab-c2-grain" aria-hidden="true">
        <filter id="lab-c2-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#lab-c2-grain)" />
      </svg>

      <header className="hero-lab-c2-top">
        <span className="hero-lab-c2-mark">Alpha Academy</span>
        <Link href="/login">Войти</Link>
      </header>

      <div className="hero-lab-c2-copy">
        <p className="hero-lab-c2-eyebrow font-data">Структурное обучение трейдингу</p>
        <h2>
          Рынок не станет проще.
          <br />
          <em>Твоя торговля — станет системной.</em>
        </h2>
        <p className="hero-lab-c2-lead">
          Alpha Academy ведёт тебя по проверяемому пути: уроки, задания, отчёты
          наставнику, Pocket checkpoint&#8217;ы и прогресс в цифрах.
        </p>
        <Link href="/register" className="hero-lab-c2-cta">
          Начать обучение
        </Link>
        <p className="hero-lab-c2-smallline font-data">
          16 уровней · отчёты наставнику · прогресс через XP
        </p>
      </div>

      <div className="hero-lab-c2-scene" role="img" aria-label="Путь трейдера: шесть этапов от диагностики к прогрессу">
        <svg viewBox="0 0 1200 560" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="lab-c2-route" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#4c5058" />
              <stop offset="30%" stopColor="#2ec26a" />
              <stop offset="78%" stopColor="#2ec26a" />
              <stop offset="100%" stopColor="#e8b84b" />
            </linearGradient>
          </defs>

          <polyline className="hero-lab-c2-chaosline" points={chaosPoints} />
          <path
            className="hero-lab-c2-underglow"
            d={`${doneD} ${futureD.replace("M672,336 ", "")}`}
          />
          <path className="hero-lab-c2-done" d={doneD} />
          <path className="hero-lab-c2-future" d={futureD} />
          <path className="hero-lab-c2-flow" d={doneD} />

          <text className="hero-lab-c2-caption" x="380" y="490" textAnchor="middle">
            Путь трейдера
          </text>

          {stations.map((station) => {
            const r =
              station.state === "goal" ? 13 : station.state === "active" ? 11 : 7;
            return (
              <g key={station.n} className="hero-lab-c2-station" data-state={station.state}>
                {station.state === "active" ? (
                  <>
                    <circle className="hero-lab-c2-halo" cx={station.x} cy={station.y} r={r + 11} />
                    <circle className="hero-lab-b-pulse" cx={station.x} cy={station.y} r={r + 6} />
                  </>
                ) : null}
                {station.state === "goal" ? (
                  <circle className="hero-lab-c2-goalring" cx={station.x} cy={station.y} r={r + 9} />
                ) : null}
                <circle className="hero-lab-c2-node" cx={station.x} cy={station.y} r={r} />
                {station.state === "done" ? (
                  <text className="hero-lab-c2-checkmark" x={station.x} y={station.y + 3.5} textAnchor="middle">
                    ✓
                  </text>
                ) : null}
                {station.state === "active" ? (
                  <circle className="hero-lab-c2-core" cx={station.x} cy={station.y} r={3} />
                ) : null}

                <text className="hero-lab-c2-num" x={station.x + r + 12} y={station.y - 8} textAnchor="start">
                  {station.n}
                </text>
                <text className="hero-lab-c2-label" x={station.x + r + 12} y={station.y + 10} textAnchor="start">
                  {station.label}
                </text>
                {station.sub ? (
                  <text className="hero-lab-c2-sub" x={station.x + r + 12} y={station.y + 27} textAnchor="start">
                    {station.sub}
                  </text>
                ) : null}
                {station.state === "active" ? (
                  <text className="hero-lab-c2-here" x={station.x - r - 12} y={station.y + 4} textAnchor="end">
                    Вы здесь
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <ol className="hero-lab-b-steplist hero-lab-c2-steplist font-data">
        {stations.map((station) => (
          <li key={station.n} data-state={station.state === "goal" ? "next" : station.state}>
            <span>{station.n}</span> {station.label}
            {station.state === "active" ? " — Вы здесь" : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
