"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { CrmError } from "@/data/contracts/result";

export interface ErrorStateProps {
  title?: string;
  error?: CrmError | null;
  onRetry?: () => void;
  className?: string;
}

/** Maps a CrmError code to a human message and offers retry when retriable. */
export function ErrorState({ title, error, onRetry, className }: ErrorStateProps) {
  const message = error ? messageForCode(error) : "Что-то пошло не так.";
  const canRetry = Boolean(onRetry) && (error?.retriable ?? true);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
      <p className="text-sm font-medium text-text-primary">{title ?? "Ошибка загрузки"}</p>
      <p className="max-w-sm text-xs text-text-secondary">{message}</p>
      {canRetry ? (
        <Button variant="secondary" size="sm" className="mt-1" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}

function messageForCode(error: CrmError): string {
  switch (error.code) {
    case "unauthorized":
      return "Недостаточно прав для просмотра этих данных.";
    case "not_found":
      return "Данные не найдены.";
    case "invalid_input":
      return "Некорректный запрос.";
    case "rate_limited":
      return "Слишком много запросов, попробуйте позже.";
    case "upstream_unavailable":
      return "Источник данных недоступен. Повторите попытку.";
    case "stale_data":
      return "Данные устарели.";
    case "conflict":
      return "Обнаружено расхождение данных.";
    case "internal":
    default:
      return error.message || "Внутренняя ошибка.";
  }
}
