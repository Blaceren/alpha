"use client";

/**
 * The pieces every Community surface shares.
 *
 * The AUTHOR CHIP and the QUESTION BODY are Direction A's atom, and they are
 * defined once so Home, a space and a thread cannot describe the same person or
 * the same removed post differently.
 */
import * as React from "react";
import type { CommunityAuthor, CommunityBody } from "@/lib/community/community-client";

/**
 * A time a learner can read, in their own timezone.
 *
 * `Intl` with an explicit locale rather than `toLocaleString()` with none: the
 * runtime default is whatever the browser says, and a Russian-language product
 * rendering `8/16/2026, 6:41 PM` is the same class of defect DD-311 recorded
 * for the journal's date inputs.
 */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * The author, as Community is allowed to describe a person: a name, an approved
 * public role label if they have one, and a module number if they are a learner.
 *
 * There is no avatar, no rank, no XP and no count. The order is deliberate —
 * the NAME leads, and the module is a coordinate after it, not a badge before.
 */
export function AuthorChip({ author }: { author: CommunityAuthor }) {
  return (
    <span className="cm-coords">
      <span>{author.displayName}</span>
      {author.isViewer ? <span>· вы</span> : null}
      {author.roleLabel ? <span className="cm-coords__role">· {author.roleLabel}</span> : null}
      {author.moduleNumber !== null ? <span>· модуль {author.moduleNumber}</span> : null}
    </span>
  );
}

/**
 * Learner-authored text, or the tombstone that replaces it.
 *
 * RENDERED AS TEXT. React escapes it, there is no `dangerouslySetInnerHTML`
 * anywhere in this feature, and no markdown renderer is imported. A URL a
 * learner types is characters, not a link: Community is not a promotional link
 * directory, and nothing here auto-embeds anything.
 *
 * The removed case never receives the original body — the server does not send
 * it — so this cannot leak it by rendering the wrong branch.
 */
export function Body({ body }: { body: CommunityBody }) {
  if (body.kind === "removed") {
    return (
      <p className="cm-body cm-body--removed">
        {body.removedBy === "author"
          ? "Автор удалил это сообщение."
          : "Сообщение скрыто модератором."}
      </p>
    );
  }
  return <p className="cm-body">{body.text}</p>;
}

/** A refusal the learner can act on. Never a raw server message. */
export function ErrorNote({ text }: { text: string }) {
  return (
    <p className="cm-note cm-note--error" role="alert">
      {text}
    </p>
  );
}

export function OkNote({ text }: { text: string }) {
  return (
    <p className="cm-note cm-note--ok" role="status">
      {text}
    </p>
  );
}

/**
 * The learner-facing meaning of a normalized API error.
 *
 * It switches on `category`, which is a closed enum and always present, NOT on
 * `code`, which is an optional Backend string and null on every transport
 * failure. An unmapped category gets a calm generic sentence.
 *
 * The Backend's own text is never shown. `code` is consulted only to sharpen
 * one message where the distinction matters to the learner: a refusal because
 * a space is not open yet reads differently from a refusal because the account
 * is not allowed.
 */
export function errorText(
  error: { category: string; code: string | null },
  fallback = "Не удалось выполнить действие. Попробуйте ещё раз.",
): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с сервисом. Проверьте соединение и попробуйте ещё раз.";
    case "UNAUTHENTICATED":
      return "Сессия истекла. Войдите заново.";
    case "FORBIDDEN":
      return error.code === "COMMUNITY_FORBIDDEN"
        ? "Это пространство пока не открыто для вас."
        : "Доступ к этому разделу закрыт.";
    case "NOT_FOUND":
      return "Обсуждение не найдено или больше недоступно.";
    case "VALIDATION_ERROR":
      return "Проверьте заполнение полей.";
    case "CONFLICT":
      return "Это сообщение уже изменилось. Обновите страницу.";
    case "RATE_LIMITED":
      return "Слишком много сообщений подряд. Подождите немного и попробуйте снова.";
    case "MALFORMED_RESPONSE":
      return "Сервис вернул неожиданный ответ. Данные не показаны, чтобы не ввести в заблуждение.";
    case "CONFIGURATION_ERROR":
      return "Сервис временно недоступен.";
    default:
      return fallback;
  }
}

/**
 * The loading state.
 *
 * It carries no titles and no numbers, so a slow load cannot appear to state a
 * position or an activity level the learner does not have.
 */
export function CommunitySkeleton({
  heading = "Сообщество",
  plates = 1,
  lines = 3,
}: {
  heading?: string;
  plates?: number;
  lines?: number;
}) {
  return (
    <div className="cm" aria-busy="true" aria-live="polite">
      {/* The heading is present from the first paint. Every other Academy
          surface has one while it loads, and a page whose h1 appears only after
          a fetch has no accessible name for a screen reader in the meantime and
          visibly reflows for everyone else. */}
      <div className="cm__head">
        <h1>{heading}</h1>
      </div>
      <p className="cm-note cm-note--muted">Загружаем сообщество…</p>
      {Array.from({ length: plates }, (_, i) => (
        <div key={`p${i}`} className="cm-skeleton cm-skeleton--plate" />
      ))}
      {Array.from({ length: lines }, (_, i) => (
        <div key={`l${i}`} className="cm-skeleton cm-skeleton--line" />
      ))}
    </div>
  );
}
