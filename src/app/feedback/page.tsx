"use client";

import { FormEvent, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { Alert, Card, FormField, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { csrfFetch } from "@/lib/api";

type FeedbackType = "bug" | "ux" | "question" | "idea" | "other";
type FeedbackSeverity = "low" | "medium" | "high" | "blocker";

const typeLabels: Record<FeedbackType, string> = {
  bug: "Ошибка",
  ux: "Неудобство интерфейса",
  question: "Вопрос",
  idea: "Идея",
  other: "Другое",
};

const severityLabels: Record<FeedbackSeverity, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  blocker: "Блокер",
};

export default function FeedbackPage() {
  return (
    <ProtectedPage>
      <FeedbackForm />
    </ProtectedPage>
  );
}

function FeedbackForm() {
  const [type, setType] = useState<FeedbackType>("bug");
  const [severity, setSeverity] = useState<FeedbackSeverity>("medium");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [browserInfo, setBrowserInfo] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    setPageUrl(window.location.href);
    setBrowserInfo(window.navigator.userAgent);
  }, []);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage("");

    const response = await csrfFetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        severity,
        title,
        message,
        pageUrl: pageUrl.trim() || undefined,
        browserInfo: browserInfo.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      setStatusMessage(result.message ?? "Не удалось отправить фидбек");
      setIsSubmitting(false);
      return;
    }

    setIsSuccess(true);
    setIsSubmitting(false);
  }

  if (isSuccess) {
    return (
      <section className="space-y-6">
        <PageHeader
          kicker="Closed testing"
          title="Фидбек отправлен"
          description="Спасибо. Команда увидит сообщение в админке и сможет привязать его к тестовому сценарию."
        />
        <button
          type="button"
          onClick={() => {
            setTitle("");
            setMessage("");
            setStatusMessage("");
            setIsSuccess(false);
          }}
          className="btn btn-primary"
        >
          Отправить ещё
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        kicker="Closed testing"
        title="Сообщить о проблеме"
        description="Опишите ошибку, неудобство или вопрос. Техническая информация о странице прикладывается автоматически."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <form onSubmit={submitFeedback} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Тип">
                <Select value={type} onChange={(event) => setType(event.target.value as FeedbackType)}>
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Важность">
                <Select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as FeedbackSeverity)}
                >
                  {Object.entries(severityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <FormField label="Заголовок">
              <Input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Кратко: что произошло"
              />
            </FormField>

            <FormField label="Сообщение">
              <Textarea
                required
                rows={8}
                maxLength={5000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Опишите шаги, ожидание и фактический результат"
              />
            </FormField>

            <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
              <summary className="cursor-pointer font-bold text-[var(--text-primary)]">Технические данные</summary>
              <FormField label="URL страницы">
                <Input
                  maxLength={1000}
                  value={pageUrl}
                  onChange={(event) => setPageUrl(event.target.value)}
                />
              </FormField>
              <input type="hidden" value={browserInfo} readOnly />
            </details>

            {statusMessage ? <Alert className="border-red-200 bg-red-50 text-red-700">{statusMessage}</Alert> : null}

            <button type="submit" disabled={isSubmitting} className="btn btn-primary disabled:opacity-50">
              {isSubmitting ? "Отправка..." : "Отправить"}
            </button>
          </form>
        </Card>

        <aside className="space-y-4">
          <Alert>
            Блокер - сценарий невозможно пройти. Высокий - мешает тестированию, но есть обходной путь.
          </Alert>
          <Alert>
            Не отправляйте пароли, seed-секреты и личные данные. Для аккаунта достаточно email тестера.
          </Alert>
        </aside>
      </div>
    </section>
  );
}
