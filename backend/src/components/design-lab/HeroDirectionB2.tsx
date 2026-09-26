import { labDisplayA } from "./lab-display-font";
import Link from "next/link";


type StepState = "done" | "active" | "next" | "goal";

const stepsB2: Array<{
  n: string;
  label: string;
  x: number;
  y: number;
  state: StepState;
  labelBelow?: boolean;
}> = [
  { n: "01", label: "Регистрация", x: 160, y: 206, state: "done", labelBelow: true },
  { n: "02", label: "Базовое обучение", x: 340, y: 170, state: "done" },
  { n: "03", label: "Аккаунт Pocket", x: 520, y: 148, state: "done", labelBelow: true },
  { n: "04", label: "Пополнение баланса", x: 700, y: 112, state: "active" },
  { n: "05", label: "50 сделок + отчёт", x: 880, y: 84, state: "next", labelBelow: true },
  { n: "06", label: "Checkpoint · $2000", x: 1060, y: 48, state: "goal" },
];

const nodeRadius: Record<StepState, number> = {
  done: 8,
  active: 12,
  next: 8,
  goal: 15,
};

const doneD = "M160,206 C220,192 280,178 340,170 S 460,152 520,148 S 640,120 700,112";
const futureD = "M700,112 C760,102 820,90 880,84 S 1000,56 1060,48 L1200,30";

const fieldWavesB2 = [
  "0,232 180,214 360,224 540,192 720,202 900,168 1080,178 1260,146 1440,156",
  "0,300 200,286 400,296 600,266 800,276 1000,242 1200,252 1440,224",
  "0,160 220,142 440,152 660,122 880,132 1100,100 1320,110 1440,90",
  "0,356 240,344 480,352 720,326 960,334 1200,304 1440,312",
];

function SignalLayer({ className }: { className: string }) {
  return (
    <div className={`hero-lab-b2-layer ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1440 400" preserveAspectRatio="none">
        {fieldWavesB2.map((points, index) => (
          <polyline key={index} points={points} data-line={index} />
        ))}
      </svg>
    </div>
  );
}

export function HeroDirectionB2() {
  return (
    <section className={`hero-lab hero-lab-b2 ${labDisplayA.variable}`}>
      <div className="hero-lab-b2-field" aria-hidden="true">
        <SignalLayer className="hero-lab-b2-layer--far" />
        <SignalLayer className="hero-lab-b2-layer--near" />
      </div>

      <header className="hero-lab-b2-top">
        <span className="hero-lab-b2-mark">TradeQuest</span>
        <Link href="/login">Войти</Link>
      </header>

      <div className="hero-lab-b2-head">
        <h2>
          Рынок не станет проще.
          <br />
          <em>Ваша торговля — станет.</em>
        </h2>
        <p>
          Маршрут из шести шагов: задания по порядку, отчёты наставнику,
          checkpoint&#8209;ы на бирже. Хаос остаётся слева.
        </p>
      </div>

      <div className="hero-lab-b2-route" role="img" aria-label="Маршрут из шести шагов: от хаотичного графика к системе">
        <svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="lab-route-grad2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4c5058" />
              <stop offset="32%" stopColor="#2ec26a" />
              <stop offset="86%" stopColor="#2ec26a" />
              <stop offset="100%" stopColor="#2f6bff" />
            </linearGradient>
          </defs>

          <polyline
            className="hero-lab-b2-chaos"
            points="0,238 22,208 44,246 66,196 88,234 110,186 132,224 160,206"
          />

          <path className="hero-lab-b2-underglow" d={`${doneD} ${futureD.replace("M700,112 ", "")}`} />
          <path className="hero-lab-b2-done" d={doneD} />
          <path className="hero-lab-b-future" d={futureD} />
          <path className="hero-lab-b2-flow" d={doneD} />

          {stepsB2.map((step) => {
            const r = nodeRadius[step.state];
            const labelY = step.labelBelow ? step.y + r + 22 : step.y - r - 14;
            const numY = step.labelBelow ? step.y + r + 38 : step.y - r - 30;
            return (
              <g key={step.n} className="hero-lab-b-step" data-state={step.state}>
                {step.state === "active" ? (
                  <>
                    <circle className="hero-lab-b2-halo" cx={step.x} cy={step.y} r={r + 10} />
                    <circle className="hero-lab-b-pulse" cx={step.x} cy={step.y} r={r + 6} />
                  </>
                ) : null}
                {step.state === "goal" ? (
                  <circle className="hero-lab-b2-goalring" cx={step.x} cy={step.y} r={r + 9} />
                ) : null}
                <circle className="hero-lab-b-node" cx={step.x} cy={step.y} r={r} />
                {step.state === "active" ? (
                  <circle className="hero-lab-b2-core" cx={step.x} cy={step.y} r={3} />
                ) : null}
                {step.state === "done" ? (
                  <text className="hero-lab-b-check" x={step.x} y={step.y + 3.5} textAnchor="middle">
                    ✓
                  </text>
                ) : null}
                {step.state === "goal" ? (
                  <text className="hero-lab-b-flag" x={step.x} y={step.y + 4.5} textAnchor="middle">
                    ★
                  </text>
                ) : null}
                <text className="hero-lab-b-num" x={step.x} y={numY} textAnchor="middle">
                  {step.n}
                </text>
                <text className="hero-lab-b-label" x={step.x} y={labelY} textAnchor="middle">
                  {step.label}
                </text>
                {step.state === "active" ? (
                  <text className="hero-lab-b-here" x={step.x} y={step.y - r - 34} textAnchor="middle">
                    вы здесь
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <ol className="hero-lab-b-steplist font-data">
        {stepsB2.map((step) => (
          <li key={step.n} data-state={step.state}>
            <span>{step.n}</span> {step.label}
          </li>
        ))}
      </ol>

      <div className="hero-lab-b2-foot">
        <Link href="/register" className="hero-lab-b2-cta">
          Начать с шага 01
        </Link>
        <div className="hero-lab-b2-proofs font-data">
          <span>
            <b>3 из 6</b> шагов пройдено
          </span>
          <span>
            <b>~2 ч</b> ответ наставника
          </span>
          <span>
            <b>+150 XP</b> за streak сегодня
          </span>
        </div>
      </div>
    </section>
  );
}
