import { labDisplayC } from "./lab-display-font";
import Link from "next/link";


type PathState = "done" | "active" | "next" | "goal";

const pathSteps: Array<{ n: string; label: string; state: PathState }> = [
  { n: "01", label: "Диагностика", state: "done" },
  { n: "02", label: "Уроки", state: "done" },
  { n: "03", label: "Практика", state: "active" },
  { n: "04", label: "Наставник", state: "next" },
  { n: "05", label: "Pocket", state: "next" },
  { n: "06", label: "Прогресс", state: "goal" },
];

const statusRows: Array<{
  label: string;
  value?: string;
  chip?: string;
  chipTone: "process" | "review" | "done" | "locked" | "none";
}> = [
  { label: "Активное задание", value: "03 Практика", chip: "В процессе", chipTone: "process" },
  { label: "Отчёт наставнику", chip: "Проверяется наставником", chipTone: "review" },
  { label: "Pocket checkpoint", chip: "Готово", chipTone: "done" },
  { label: "Следующий шаг", value: "04 Наставник", chip: "Заблокировано", chipTone: "locked" },
];

const bgChart = "0,190 120,170 240,182 360,150 480,162 600,128 720,140 840,104 960,116 1080,80 1200,92 1320,58 1440,68";

export function HeroDirectionD() {
  return (
    <section className={`hero-lab hero-lab-d ${labDisplayC.variable}`}>
      <div className="hero-lab-d-bg" aria-hidden="true">
        <svg viewBox="0 0 1440 260" preserveAspectRatio="none">
          <polyline points={bgChart} />
        </svg>
      </div>

      <svg className="hero-lab-d-grain" aria-hidden="true">
        <filter id="lab-d-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#lab-d-grain)" />
      </svg>

      <header className="hero-lab-d-top">
        <span className="hero-lab-d-mark">Alpha Academy</span>
        <Link href="/login">Войти</Link>
      </header>

      <div className="hero-lab-d-body">
        <div className="hero-lab-d-copy">
          <p className="hero-lab-d-eyebrow font-data">Структурное обучение трейдингу</p>
          <h2>
            Торгуй не на эмоциях.
            <br />
            <em>Иди по системе.</em>
          </h2>
          <p className="hero-lab-d-lead">
            Alpha Academy собирает обучение, задания, проверки наставника,
            Pocket checkpoint&#8217;ы и прогресс в одном понятном дашборде.
          </p>
          <div className="hero-lab-d-actions">
            <Link href="/register" className="hero-lab-d-cta">
              Начать обучение
            </Link>
            <Link href="/login" className="hero-lab-d-cta2">
              Посмотреть как работает →
            </Link>
          </div>
          <p className="hero-lab-d-proof font-data">
            16 уровней · отчёты наставнику · XP&#8209;прогресс · Pocket checkpoint&#8217;ы
          </p>
        </div>

        <div className="hero-lab-d-dash">
          <div className="hero-lab-d-dashhead">
            <p className="hero-lab-d-dashtitle">Панель прогресса</p>
            <div className="hero-lab-d-level">
              <span className="font-data hero-lab-d-microlabel">Текущий уровень</span>
              <span className="font-data hero-lab-d-levelvalue">7 / 16</span>
            </div>
          </div>

          <div className="hero-lab-d-zone">
            <p className="font-data hero-lab-d-microlabel">Путь трейдера</p>
            <div className="hero-lab-d-path">
              {pathSteps.map((step, index) => (
                <div key={step.n} className="hero-lab-d-step" data-state={step.state}>
                  {index > 0 ? <span className="hero-lab-d-seg" data-prev={pathSteps[index - 1].state} aria-hidden="true" /> : null}
                  <span className="hero-lab-d-node">
                    {step.state === "done" ? "✓" : step.n}
                  </span>
                  <span className="hero-lab-d-stepname">{step.label}</span>
                  {step.state === "active" ? (
                    <span className="hero-lab-d-here font-data">Вы здесь</span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="hero-lab-d-pathmobile font-data">03 Практика — Вы здесь</p>
          </div>

          <div className="hero-lab-d-zone hero-lab-d-zone--xp">
            <div className="hero-lab-d-xprow">
              <p className="font-data hero-lab-d-microlabel">XP прогресс</p>
              <p className="font-data hero-lab-d-xpvalue">420 / 700</p>
            </div>
            <div className="hero-lab-d-xptrack">
              <span style={{ width: "60%" }} />
            </div>
          </div>

          <div className="hero-lab-d-zone hero-lab-d-zone--status">
            {statusRows.map((row) => (
              <div key={row.label} className="hero-lab-d-row">
                <span className="hero-lab-d-rowlabel">{row.label}</span>
                <span className="hero-lab-d-rowright">
                  {row.value ? <b>{row.value}</b> : null}
                  {row.chip ? (
                    <span className="hero-lab-d-chip" data-tone={row.chipTone}>
                      {row.chip}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
