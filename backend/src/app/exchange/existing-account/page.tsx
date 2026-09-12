import Link from "next/link";
import { Alert, Card, PageHeader } from "@/components/ui";

const steps = [
  "Удалите или закройте старый аккаунт по инструкции Pocket.",
  "Вернитесь на страницу биржи и перейдите по кнопке «Перейти к регистрации».",
  "Зарегистрируйтесь заново по нашей реферальной ссылке.",
  "Дождитесь postback Registration и нажмите «Проверить регистрацию».",
];

export default function ExistingExchangeAccountPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        kicker="Биржа"
        title="Что делать, если уже есть аккаунт Pocket"
        description="По текущему ТЗ прогресс привязывается к регистрации по нашей реферальной ссылке и последующим Pocket postbacks."
      />

      <Card className="premium-preview">
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step} className="instruction-step flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-sm font-black text-[var(--primary)]">
                {index + 1}
              </span>
              <span className="pt-1 text-sm text-[var(--text-secondary)]">{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Alert>
        Видео-инструкция будет добавлена позже. Сейчас это текстовая заглушка для closed testing.
      </Alert>

      <div className="flex flex-wrap gap-3">
        <Link href="/exchange" className="btn btn-primary">
          Назад к бирже
        </Link>
        <Link href="/tasks" className="btn btn-secondary">
          Открыть задания
        </Link>
      </div>
    </section>
  );
}
