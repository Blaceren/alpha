import { ProtectedContentNotice } from "@/components/ProtectedContentNotice";
import { securityChecklist } from "@/data/mockSecurityChecklist";

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <section>
        <p className="page-kicker">Security</p>
        <h1 className="mt-2 text-3xl font-black text-[var(--text-primary)]">
          Безопасность
        </h1>
        <p className="mt-3 max-w-3xl text-[var(--text-secondary)]">
          Skeleton-страница с чек-листом будущей безопасности проекта.
          Реальные backend-механизмы подключаются отдельно и не менялись в этом дизайн-проходе.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {securityChecklist.map((item) => (
          <article
            key={item.title}
            className="app-card-flat p-5"
          >
            <h2 className="font-semibold text-[var(--text-primary)]">{item.title}</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{item.description}</p>
          </article>
        ))}
      </section>

      <ProtectedContentNotice />
    </div>
  );
}
