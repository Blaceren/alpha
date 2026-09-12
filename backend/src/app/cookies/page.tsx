import { cookieCategories } from "@/data/mockLegalContent";

export default function CookiesPage() {
  return (
    <div className="space-y-6">
      <section>
        <p className="page-kicker">Legal</p>
        <h1 className="mt-2 text-3xl font-black text-[var(--text-primary)]">Cookies</h1>
        <p className="mt-3 max-w-3xl text-[var(--text-secondary)]">
          Cookies помогают сайту запоминать настройки пользователя и корректно работать между переходами по страницам.
          На текущем этапе это skeleton/mock-логика без отдельного backend-центра согласий.
        </p>
      </section>

      <section className="app-card-flat p-5">
        <h2 className="section-title">
          Какие категории используются
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {cookieCategories.map((category) => (
            <article
              key={category.title}
              className="rounded-lg border border-[var(--border)] p-4"
            >
              <h3 className="font-semibold text-[var(--text-primary)]">
                {category.title}
              </h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {category.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="app-card-flat p-5">
        <h2 className="section-title">
          Как изменить согласие
        </h2>
        <p className="mt-3 text-[var(--text-secondary)]">
          Сейчас выбор сохраняется в localStorage браузера. Чтобы изменить согласие,
          пользователь может очистить данные сайта в браузере, после чего cookie banner появится снова.
          Позже здесь может появиться полноценный центр управления согласием.
        </p>
      </section>
    </div>
  );
}
