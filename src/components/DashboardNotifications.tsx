"use client";

import { useEffect, useState } from "react";
import { updateNotificationSettings } from "@/lib/api";

type DashboardNotificationsProps = {
  initialSettings: {
    email: boolean;
    webPush: boolean;
    telegramBot: boolean;
  };
};

export function DashboardNotifications({
  initialSettings,
}: DashboardNotificationsProps) {
  const [settings, setSettings] = useState(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  function toggleSetting(key: keyof typeof settings) {
    setSettings((currentSettings) => {
      const nextSettings = {
        ...currentSettings,
        [key]: !currentSettings[key],
      };

      updateNotificationSettings(nextSettings);

      return nextSettings;
    });
  }

  return (
    <section className="app-card p-5">
      <h2 className="section-title">Настройки уведомлений</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="app-card-interactive flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.email}
            onChange={() => toggleSetting("email")}
          />
          Email
        </label>
        <label className="app-card-interactive flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.webPush}
            onChange={() => toggleSetting("webPush")}
          />
          Web-push
        </label>
        <label className="app-card-interactive flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.telegramBot}
            onChange={() => toggleSetting("telegramBot")}
          />
          Telegram-бот
        </label>
      </div>
    </section>
  );
}
