type TaskCardProps = {
  title: string;
  task: string;
  status: string;
};

export function TaskCard({ title, task, status }: TaskCardProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <span className="text-sm font-medium text-slate-500">{status}</span>
      </div>
      <p className="mt-4 text-slate-700">{task}</p>
    </section>
  );
}
