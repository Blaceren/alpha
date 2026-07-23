import type { ReactNode } from "react";
import type { CurriculumReadError, CurriculumErrorCategory } from "@/lib/curriculum/read-errors";
import { RetryButton } from "@/features/curriculum-api/retry-button";

/**
 * Bounded, honest state screens for curriculum reads. No raw JSON; a support
 * request id is shown when present; retry is offered ONLY for retryable
 * network/backend failures. A disabled feature reads as "not activated",
 * never as "no lessons".
 */

const COPY: Record<CurriculumErrorCategory, { title: string; message: string }> = {
  UNAUTHENTICATED: { title: "Требуется вход", message: "Войдите, чтобы продолжить обучение." },
  FORBIDDEN: { title: "Нет доступа", message: "Ваш аккаунт сейчас не имеет доступа к обучению." },
  FEATURE_DISABLED: { title: "Раздел ещё не активирован", message: "Учебная программа скоро станет доступна." },
  NO_ACTIVE_CURRICULUM: { title: "Программа готовится", message: "Активная учебная программа пока не опубликована." },
  NOT_ENROLLED: { title: "Вы ещё не зачислены", message: "Зачисление на программу появится позже." },
  LEVEL_NOT_FOUND: { title: "Уровень не найден", message: "Такого уровня нет в текущей программе." },
  LEVEL_LOCKED: { title: "Уровень заблокирован", message: "Этот уровень пока недоступен." },
  UNSUPPORTED_LEVEL_TYPE: { title: "Тип уровня не поддерживается", message: "Этот уровень пока нельзя отобразить." },
  MALFORMED_RESPONSE: { title: "Не удалось прочитать данные", message: "Ответ сервера повреждён. Повторите позже." },
  BACKEND_UNAVAILABLE: { title: "Сервис временно недоступен", message: "Не удалось загрузить программу. Повторите попытку." },
  NETWORK_ERROR: { title: "Проблема соединения", message: "Не удалось связаться с сервисом. Повторите попытку." },
  CONFIGURATION_ERROR: { title: "Раздел временно недоступен", message: "Обучение сейчас недоступно." },
  UNKNOWN_ERROR: { title: "Что-то пошло не так", message: "Не удалось загрузить данные." },
};

export function CurriculumErrorState({ error }: { error: CurriculumReadError }) {
  const copy = COPY[error.category];
  return (
    <section className="cur-state" role="status" aria-live="polite">
      <h2 className="cur-state__title">{copy.title}</h2>
      <p className="cur-state__message">{copy.message}</p>
      {error.retryable ? <RetryButton /> : null}
      {error.requestId ? (
        <p className="cur-state__ref">Код обращения: <span>{error.requestId}</span></p>
      ) : null}
    </section>
  );
}

export function CurriculumInfoState({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <section className="cur-state" role="status">
      <h2 className="cur-state__title">{title}</h2>
      <p className="cur-state__message">{message}</p>
      {children}
    </section>
  );
}
