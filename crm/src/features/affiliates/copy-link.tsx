"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AffiliateTrackingLink } from "@/data/contracts/api/affiliates";

/**
 * AFD-5A — copying the canonical tracking URL.
 *
 * THE VALUE COPIED IS EXACTLY `link.publicUrl`, AS THE BACKEND SENT IT.
 *
 * There is no `location.host`, no `window.location.origin`, no `document.
 * baseURI` and no origin concatenation in this file. The backend builds the URL
 * from its validated public-origin owner; a URL assembled here from the browser's
 * current host would point wherever the CRM happened to be served from — which
 * on a proxied or attacker-supplied host is a link an operator would then hand
 * to an affiliate.
 *
 * No query string is appended either: no example click id, no placeholder, no
 * tracker macro. The bare canonical link is what an affiliate network is given;
 * the TEMPLATE below is a separate, clearly-labelled display.
 */

/** Announce the result to assistive technology, not just visually. */
function useCopyAnnouncement() {
  const [message, setMessage] = React.useState("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = React.useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 4000);
  }, []);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { message, announce };
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through — reported as a failure, never silently swallowed */
  }
  return false;
}

export interface CopyValueButtonProps {
  value: string;
  label: string;
  /** Spoken confirmation, e.g. "Ссылка скопирована". */
  successMessage: string;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
}

export function CopyValueButton({
  value,
  label,
  successMessage,
  disabled,
  variant = "secondary",
}: CopyValueButtonProps) {
  const { message, announce } = useCopyAnnouncement();
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(async () => {
    const ok = await writeClipboard(value);
    setCopied(ok);
    announce(ok ? successMessage : "Не удалось скопировать. Скопируйте значение вручную.");
    if (ok) setTimeout(() => setCopied(false), 2000);
  }, [announce, successMessage, value]);

  return (
    <>
      <Button type="button" variant={variant} onClick={onCopy} disabled={disabled}>
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        {label}
      </Button>
      {/* Polite live region: the copy result is announced, not only shown. */}
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  );
}

/**
 * The canonical link block: the URL itself, a copy action, and — when the link
 * would not actually serve traffic — an explicit warning that traffic must not
 * be sent to it yet. Archived links stay visible for historical reference.
 */
export function CanonicalLinkBlock({ link }: { link: AffiliateTrackingLink }) {
  const serving = link.publicRouteState === "serving";

  return (
    <div className="space-y-2">
      <div>
        <p className="text-2xs font-medium uppercase tracking-wide text-text-secondary">
          Публичный путь
        </p>
        <code className="mt-1 block break-all rounded-sm border border-border bg-surface px-2 py-1 font-mono text-xs text-text-primary">
          {link.publicPath}
        </code>
      </div>

      {link.publicUrl ? (
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-text-secondary">
            Каноническая ссылка
          </p>
          <code
            data-testid="affiliate-canonical-url"
            className="mt-1 block break-all rounded-sm border border-border bg-surface px-2 py-1 font-mono text-xs text-text-primary"
          >
            {link.publicUrl}
          </code>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyValueButton
              value={link.publicUrl}
              label="Скопировать ссылку"
              successMessage="Ссылка скопирована в буфер обмена"
            />
          </div>
          {!serving ? (
            <p
              role="status"
              className="mt-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-text-primary"
            >
              Ссылку можно скопировать, но она сейчас не принимает трафик. Не передавайте её
              партнёру, пока состояние не станет «Принимает трафик».
            </p>
          ) : null}
        </div>
      ) : (
        <p
          role="status"
          className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
        >
          Каноническая ссылка недоступна: в этой среде не настроен публичный адрес приложения.
          Показан только путь — собирать URL вручную нельзя.
        </p>
      )}
    </div>
  );
}

/**
 * The tracker template, shown separately and labelled as such.
 *
 * `{affiliate_click_id}` is a PLACEHOLDER WE OWN, deliberately not any specific
 * network's macro syntax: guessing between `{clickid}`, `${SUBID}`, `[clickid]`
 * and the dozens of other tracker dialects would produce a link that silently
 * records a literal string instead of a click id. The operator substitutes
 * their own network's macro.
 *
 * This is never what the canonical copy action copies.
 */
export function TrackerTemplateBlock({ link }: { link: AffiliateTrackingLink }) {
  const base = link.publicUrl ?? link.publicPath;
  const template = `${base}?${link.externalClickParameter}={affiliate_click_id}`;

  const subs = (["sub1", "sub2", "sub3", "sub4", "sub5"] as const)
    .map((key) => ({ key, name: link.subParameters[key] }))
    .filter((entry): entry is { key: typeof entry.key; name: string } => entry.name !== null);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-2xs font-medium uppercase tracking-wide text-text-secondary">
          Шаблон для трекера
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          Это <strong>не</strong> каноническая ссылка. Замените{" "}
          <code className="font-mono">{"{affiliate_click_id}"}</code> на макрос вашей партнёрской
          сети — синтаксис макросов у каждой сети свой.
        </p>
        <code className="mt-1 block break-all rounded-sm border border-dashed border-border bg-surface px-2 py-1 font-mono text-xs text-text-secondary">
          {template}
        </code>
        <div className="mt-2">
          <CopyValueButton
            value={template}
            label="Скопировать шаблон"
            successMessage="Шаблон скопирован в буфер обмена"
            variant="ghost"
          />
        </div>
      </div>

      <div>
        <p className="text-2xs font-medium uppercase tracking-wide text-text-secondary">
          Параметры ссылки
        </p>
        <dl className="mt-1 space-y-0.5 text-xs">
          <div className="flex gap-2">
            <dt className="text-text-secondary">Параметр клика:</dt>
            <dd className="font-mono text-text-primary">{link.externalClickParameter}</dd>
          </div>
          {subs.length > 0 ? (
            subs.map((entry) => (
              <div key={entry.key} className="flex gap-2">
                <dt className="text-text-secondary">{entry.key}:</dt>
                <dd className="font-mono text-text-primary">{entry.name}</dd>
              </div>
            ))
          ) : (
            <div className="text-text-secondary">Дополнительные параметры не настроены.</div>
          )}
        </dl>
      </div>
    </div>
  );
}
