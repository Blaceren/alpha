"use client";

import * as React from "react";
import { Bell, Search } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states/empty-state";

/**
 * Global search trigger — Phase 1A opens an honest informational placeholder,
 * NOT a faked working search (command palette / user search arrive later).
 */
export function GlobalSearchTrigger() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="hidden items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-text-muted hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span>Поиск…</span>
          <kbd className="ml-2 rounded border border-border px-1 text-2xs text-text-muted">⌘K</kbd>
        </button>
      </DialogTrigger>
      <DialogContent
        title="Глобальный поиск"
        description="Командная палитра и поиск пользователей появятся на следующих этапах."
      >
        <EmptyState
          title="Поиск ещё не подключён"
          description="В Phase 1A это заглушка. Позже здесь будет поиск по пользователям, разделам и действиям (⌘K)."
        />
      </DialogContent>
    </Dialog>
  );
}

/** Notifications trigger — informational placeholder in Phase 1A. */
export function NotificationsTrigger() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <IconButton label="Уведомления">
          <Bell className="h-4 w-4" aria-hidden />
        </IconButton>
      </DialogTrigger>
      <DialogContent
        title="Уведомления"
        description="Реальные уведомления появятся вместе с интеграцией."
      >
        <EmptyState
          title="Нет уведомлений"
          description="В demo-режиме уведомления не генерируются. Это заглушка, а не рабочая функция."
        />
      </DialogContent>
    </Dialog>
  );
}
