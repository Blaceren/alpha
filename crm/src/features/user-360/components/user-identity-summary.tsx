import * as React from "react";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { User360Identity } from "@/domain/users/user-360";

/**
 * Renders ONLY the provider's identity projection. The full email exists in the
 * payload solely for roles the provider grants it to (D-11) — nothing here is
 * hidden by CSS, and no forbidden value is placed in title/aria/data attributes.
 */
export function UserIdentitySummary({ identity }: { identity: User360Identity }) {
  const p = identity.projection;

  // Masked/pseudonymous/hidden all read correctly for a screen reader: the
  // visible text is the whole truth for this role.
  const contact =
    p.mode === "full" || p.mode === "masked"
      ? p.email
      : p.mode === "pseudonymous"
        ? p.pseudonymId
        : null;

  const contactHint =
    p.mode === "full"
      ? "Полный email доступен вашей роли"
      : p.mode === "masked"
        ? "Email скрыт: доступна только маскированная форма"
        : p.mode === "pseudonymous"
          ? "Обезличенный идентификатор"
          : "Идентификация недоступна для вашей роли";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-text-muted">
      {contact ? (
        <Tooltip content={contactHint} side="bottom">
          <span className="truncate font-mono">{contact}</span>
        </Tooltip>
      ) : (
        <span className="truncate italic">{contactHint}</span>
      )}

      {p.mode !== "hidden" && p.mode !== "pseudonymous" ? (
        <Tooltip
          content={
            identity.emailConfirmed
              ? "Email аккаунта Alfa Trade Academy подтверждён"
              : "Email аккаунта Alfa Trade Academy не подтверждён (не связано с регистрацией Pocket)"
          }
          side="bottom"
        >
          <span
            className={
              identity.emailConfirmed
                ? "inline-flex items-center gap-0.5 text-success"
                : "inline-flex items-center gap-0.5 text-warning"
            }
          >
            {identity.emailConfirmed ? (
              <BadgeCheck className="h-3 w-3" aria-hidden />
            ) : (
              <CircleAlert className="h-3 w-3" aria-hidden />
            )}
            {identity.emailConfirmed ? "email подтверждён" : "email не подтверждён"}
          </span>
        </Tooltip>
      ) : null}

      {identity.country ? (
        <span className="truncate">
          · {identity.country}
          {identity.locale ? ` · ${identity.locale}` : ""}
        </span>
      ) : null}
    </div>
  );
}
