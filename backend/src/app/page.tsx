import Link from "next/link";
import { CommandParticles } from "@/components/CommandParticles";
import { CommandStageEffects } from "@/components/CommandStageEffects";
import { MarketPulse } from "@/components/MarketPulse";
import { ProductMap } from "@/components/ProductMap";

const productStats = [
  { label: "активных учеников", value: "12K+" },
  { label: "проверенных заданий", value: "48K+" },
  { label: "средняя оценка", value: "4.8/5" },
];

const featureStrip = [
  ["01", "Структурное обучение", "Пошаговые задания, отчёты и контрольные точки вместо хаотичного просмотра уроков."],
  ["02", "Практика с целью", "Демо-сделки, стратегии, отчёты и ревью наставника в одном маршруте."],
  ["03", "Прогресс и XP", "Уровни, streak, награды и рейтинг помогают видеть движение каждый день."],
  ["04", "Биржевой sandbox", "Проверка регистрации, депозита, баланса и postback-событий в безопасном режиме."],
  ["05", "Команда рядом", "Общий чат, чат с ментором, саппорт и история обращений."],
  ["06", "Контрольные точки", "Checkpoint замораживает прогресс, но не сбрасывает уровень, XP и награды."],
];

const pathSteps = [
  {
    step: "01",
    title: "Foundation",
    status: "открыто",
    description: "Регистрация, базовое обучение и первые действия в системе.",
  },
  {
    step: "02",
    title: "Exchange",
    status: "активно",
    description: "Подключение биржи, регистрация по ссылке и первый депозит.",
  },
  {
    step: "03",
    title: "Practice",
    status: "закрыто",
    description: "Серии сделок по стратегиям, отчёты и проверка наставником.",
  },
  {
    step: "04",
    title: "Checkpoint",
    status: "locked",
    description: "Баланс, награды, уровни и следующий этап обучения.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-12 pb-6">
      <section className="command-stage">
        <CommandStageEffects />
        <CommandParticles />
        <div className="command-copy">
          <div className="min-w-0">
            <p className="hero-eyebrow">TradeQuest · структурное обучение трейдингу</p>
            <h1 className="command-title mt-4 max-w-3xl">
              Не просто уроки.
              <br />
              Управляемый путь трейдера.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-secondary)] md:text-lg">
              Задания идут в строгом порядке, отчёты читает живой наставник,
              а checkpoint&#8209;ы подтверждаются на бирже. Вы управляете своим
              ростом — и видите его в цифрах.
            </p>
          </div>
          <div className="command-copy-side">
            <Link href="/register" className="btn btn-primary cta-sheen min-h-[3.25rem] px-8 text-base">
              Начать обучение
            </Link>
            <div className="command-stats font-data">
              {productStats.map((stat) => (
                <span key={stat.label}>
                  <b>{stat.value}</b> {stat.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <ProductMap />
      </section>

      <section className="bento-strip grid gap-0 overflow-hidden md:grid-cols-3 lg:grid-cols-6">
        {featureStrip.map(([number, title, description]) => (
          <div key={title} className="border-b border-[var(--border)] p-5 md:border-r lg:border-b-0">
            <div className="mb-4 text-xs font-black text-[var(--primary)]">{number}</div>
            <h2 className="font-black text-[var(--text-primary)]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
          </div>
        ))}
      </section>

      <MarketPulse />

      <section id="program" className="grid scroll-mt-24 gap-6 lg:grid-cols-[0.42fr_1fr]">
        <div className="story-panel p-7">
          <p className="page-kicker">Learning path</p>
          <h2 className="mt-3 text-3xl font-black leading-tight text-[var(--text-primary)] md:text-4xl">
            Маршрут от новичка до уверенного трейдера
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">
            Это не набор карточек, а управляемая цепочка: следующий шаг виден,
            закрытые задания не отвлекают, награда привязана к прогрессу.
          </p>
          <Link href="/tasks" className="btn btn-secondary mt-6">
            Посмотреть цепочку
          </Link>
        </div>
        <div className="path-connector grid gap-4 md:grid-cols-4">
          {pathSteps.map((step, index) => (
            <div key={step.step} className="app-card-interactive app-card-flat relative z-10 p-5">
              <div className={`mb-5 grid h-12 w-12 place-items-center rounded-full font-black text-white ${index < 2 ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]"}`}>
                {step.step}
              </div>
              <h3 className="font-black text-[var(--text-primary)]">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{step.description}</p>
              <span className="status-pill mt-4">{step.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_0.78fr_0.9fr]">
        <div className="story-panel p-7">
          <p className="page-kicker">Почему это работает</p>
          <h2 className="section-title mt-2">Система держит фокус</h2>
          <div className="mt-5 grid gap-3 text-sm leading-6 text-[var(--text-secondary)] md:grid-cols-2">
            <p>Задания идут в правильной последовательности.</p>
            <p>Отчёты проверяются наставником до начисления прогресса.</p>
            <p>Checkpoint не сбрасывает уровень, но защищает маршрут от хаоса.</p>
            <p>Рейтинг, награды и streak добавляют мотивацию без дешёвой игры.</p>
          </div>
        </div>
        <div className="app-card p-6">
          <p className="page-kicker">Отзывы</p>
          <div className="mt-4 text-2xl font-black text-[var(--text-primary)]">
            Наконец понятно, что делать дальше.
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
            Структура, задачи и обратная связь помогают не прыгать между стратегиями,
            а двигаться по плану.
          </p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <span className="font-bold text-[var(--text-primary)]">Михаил Р.</span>
            <span className="badge">5 из 5</span>
          </div>
        </div>
        <div className="app-card p-6">
          <p className="page-kicker">Community highlights</p>
          <div className="mt-4 space-y-4">
            {["Разбор сделки по EUR/USD", "Первый approved отчёт", "Новый streak 7 дней"].map((item) => (
              <div key={item} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
                <p className="font-bold text-[var(--text-primary)]">{item}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">обновление сообщества</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
