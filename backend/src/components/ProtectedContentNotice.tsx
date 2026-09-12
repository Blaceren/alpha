export function ProtectedContentNotice() {
  return (
    <section className="app-card-flat p-5">
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">
        Защита контента
      </h2>
      <p className="mt-2 text-[var(--text-secondary)]">
        Запись, копирование и распространение материалов запрещены.
      </p>
      <div className="mt-4 grid gap-2 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
        <p>
          Email:{" "}
          <span className="font-medium text-[var(--text-primary)]">
            доступен только в авторизованном кабинете
          </span>
        </p>
        <p>
          User ID:{" "}
          <span className="font-medium text-[var(--text-primary)]">не публикуется на открытой странице</span>
        </p>
      </div>
    </section>
  );
}
