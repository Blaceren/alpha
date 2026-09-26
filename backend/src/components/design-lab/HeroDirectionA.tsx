import { labDisplayA } from "./lab-display-font";
import Link from "next/link";


const proofsA = [
  ["12 400+", "учеников в системе"],
  ["48 000", "отчётов проверено наставниками"],
  ["96", "checkpoint'ов за последнюю неделю"],
] as const;

export function HeroDirectionA() {
  return (
    <section className={`hero-lab hero-lab-a ${labDisplayA.variable}`}>
      <header className="hero-lab-a-top">
        <span className="hero-lab-a-mark">TradeQuest</span>
        <nav>
          <Link href="/news">Новости</Link>
          <Link href="/login">Войти</Link>
        </nav>
      </header>

      <h2 className="hero-lab-a-title">
        Рынок не прощает хаос.
        <br />
        <em>Мы учим системе.</em>
      </h2>

      <div className="hero-lab-a-rule" aria-hidden="true" />

      <div className="hero-lab-a-cols">
        <div className="hero-lab-a-lead">
          <p>
            Задания идут по порядку, отчёты читает наставник, checkpoint&#8209;ы
            подтверждает биржа. Дисциплина ставится до того, как вы рискнёте
            настоящими деньгами.
          </p>
          <Link href="/register" className="hero-lab-a-cta">
            Начать путь
          </Link>
        </div>
        <dl className="hero-lab-a-proofs font-data">
          {proofsA.map(([value, label]) => (
            <div key={label}>
              <dt>{value}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>

      <figure className="hero-lab-a-line" aria-label="Дисциплина поверх рыночного графика">
        <svg viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            className="hero-lab-a-raw"
            points="0,120 40,96 70,132 105,88 140,118 180,74 215,108 255,64 290,96 330,52 370,86 410,60 450,92 490,46 530,78"
          />
          <path className="hero-lab-a-plan" d="M530,78 C640,40 760,96 880,64 S1080,36 1200,52" />
          <circle className="hero-lab-a-dot" cx="560" cy="74" r="4" />
          <circle className="hero-lab-a-dot" cx="880" cy="64" r="4" />
          <circle className="hero-lab-a-dot hero-lab-a-dot--amber" cx="1110" cy="45" r="5" />
        </svg>
        <figcaption className="font-data">
          <span style={{ left: "46%" }}>вход по плану</span>
          <span style={{ left: "73%" }}>стоп стоит</span>
          <span style={{ left: "92%" }}>отчёт наставнику</span>
        </figcaption>
      </figure>
    </section>
  );
}
