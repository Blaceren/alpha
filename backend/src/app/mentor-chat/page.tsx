"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Alert, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { csrfFetch } from "@/lib/api";

type MentorMessage = {
  id: number;
  senderRole: string;
  message: string;
  createdAt: string;
};

type MentorDialog = {
  id: number;
  status: string;
  unlockReason?: string | null;
  messages: MentorMessage[];
};

type MentorDialogSummary = { id: number; status: string; user: { name: string; email: string; level: number } };

function roleLabel(role: string) {
  if (role === "mentor") return "Ментор";
  if (role === "admin") return "Админ";
  if (role === "support") return "Саппорт";
  return "Вы";
}

export default function MentorChatPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [dialog, setDialog] = useState<MentorDialog | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [staff, setStaff] = useState(false);
  const [dialogs, setDialogs] = useState<MentorDialogSummary[]>([]);

  async function load(dialogId?: number) {
    const response = await fetch(`/api/mentor-chat${dialogId ? `?dialogId=${dialogId}` : ""}`, { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as { unlocked: boolean; staff?: boolean; dialogs?: MentorDialogSummary[]; dialog: MentorDialog };
    setUnlocked(result.unlocked);
    setDialog(result.dialog);
    setStaff(Boolean(result.staff));
    setDialogs(result.dialogs ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    const trimmed = message.trim();
    if (!trimmed) return;

    const response = await csrfFetch("/api/mentor-chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed, dialogId: staff ? dialog?.id : undefined }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      setStatus(result.message ?? "Не удалось отправить сообщение");
      return;
    }

    setMessage("");
    await load();
  }

  return (
    <ProtectedPage allowedRoles={["user", "admin", "mentor"]}>
      <div className="space-y-6">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Главная" }, { href: "/chat", label: "Сообщество" }, { label: "Менторский чат" }]} />
        <PageHeader
          kicker="Наставник"
          title="Чат с ментором"
          description="Отдельный диалог пользователя с командой платформы. Личные сообщения между пользователями не реализованы."
          action={<StatusPill>{unlocked ? "доступ открыт" : "доступ закрыт"}</StatusPill>}
        />

        {!unlocked ? (
          <Card className="dashboard-primary">
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <h2 className="section-title">Ментор-чат пока заблокирован</h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  Доступ открывается после First Deposit или завершения шага 4. Пока можно пользоваться общим чатом и саппорт-виджетом.
                </p>
                {dialog?.unlockReason ? (
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{dialog.unlockReason}</p>
                ) : null}
              </div>
              <Link href="/tasks" className="btn btn-primary">
                Открыть задания
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <Card>
              {staff && dialogs.length ? (
                <label className="mb-4 block text-sm font-bold text-[var(--text-secondary)]">
                  User dialog
                  <select className="form-input mt-2" value={dialog?.id ?? ""} onChange={(event) => load(Number(event.target.value))}>
                    {dialogs.map((item) => <option key={item.id} value={item.id}>{item.user.name} / {item.user.email} / level {item.user.level}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">История диалога</h2>
                <StatusPill>{dialog?.status ?? "активен"}</StatusPill>
              </div>
              <div className="max-h-[500px] space-y-3 overflow-y-auto">
                {dialog?.messages.length ? (
                  dialog.messages.map((item) => (
                    <article key={item.id} className="chat-message rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 shadow-[var(--shadow-sm)]">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <span className="font-black text-[var(--text-primary)]">{roleLabel(item.senderRole)}</span>
                        <span>{new Date(item.createdAt).toLocaleString("ru-RU")}</span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--text-secondary)]">{item.message}</p>
                    </article>
                  ))
                ) : (
                  <EmptyState label="Сообщений пока нет" />
                )}
              </div>

              <form onSubmit={send} className="mt-5 space-y-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
                <label className="block text-sm font-bold text-[var(--text-secondary)]">
                  Сообщение ментору
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    className="form-input mt-2"
                    rows={3}
                    placeholder="Опишите вопрос по заданию или сделке"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" type="submit">
                    Отправить
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">Файлы в mentor chat не входят в MVP; для вложений используйте саппорт.</span>
                </div>
              </form>
            </Card>

            <aside className="space-y-4">
              <Alert>
                Ментор отвечает в рамках closed testing. Срочные технические вопросы лучше отправлять через виджет саппорта.
              </Alert>
              <Card>
                <h2 className="section-title">Статус</h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">online / ответим позже</p>
              </Card>
            </aside>
          </div>
        )}

        {status ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{status}</p> : null}
      </div>
    </ProtectedPage>
  );
}
