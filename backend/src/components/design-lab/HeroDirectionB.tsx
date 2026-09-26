import Link from "next/link";

type StepState = "done" | "active" | "next" | "goal";

const stepsB: Array<{
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

export function HeroDirectionB() {
  return (
    <section className="hero-lab hero-lab-b">
      <header className="hero-lab-b-top">
        <span className="hero-lab-b-mark">TQ</span>
        <Link href="/login">Войти</Link>
      </header>

      <div className="hero-lab-b-head">
        <h2>
          Из хаоса — в систему.
          <br />
          За шесть проверенных шагов.
        </h2>
        <p>
          Каждый шаг открывается после проверки предыдущего: отчёты читает
          наставник, checkpoint&#8209;ы подтверждает биржа.
        </p>
      </div>

      <div className="hero-lab-b-route" role="img" aria-label="Маршрут из шести шагов: от хаотичного графика к системе">
        <svg viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="lab-route-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4c5568" />
              <stop offset="30%" stopColor="#2ec26a" />
              <stop offset="88%" stopColor="#2ec26a" />
              <stop offset="100%" stopColor="#2f6bff" />
            </linearGradient>
          </defs>

          <polyline
            className="hero-lab-b-chaos"
            points="0,238 22,208 44,246 66,196 88,234 110,186 132,224 160,206"
          />
          <path
            className="hero-lab-b-done"
            d="M160,206 C220,192 280,178 340,170 S 460,152 520,148 S 640,120 700,112"
          />
          <path
            className="hero-lab-b-future"
            d="M700,112 C760,102 820,90 880,84 S 1000,56 1060,48 L1200,30"
          />

          {stepsB.map((step) => {
            const r = nodeRadius[step.state];
            const labelY = step.labelBelow ? step.y + r + 22 : step.y - r - 14;
            const numY = step.labelBelow ? step.y + r + 38 : step.y - r - 30;
            return (
              <g key={step.n} className="hero-lab-b-step" data-state={step.state}>
                {step.state === "active" ? (
                  <circle className="hero-lab-b-pulse" cx={step.x} cy={step.y} r={r + 6} />
                ) : null}
                <circle className="hero-lab-b-node" cx={step.x} cy={step.y} r={r} />
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
                <text className="hero-lab-b-num" x={step.x} y={step.labelBelow ? numY : numY} textAnchor="middle">
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
        {stepsB.map((step) => (
          <li key={step.n} data-state={step.state}>
            <span>{step.n}</span> {step.label}
          </li>
        ))}
      </ol>

      <div className="hero-lab-b-foot">
        <Link href="/register" className="hero-lab-b-cta">
          Начать с шага 01
        </Link>
        <div className="hero-lab-b-proofs font-data">
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
