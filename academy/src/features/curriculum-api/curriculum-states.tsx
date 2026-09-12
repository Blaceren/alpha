import type { ReactNode } from "react";
import type { CurriculumReadError, CurriculumErrorCategory } from "@/lib/curriculum/read-errors";
import { RetryButton } from "@/features/curriculum-api/retry-button";

/**
 * Bounded, honest state screens for curriculum reads. No raw JSON; a support
 * request id is shown when present; retry is offered ONLY for retryable
 * network/backend failures. A disabled feature reads as "not activated",
 * never as "no lessons".
 *
 * THE HEADING LEVEL IS THE CALLER'S TO DECLARE, AND DEFAULTS TO WHAT IT WAS.
 * These screens are used two ways. Inside a surface that already has its own
 * `h1`, the state is a section of that page and `h2` is correct — that is every
 * existing caller and it is the default, so none of them change. But on a route
 * where the state IS the whole page, as on the level detail read failures, an
 * `h2` leaves the document with no `h1` at all and the page announces itself
 * with no title. Those callers pass `headingLevel="h1"`.
 *
 * Only the tag changes. The copy, the role, the live region, the retry rule and
 * the request id are identical either way, and nothing hidden is added — the
 * one heading on the page is the one the reader can see.
 */

type HeadingLevel = "h1" | "h2";

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

export function CurriculumErrorState({
  error,
  headingLevel = "h2",
}: {
  error: CurriculumReadError;
  headingLevel?: HeadingLevel;
}) {
  const copy = COPY[error.category];
  const Heading = headingLevel;
  return (
    <section className="cur-state" role="status" aria-live="polite">
      <Heading className="cur-state__title">{copy.title}</Heading>
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
  headingLevel = "h2",
}: {
  title: string;
  message: string;
  children?: ReactNode;
  headingLevel?: HeadingLevel;
}) {
  const Heading = headingLevel;
  return (
    <section className="cur-state" role="status">
      <Heading className="cur-state__title">{title}</Heading>
      <p className="cur-state__message">{message}</p>
      {children}
    </section>
  );
}
