type ProgressCardProps = {
  level: number;
  xp: {
    current: number;
    target: number;
  };
};

export function ProgressCard({ level, xp }: ProgressCardProps) {
  const progress = Math.min(Math.round((xp.current / xp.target) * 100), 100);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-950">Текущий уровень</h2>
      <div className="mt-3 text-3xl font-semibold text-slate-950">
        Уровень {level}
      </div>
      <div className="mt-5">
        <div className="flex justify-between text-sm text-slate-600">
          <span>Прогресс XP</span>
          <span>
            {xp.current} / {xp.target}
          </span>
        </div>
        <div className="mt-2 h-2 rounded bg-slate-100">
          <div
            className="h-2 rounded bg-slate-900"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </section>
  );
}
