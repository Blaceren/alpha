"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdminEmpty,
  AdminFilters,
  AdminPageHeader,
  AdminSection,
  AdminSelect,
  AdminShell,
  AdminTable,
  StatusBadge,
} from "@/components/admin-ui";
import {
  supportDialogStatuses,
  supportStatusLabels,
  type SupportDialog,
  type SupportDialogStatus,
} from "@/types/support";

export function SupportPanel() {
  const [selectedStatus, setSelectedStatus] =
    useState<"all" | SupportDialogStatus>("all");
  const [dialogs, setDialogs] = useState<SupportDialog[]>([]);
  const [actionMessage, setActionMessage] = useState("Загрузка...");

  const loadDialogs = useCallback(async () => {
    const query = selectedStatus === "all" ? "" : `?status=${selectedStatus}`;

    try {
      const response = await fetch(`/api/support/dialogs${query}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        setActionMessage("Не удалось загрузить диалоги саппорта.");
        return;
      }

      const result = (await response.json()) as { dialogs: SupportDialog[] };
      setDialogs(result.dialogs);
      setActionMessage("");
    } catch {
      setActionMessage("API саппорта недоступно.");
    }
  }, [selectedStatus]);

  useEffect(() => {
    loadDialogs();
  }, [loadDialogs]);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Саппорт"
        description="Очередь диалогов команды платформы. Этот раздел отделён от чата с ментором."
        breadcrumbs={[{ label: "Саппорт" }]}
      />

      <AdminSection>
        <p className="text-sm text-[var(--text-secondary)]">
          Личные сообщения между пользователями не входят в MVP. Здесь пользователь общается только с командой платформы.
        </p>
      </AdminSection>

      <AdminFilters>
        <label className="min-w-56 flex-1 text-sm font-semibold text-[var(--text-secondary)]">
          Статус
          <AdminSelect
            value={selectedStatus}
            onChange={(event) =>
              setSelectedStatus(event.target.value as "all" | SupportDialogStatus)
            }
          >
            <option value="all">Все статусы</option>
            {supportDialogStatuses.map((status) => (
              <option key={status} value={status}>
                {supportStatusLabels[status]}
              </option>
            ))}
          </AdminSelect>
        </label>
        <StatusBadge value={`${dialogs.length} диалогов`} />
      </AdminFilters>

      {actionMessage ? <p className="text-sm font-medium text-[var(--text-secondary)]">{actionMessage}</p> : null}

      {dialogs.length === 0 && !actionMessage ? <AdminEmpty label="Для этого фильтра диалогов нет." /> : null}

      {dialogs.length > 0 ? (
        <AdminTable>
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Уровень</th>
              <th>Шаг</th>
              <th>Статус</th>
              <th>Назначен</th>
              <th>Последнее сообщение</th>
              <th>Обновлено</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {dialogs.map((dialog) => (
              <tr key={dialog.id}>
                <td className="font-bold text-[var(--text-primary)]">{dialog.userName}</td>
                <td>{dialog.userLevel}</td>
                <td>{dialog.currentStep}</td>
                <td><StatusBadge value={supportStatusLabels[dialog.status]} /></td>
                <td>{dialog.assignedTo?.name ?? "Не назначен"}</td>
                <td className="max-w-64">{dialog.lastMessage}</td>
                <td>{new Date(dialog.lastMessageAt).toLocaleString("ru-RU")}</td>
                <td>
                  <Link href={`/support/dialogs/${dialog.id}`}>
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      ) : null}
    </AdminShell>
  );
}
