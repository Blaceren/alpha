/**
 * AFFILIATE-PLATFORM-V1 — the label layer for the commercial staff surfaces.
 *
 * EVERY MACHINE CODE PASSES THROUGH HERE, and an unrecognised one renders as
 * ITSELF rather than as a friendly invention. That is the same rule the
 * affiliate availability layer already follows: a missing label must be
 * visible, because a reassuring sentence substituted for an unknown state is
 * how an operator ends up trusting a screen that is wrong.
 */

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "Ожидает отправки",
  delivered: "Доставлено",
  failed_retryable: "Ошибка · будет повтор",
  failed_terminal: "Ошибка · попытки исчерпаны",
};

export const ATTEMPT_OUTCOME_LABEL: Record<string, string> = {
  delivered: "Доставлено (2xx)",
  http_4xx: "Отказ получателя (4xx)",
  http_5xx: "Ошибка получателя (5xx)",
  http_other: "Иной HTTP-статус",
  timeout: "Таймаут",
  connect_error: "Нет соединения",
  dns_error: "Ошибка DNS",
  blocked_destination: "Адрес заблокирован политикой",
  too_many_redirects: "Слишком много редиректов",
  response_too_large: "Ответ превысил лимит",
  endpoint_disabled: "Назначение отключено",
};

export const CONVERSION_TYPE_LABEL: Record<string, string> = {
  academy_registration: "REG",
  first_deposit: "DEP",
  redeposit: "RDEP",
};

export const TERMS_STATUS_LABEL: Record<string, string> = {
  active: "Действует",
  superseded: "Заменена",
};

export const PRINCIPAL_STATUS_LABEL: Record<string, string> = {
  active: "Активен",
  disabled: "Отключён",
};

export function labelFor(map: Record<string, string>, code: string | null): string {
  if (code === null) return "—";
  return map[code] ?? code;
}

/**
 * Render a money value WITH its unit, and refuse to invent one.
 *
 * A provider amount whose currency the provider never stated renders as the
 * number plus an explicit note. §23 and §51: a bare number beside a currency
 * symbol somebody assumed is the failure this function exists to prevent.
 */
export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount === null) return "—";
  return currency === null ? `${amount} (валюта не указана провайдером)` : `${amount} ${currency}`;
}

/** ISO-8601 to something a human reads, without inventing a timezone. */
export function formatInstant(value: string | null): string {
  if (value === null) return "—";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}
