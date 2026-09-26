import Link from "next/link";

const stats = [
  ["12K+", "активных учеников"],
  ["48K+", "проверенных заданий"],
  ["4.8/5", "средняя оценка"],
];

const dashboardTasks = [
  ["01", "Регистрация на платформе", "done"],
  ["04", "Пополнение баланса", "active"],
  ["05", "50 сделок + отчёт", "locked"],
];

const leaderboard = [
  ["Алекс М.", "12 450 XP"],
  ["Сара К.", "8 290 XP"],
  ["Иван Т.", "6 810 XP"],
];

const pathItems = [
  ["01", "Foundation", "База, регистрация, первые задания"],
  ["02", "Practice", "Сделки, отчёты, ревью наставника"],
  ["03", "Checkpoint", "Баланс, заморозка, восстановление"],
  ["04", "Mastery", "Награды, рейтинг, закрытый чат"],
];

const featureItems = [
  "Структурное обучение",
  "Практика на сделках",
  "XP и уровни",
  "Награды",
  "Комьюнити",
  "Наставник",
  "Контрольные точки",
];

function LabTopNav() {
  return (
    <div className="sticky top-[84px] z-30 mb-6 rounded-full border border-slate-200 bg-white/85 p-2 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl theme-dark:border-slate-800 theme-dark:bg-slate-950/80">
      <div className="flex gap-2 overflow-x-auto text-sm font-bold">
        <a className="rounded-full bg-blue-600 px-4 py-2 text-white" href="#concept-a">
          A - SaaS Dashboard
        </a>
        <a className="rounded-full px-4 py-2 text-slate-600 hover:bg-slate-100 theme-dark:text-slate-300 theme-dark:hover:bg-slate-900" href="#concept-b">
          B - Gamified Academy
        </a>
        <a className="rounded-full px-4 py-2 text-slate-600 hover:bg-slate-100 theme-dark:text-slate-300 theme-dark:hover:bg-slate-900" href="#concept-c">
          C - Fintech Console
        </a>
      </div>
    </div>
  );
}

function SaaSChart() {
  return (
    <div className="relative h-52 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-blue-50 to-white p-4 theme-dark:border-slate-800 theme-dark:from-blue-950/30 theme-dark:to-slate-950">
      <div className="flex items-center justify-between text-xs font-bold text-slate-500 theme-dark:text-slate-400">
        <span>EUR/USD</span>
        <span className="text-emerald-500">+0.32%</span>
      </div>
      <div className="absolute inset-x-5 bottom-10 top-14 rounded-xl bg-[linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[length:44px_36px]" />
      <div className="absolute bottom-16 left-7 right-7 h-24 rounded-full bg-blue-500/20 blur-2xl" />
      <div className="absolute bottom-20 left-7 right-7 h-20 rounded-[50%] border-t-4 border-blue-500" />
    </div>
  );
}

function SaaSDashboardPreview() {
  return (
    <div className="grid min-h-[620px] overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.14)] theme-dark:border-slate-800 theme-dark:bg-slate-950 lg:grid-cols-[74px_1fr]">
      <aside className="hidden border-r border-slate-200 bg-slate-50 p-4 theme-dark:border-slate-800 theme-dark:bg-slate-900/60 lg:block">
        <div className="mb-8 grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-sm font-black text-white">TQ</div>
        <div className="space-y-3">
          {["К", "З", "Р", "Ч", "Н", "Б"].map((item, index) => (
            <div key={item} className={`grid h-10 w-10 place-items-center rounded-xl text-xs font-black ${index === 0 ? "bg-blue-100 text-blue-600 theme-dark:bg-blue-500/15" : "text-slate-400"}`}>
              {item}
            </div>
          ))}
        </div>
      </aside>

      <div className="p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xl font-black text-slate-950 theme-dark:text-white">My Dashboard</p>
            <p className="text-sm text-slate-500 theme-dark:text-slate-400">Welcome back, Alex</p>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 theme-dark:border-slate-800 theme-dark:text-slate-300">Level 2</span>
            <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">Новичок</span>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 theme-dark:border-slate-800 theme-dark:bg-slate-900/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-950 theme-dark:text-white">Advanced Trend Strategy</p>
                <p className="mt-1 text-xs text-slate-500 theme-dark:text-slate-400">420 / 700 XP - 60%</p>
              </div>
              <span className="text-sm font-black text-blue-600">60%</span>
            </div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200 theme-dark:bg-slate-800">
              <div className="h-full w-[60%] rounded-full bg-blue-600" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {["3/8 заданий", "Отчёт pending", "7 дней streak"].map((item) => (
                <div key={item} className="rounded-2xl bg-white p-3 text-xs font-bold text-slate-600 shadow-sm theme-dark:bg-slate-950 theme-dark:text-slate-300">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Daily streak", "7", "+150 XP"],
              ["Rank", "Top 24%", "активных"],
              ["Next reward", "Чат", "locked"],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm theme-dark:border-slate-800 theme-dark:bg-slate-900">
                <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
                <p className="mt-3 text-2xl font-black text-slate-950 theme-dark:text-white">{value}</p>
                <p className="mt-1 text-xs text-slate-500 theme-dark:text-slate-400">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[0.78fr_1.2fr_0.82fr]">
          <TaskPanel />
          <SaaSChart />
          <LeaderboardPanel />
        </div>
      </div>
    </div>
  );
}

function TaskPanel() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm theme-dark:border-slate-800 theme-dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-black text-slate-950 theme-dark:text-white">Текущие задания</p>
        <span className="text-xs font-bold text-blue-600">Все</span>
      </div>
      <div className="space-y-2">
        {dashboardTasks.map(([step, title, state]) => (
          <div key={title} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 theme-dark:border-slate-800 theme-dark:bg-slate-950">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-100 text-xs font-black text-blue-600 theme-dark:bg-blue-500/15">{step}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-950 theme-dark:text-white">{title}</p>
              <p className="text-xs text-slate-500 theme-dark:text-slate-400">{state}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardPanel() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm theme-dark:border-slate-800 theme-dark:bg-slate-900">
      <p className="font-black text-slate-950 theme-dark:text-white">Leaderboard</p>
      <div className="mt-4 space-y-3">
        {leaderboard.map(([name, xp], index) => (
          <div key={name} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-bold text-slate-950 theme-dark:text-white">{index + 1}. {name}</span>
            <span className="text-xs text-slate-500 theme-dark:text-slate-400">{xp}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptHeader({ label, title, description, dark = false }: { label: string; title: string; description: string; dark?: boolean }) {
  return (
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className={dark ? "text-sm font-black uppercase tracking-[0.18em] text-blue-300" : "text-sm font-black uppercase tracking-[0.18em] text-blue-600"}>{label}</p>
        <h2 className={dark ? "mt-3 max-w-4xl text-4xl font-black tracking-[-0.045em] text-white md:text-6xl" : "mt-3 max-w-4xl text-4xl font-black tracking-[-0.045em] text-slate-950 md:text-6xl"}>{title}</h2>
      </div>
      <p className={dark ? "max-w-xl text-base leading-7 text-slate-300" : "max-w-xl text-base leading-7 text-slate-600"}>{description}</p>
    </div>
  );
}

function ConceptA() {
  return (
    <section id="concept-a" className="scroll-mt-32 rounded-[40px] border border-slate-200 bg-[#f8fbff] p-5 shadow-[0_40px_120px_rgba(15,23,42,0.10)] md:p-8">
      <ConceptHeader
        label="Concept A - Reference SaaS Dashboard"
        title="Clean SaaS landing, где продукт продаёт сам себя"
        description="Самое близкое направление к TradeForge references: спокойная premium-композиция, крупный dashboard preview, много воздуха и понятная продуктовая сцена."
      />
      <div className="grid items-center gap-10 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="space-y-7">
          <span className="inline-flex rounded-full border border-blue-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-blue-600 shadow-sm">
            The structured trading education platform
          </span>
          <h3 className="text-5xl font-black leading-[0.93] tracking-[-0.055em] text-slate-950 md:text-7xl">
            Учись умнее. <span className="text-blue-600">Торгуй увереннее.</span>
          </h3>
          <p className="max-w-xl text-lg leading-8 text-slate-600">
            Платформа ведёт ученика через задания, отчёты, уровни, награды и проверку наставником - без хаоса и случайных уроков.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/register" className="rounded-full bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-[0_18px_44px_rgba(37,99,235,0.28)]">
              Начать обучение
            </Link>
            <Link href="/login" className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-black text-slate-950 shadow-sm">
              Открыть кабинет
            </Link>
          </div>
          <div className="grid max-w-xl grid-cols-3 gap-3">
            {stats.map(([value, label]) => (
              <div key={label} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-2xl font-black text-slate-950">{value}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <SaaSDashboardPreview />
      </div>
      <FeatureStrip light />
      <PathRow light />
      <SocialProof light />
    </section>
  );
}

function ConceptB() {
  return (
    <section id="concept-b" className="scroll-mt-32 rounded-[40px] border border-indigo-200 bg-gradient-to-br from-white via-indigo-50 to-blue-50 p-5 shadow-[0_40px_120px_rgba(79,70,229,0.14)] md:p-8 theme-dark:border-indigo-900 theme-dark:from-slate-950 theme-dark:via-indigo-950/30 theme-dark:to-blue-950/30">
      <ConceptHeader
        label="Concept B - Gamified Trading Academy"
        title="Академия прогресса: уровни, награды, locked-маршрут"
        description="Больше мотивации и игрового ощущения, но без cartoon UI: путь, ранги, streak, награды и комьюнити остаются в премиальном SaaS-формате."
      />
      <div className="grid gap-8 xl:grid-cols-[0.86fr_1.14fr]">
        <div className="rounded-[32px] border border-indigo-200 bg-white p-6 shadow-[0_30px_90px_rgba(79,70,229,0.12)] theme-dark:border-indigo-900 theme-dark:bg-slate-950">
          <span className="inline-flex rounded-full bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white">
            Level-based academy
          </span>
          <h3 className="mt-6 text-5xl font-black leading-[0.95] tracking-[-0.055em] text-slate-950 md:text-7xl theme-dark:text-white">
            Пройди путь. <span className="text-indigo-600">Открой уровень.</span>
          </h3>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600 theme-dark:text-slate-300">
            Каждый шаг открывает новый уровень доступа: уроки, отчёты, награды, закрытый чат и рейтинг участников.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/register" className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-black text-white shadow-[0_18px_44px_rgba(79,70,229,0.28)]">
              Начать маршрут
            </Link>
            <Link href="/levels" className="rounded-full border border-indigo-200 bg-white px-6 py-3 text-sm font-black text-slate-950 shadow-sm theme-dark:bg-slate-900 theme-dark:text-white">
              Смотреть уровни
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["Новичок", "Практик", "Трейдер", "Профи"].map((rank, index) => (
              <div key={rank} className={`rounded-3xl border p-4 ${index < 2 ? "border-indigo-200 bg-indigo-50 theme-dark:border-indigo-700 theme-dark:bg-indigo-950/30" : "border-slate-200 bg-slate-50 opacity-70 theme-dark:border-slate-800 theme-dark:bg-slate-900"}`}>
                <p className="text-xs font-black text-indigo-600">LVL {index + 1}</p>
                <p className="mt-2 font-black text-slate-950 theme-dark:text-white">{rank}</p>
              </div>
            ))}
          </div>
        </div>
        <GamifiedDashboardPreview />
      </div>
      <GamifiedPath />
      <SocialProof />
    </section>
  );
}

function GamifiedDashboardPreview() {
  return (
    <div className="min-h-[650px] rounded-[34px] border border-indigo-200 bg-slate-950 p-5 text-white shadow-[0_42px_130px_rgba(79,70,229,0.28)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-xl font-black">Progress Command Center</p>
          <p className="text-sm text-indigo-200">Алекс - уровень 2 - streak 7 дней</p>
        </div>
        <span className="rounded-full bg-indigo-500 px-4 py-2 text-xs font-black">420 / 700 XP</span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5">
          <div className="flex items-center justify-between">
            <p className="font-black">Rank journey</p>
            <span className="text-sm font-black text-indigo-300">60%</span>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[60%] rounded-full bg-indigo-400" />
          </div>
          <div className="mt-6 grid grid-cols-4 gap-2">
            {["1", "2", "3", "4"].map((item, index) => (
              <div key={item} className={`rounded-2xl p-3 text-center ${index < 2 ? "bg-indigo-500" : "bg-white/10"}`}>
                <p className="text-lg font-black">{item}</p>
                <p className="text-[10px] uppercase text-indigo-100">{index < 2 ? "done" : "locked"}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4">
          {[
            ["Next reward", "Закрытый чат"],
            ["Leaderboard", "Top 24%"],
            ["Checkpoint", "Баланс >= $2000"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
              <p className="text-xs font-bold uppercase text-indigo-200">{label}</p>
              <p className="mt-2 text-xl font-black">{value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <TaskPanelDark />
        <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
          <p className="font-black">Market practice</p>
          <div className="mt-4 h-56 rounded-2xl bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[length:42px_34px]" />
        </div>
      </div>
    </div>
  );
}

function TaskPanelDark() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
      <p className="font-black text-white">Task chain</p>
      <div className="mt-4 space-y-2">
        {dashboardTasks.map(([step, title, state]) => (
          <div key={title} className="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-3">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-500 text-xs font-black text-white">{step}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{title}</p>
              <p className="text-xs text-indigo-200">{state}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptC() {
  return (
    <section id="concept-c" className="scroll-mt-32 rounded-[40px] border border-slate-800 bg-[#030712] p-5 text-white shadow-[0_44px_140px_rgba(0,0,0,0.55)] md:p-8">
      <ConceptHeader
        dark
        label="Concept C - Premium Fintech Console"
        title="Трейдинг-обучение как дорогой fintech-продукт"
        description="Самое market-focused направление: больше графиков, checkpoint-контроля, статусов биржи и плотной рабочей консоли."
      />
      <div className="grid items-center gap-8 xl:grid-cols-[0.6fr_1.4fr]">
        <div className="space-y-7">
          <span className="inline-flex rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-blue-300">
            Market skills and controlled progress
          </span>
          <h3 className="text-5xl font-black leading-[0.93] tracking-[-0.055em] text-white md:text-7xl">
            Расти в рынке. <span className="text-blue-400">Держи контроль.</span>
          </h3>
          <p className="max-w-xl text-lg leading-8 text-slate-300">
            Система соединяет обучение, sandbox-биржу, отчёты, postback-события и контрольные точки в одном fintech-интерфейсе.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/register" className="rounded-full bg-blue-500 px-6 py-3 text-sm font-black text-white shadow-[0_18px_50px_rgba(59,130,246,0.35)]">
              Начать проверку
            </Link>
            <Link href="/exchange" className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-black text-white">
              Биржевой sandbox
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {stats.map(([value, label]) => (
              <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
                <p className="text-2xl font-black text-white">{value}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <FintechDashboardPreview />
      </div>
      <FeatureStrip />
      <PathRow />
      <SocialProof />
    </section>
  );
}

function FintechDashboardPreview() {
  return (
    <div className="grid min-h-[660px] overflow-hidden rounded-[34px] border border-white/10 bg-slate-950 shadow-[0_40px_140px_rgba(37,99,235,0.18)] lg:grid-cols-[74px_1fr]">
      <aside className="hidden border-r border-white/10 bg-white/[0.04] p-4 lg:block">
        <div className="mb-8 grid h-11 w-11 place-items-center rounded-2xl bg-blue-500 text-sm font-black text-white">TQ</div>
        <div className="space-y-3">
          {["M", "P", "X", "R", "C", "S"].map((item, index) => (
            <div key={item} className={`grid h-10 w-10 place-items-center rounded-xl text-xs font-black ${index === 0 ? "bg-blue-500/20 text-blue-300" : "text-slate-500"}`}>
              {item}
            </div>
          ))}
        </div>
      </aside>
      <div className="p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-xl font-black text-white">Fintech Console</p>
            <p className="text-sm text-slate-400">Баланс, checkpoint, сделки и отчёты</p>
          </div>
          <span className="rounded-full bg-emerald-500/15 px-4 py-2 text-xs font-black text-emerald-300">Прогресс активен</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-white">Market overview</p>
                <p className="mt-1 text-xs text-slate-400">BTC/USDT - sandbox</p>
              </div>
              <span className="text-sm font-black text-emerald-300">+1.48%</span>
            </div>
            <div className="mt-5 h-72 rounded-2xl bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[length:48px_36px]" />
          </div>
          <div className="grid gap-4">
            {[
              ["Balance", "$2 500", "checkpoint completed"],
              ["Level", "2", "420 / 700 XP"],
              ["Rank", "Top 24%", "active learners"],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
                <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-white">{value}</p>
                <p className="mt-1 text-xs text-slate-400">{hint}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_0.8fr_0.8fr]">
          <TaskPanelDark />
          <LeaderboardDark />
          <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
            <p className="font-black text-white">Next reward</p>
            <p className="mt-3 text-2xl font-black text-blue-300">Аналитический канал</p>
            <p className="mt-2 text-sm text-slate-400">Откроется после отчёта наставнику</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaderboardDark() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
      <p className="font-black text-white">Leaderboard</p>
      <div className="mt-4 space-y-3">
        {leaderboard.map(([name, xp], index) => (
          <div key={name} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-bold text-white">{index + 1}. {name}</span>
            <span className="text-xs text-slate-400">{xp}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureStrip({ light = false }: { light?: boolean }) {
  return (
    <div className={light ? "mt-8 grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:grid-cols-4 xl:grid-cols-7" : "mt-8 grid overflow-hidden rounded-3xl border border-white/10 bg-white/[0.05] md:grid-cols-4 xl:grid-cols-7"}>
      {featureItems.map((item, index) => (
        <div key={item} className={light ? "border-b border-slate-200 p-4 md:border-r xl:border-b-0" : "border-b border-white/10 p-4 md:border-r xl:border-b-0"}>
          <p className={light ? "text-xs font-black text-blue-600" : "text-xs font-black text-blue-300"}>{String(index + 1).padStart(2, "0")}</p>
          <p className={light ? "mt-2 text-sm font-black text-slate-950" : "mt-2 text-sm font-black text-white"}>{item}</p>
        </div>
      ))}
    </div>
  );
}

function PathRow({ light = false }: { light?: boolean }) {
  return (
    <div className="mt-8 grid gap-4 md:grid-cols-4">
      {pathItems.map(([step, title, description], index) => (
        <div key={title} className={light ? "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" : "rounded-3xl border border-white/10 bg-white/[0.05] p-5"}>
          <div className={index < 2 ? "grid h-11 w-11 place-items-center rounded-full bg-blue-600 text-sm font-black text-white" : light ? "grid h-11 w-11 place-items-center rounded-full bg-slate-200 text-sm font-black text-slate-500" : "grid h-11 w-11 place-items-center rounded-full bg-white/10 text-sm font-black text-slate-400"}>
            {step}
          </div>
          <p className={light ? "mt-4 font-black text-slate-950" : "mt-4 font-black text-white"}>{title}</p>
          <p className={light ? "mt-2 text-sm leading-6 text-slate-600" : "mt-2 text-sm leading-6 text-slate-400"}>{description}</p>
        </div>
      ))}
    </div>
  );
}

function GamifiedPath() {
  return (
    <div className="mt-8 rounded-[32px] border border-indigo-200 bg-white p-5 shadow-sm theme-dark:border-indigo-900 theme-dark:bg-slate-950">
      <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-600">Progress path</p>
      <div className="mt-5 grid gap-4 md:grid-cols-4">
        {pathItems.map(([step, title, description], index) => (
          <div key={title} className={`rounded-3xl p-5 ${index < 2 ? "bg-indigo-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-950 theme-dark:border-slate-800 theme-dark:bg-slate-900 theme-dark:text-white"}`}>
            <p className="text-sm font-black opacity-80">{step}</p>
            <p className="mt-3 text-lg font-black">{title}</p>
            <p className="mt-2 text-sm leading-6 opacity-75">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SocialProof({ light = false }: { light?: boolean }) {
  return (
    <div className={light ? "mt-8 grid gap-4 lg:grid-cols-[1fr_0.8fr_0.8fr]" : "mt-8 grid gap-4 lg:grid-cols-[1fr_0.8fr_0.8fr]"}>
      <div className={light ? "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" : "rounded-3xl border border-white/10 bg-white/[0.05] p-6"}>
        <p className={light ? "text-sm font-black uppercase tracking-[0.16em] text-blue-600" : "text-sm font-black uppercase tracking-[0.16em] text-blue-300"}>Testimonial</p>
        <p className={light ? "mt-4 text-2xl font-black text-slate-950" : "mt-4 text-2xl font-black text-white"}>Наконец понятно, что делать дальше.</p>
        <p className={light ? "mt-3 text-sm leading-6 text-slate-600" : "mt-3 text-sm leading-6 text-slate-400"}>Путь, отчёты и проверка наставником дают ощущение системы, а не случайного курса.</p>
      </div>
      {stats.slice(0, 2).map(([value, label]) => (
        <div key={label} className={light ? "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" : "rounded-3xl border border-white/10 bg-white/[0.05] p-6"}>
          <p className={light ? "text-4xl font-black text-slate-950" : "text-4xl font-black text-white"}>{value}</p>
          <p className={light ? "mt-2 text-sm font-bold text-slate-500" : "mt-2 text-sm font-bold text-slate-400"}>{label}</p>
        </div>
      ))}
    </div>
  );
}

export default function DesignLabPage() {
  return (
    <div className="space-y-8 pb-10">
      <section className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.10)] theme-dark:border-slate-800 theme-dark:bg-slate-950">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Design Lab</p>
        <h1 className="mt-4 max-w-5xl text-4xl font-black leading-[0.95] tracking-[-0.055em] text-slate-950 md:text-7xl theme-dark:text-white">
          Три направления перед переносом в production
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600 theme-dark:text-slate-300">
          Это изолированная страница для выбора визуального направления. Она не добавлена в navigation,
          не меняет production landing и не трогает backend/API/Prisma.
        </p>
      </section>

      <LabTopNav />

      <div className="space-y-10">
        <ConceptA />
        <ConceptB />
        <ConceptC />
      </div>
    </div>
  );
}
