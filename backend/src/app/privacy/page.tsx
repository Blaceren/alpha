import { privacyCollectedData } from "@/data/mockLegalContent";

export default function PrivacyPage() {
  return (
    <div className="space-y-6">
      <section>
        <p className="page-kicker">Legal</p>
        <h1 className="mt-2 text-3xl font-black text-[var(--text-primary)]">
          Политика конфиденциальности
        </h1>
        <p className="mt-3 max-w-3xl text-[var(--text-secondary)]">
          Эта страница описывает будущую структуру обработки данных в платформе.
          Сейчас данные используются в MVP-режиме и проверяются через локальные smoke-сценарии.
        </p>
      </section>

      <section className="app-card-flat p-5">
        <h2 className="section-title">
          Какие данные могут собираться
        </h2>
        <ul className="mt-4 grid gap-2 text-[var(--text-secondary)] sm:grid-cols-2">
          {privacyCollectedData.map((item) => (
            <li key={item} className="rounded-lg border border-[var(--border)] p-3">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="app-card-flat p-5">
        <h2 className="section-title">
          Как используются данные
        </h2>
        <p className="mt-3 text-[var(--text-secondary)]">
          Данные нужны для отображения личного кабинета, расчёта прогресса,
          работы уровней, подтверждения событий биржи, истории наград,
          CRM-когорт и связи с пользователем по обучающим сценариям.
        </p>
      </section>

      <section className="app-card-flat p-5">
        <h2 className="section-title">
          Удаление и анонимизация
        </h2>
        <p className="mt-3 text-[var(--text-secondary)]">
          Пользователь сможет запросить удаление или анонимизацию данных. В backend-версии
          для этого будет отдельный процесс обработки запроса и фиксации результата.
        </p>
      </section>
    </div>
  );
}
