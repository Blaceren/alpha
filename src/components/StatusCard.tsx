type StatusCardProps = {
  title: string;
  value: string;
};

export function StatusCard({ title, value }: StatusCardProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium uppercase text-slate-500">{title}</h2>
      <div className="mt-3 text-lg font-semibold text-slate-950">{value}</div>
    </section>
  );
}
