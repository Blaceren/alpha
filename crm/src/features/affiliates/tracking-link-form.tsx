"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import {
  createAffiliateTrackingLink,
  updateAffiliateTrackingLink,
  type AffiliateOutcome,
} from "@/application/api/affiliates-client";
import type { AffiliateCampaign, AffiliateTrackingLink } from "@/data/contracts/api/affiliates";
import { describeAffiliateFailure, failureRequestId } from "./affiliate-labels";
import { Field, FormError, Select, TextInput } from "./affiliate-form-fields";

/**
 * AFD-5A — create and edit a tracking link.
 *
 * WHAT THIS FORM CANNOT EXPRESS, BY CONSTRUCTION:
 *
 *   • no URL field, no destination, no redirect target, no Pocket address;
 *   • no `publicCode` input — the backend is its only producer;
 *   • no secret, no token, no postback address;
 *   • no free-text query template.
 *
 * A tracking link is described entirely by WHICH INCOMING PARAMETER NAMES it
 * accepts. Those are names, never captured values. The landing key is a fixed
 * server-owned literal rendered as read-only text, because
 * `academy_registration` is currently the only supported value and a select with
 * one option would imply otherwise.
 *
 * A new link is always created as `draft`. There is deliberately no "create and
 * activate" shortcut: activation is a separate, explainable decision.
 */

const PROTECTED_PARAMETERS = new Set([
  "ow", "goal", "playerid", "clickid_pocket", "password", "passwd", "token", "secret",
  "authorization", "auth", "cookie", "session", "csrf", "redirect", "redirect_uri", "url",
  "next", "target", "callback", "return", "return_url",
]);

const SUB_KEYS = ["sub1", "sub2", "sub3", "sub4", "sub5"] as const;
type SubKey = (typeof SUB_KEYS)[number];

export interface TrackingLinkFormProps {
  mode: "create" | "edit";
  affiliatePartnerId: string;
  /** Only campaigns of THIS partner — the backend refuses a cross-partner pair. */
  campaigns: AffiliateCampaign[];
  link?: AffiliateTrackingLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (link: AffiliateTrackingLink) => void;
}

export function TrackingLinkFormDialog({
  mode,
  affiliatePartnerId,
  campaigns,
  link,
  open,
  onOpenChange,
  onSaved,
}: TrackingLinkFormProps) {
  const [displayName, setDisplayName] = React.useState(link?.displayName ?? "");
  const [campaignId, setCampaignId] = React.useState(link?.affiliateCampaignId ?? "");
  const [clickParam, setClickParam] = React.useState(link?.externalClickParameter ?? "clickid");
  const [subs, setSubs] = React.useState<Record<SubKey, string>>({
    sub1: link?.subParameters.sub1 ?? "",
    sub2: link?.subParameters.sub2 ?? "",
    sub3: link?.subParameters.sub3 ?? "",
    sub4: link?.subParameters.sub4 ?? "",
    sub5: link?.subParameters.sub5 ?? "",
  });
  const [windowDays, setWindowDays] = React.useState(
    link?.attributionWindowDays === null || link?.attributionWindowDays === undefined
      ? ""
      : String(link.attributionWindowDays),
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setDisplayName(link?.displayName ?? "");
    setCampaignId(link?.affiliateCampaignId ?? "");
    setClickParam(link?.externalClickParameter ?? "clickid");
    setSubs({
      sub1: link?.subParameters.sub1 ?? "",
      sub2: link?.subParameters.sub2 ?? "",
      sub3: link?.subParameters.sub3 ?? "",
      sub4: link?.subParameters.sub4 ?? "",
      sub5: link?.subParameters.sub5 ?? "",
    });
    setWindowDays(
      link?.attributionWindowDays === null || link?.attributionWindowDays === undefined
        ? ""
        : String(link.attributionWindowDays),
    );
    setError(null);
    setFieldErrors({});
  }, [open, link]);

  /**
   * Pre-flight parameter validation. It mirrors the backend's rules so an
   * operator sees the problem beside the field instead of as a round-trip
   * rejection — the BACKEND remains authoritative and re-validates everything.
   */
  function validate(): boolean {
    const next: Record<string, string> = {};

    if (displayName.trim().length < 1 || displayName.trim().length > 160) {
      next.displayName = "Укажите название длиной от 1 до 160 символов.";
    }

    const checkParam = (value: string, key: string) => {
      const lowered = value.trim().toLowerCase();
      if (lowered === "") return null;
      if (lowered.length > 32 || !/^[a-z0-9_]+$/.test(lowered)) {
        next[key] = "1–32 символа: строчные латинские буквы, цифры и подчёркивание.";
        return null;
      }
      if (PROTECTED_PARAMETERS.has(lowered)) {
        next[key] = "Это имя зарезервировано и не может использоваться.";
        return null;
      }
      return lowered;
    };

    const click = checkParam(clickParam, "clickParam");
    if (clickParam.trim() === "") {
      next.clickParam = "Параметр клика обязателен.";
    }

    const collected: string[] = [];
    if (click) collected.push(click);
    for (const key of SUB_KEYS) {
      const value = checkParam(subs[key], key);
      if (value) collected.push(value);
    }

    // Duplicate mappings are caught as a SET, so `sub1=x, sub3=x` is refused.
    const seen = new Set<string>();
    for (const name of collected) {
      if (seen.has(name)) {
        next.duplicate = `Имя параметра «${name}» использовано более одного раза.`;
        break;
      }
      seen.add(name);
    }

    if (windowDays.trim() !== "") {
      const days = Number(windowDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        next.windowDays = "Целое число от 1 до 365 либо пусто (наследовать от аффилейта).";
      }
    }

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  function normalized(value: string): string | null {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" ? null : trimmed;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!validate()) return;

    setPending(true);
    setError(null);

    const windowValue = windowDays.trim() === "" ? null : Number(windowDays);

    const shared = {
      displayName: displayName.trim(),
      externalClickParameter: clickParam.trim().toLowerCase(),
      sub1Parameter: normalized(subs.sub1),
      sub2Parameter: normalized(subs.sub2),
      sub3Parameter: normalized(subs.sub3),
      sub4Parameter: normalized(subs.sub4),
      sub5Parameter: normalized(subs.sub5),
      attributionWindowDays: windowValue,
    };

    const outcome: AffiliateOutcome<AffiliateTrackingLink> =
      mode === "create"
        ? await createAffiliateTrackingLink({
            affiliatePartnerId,
            affiliateCampaignId: campaignId === "" ? null : campaignId,
            landingKey: "academy_registration",
            ...shared,
          })
        : await updateAffiliateTrackingLink(link!.id, shared);

    setPending(false);

    if (outcome.status === "success") {
      onSaved(outcome.data);
      onOpenChange(false);
      return;
    }
    setError({ message: describeAffiliateFailure(outcome), requestId: failureRequestId(outcome) });
  }

  // A campaign may only be chosen at creation: the backend's composite foreign
  // key freezes the link's campaign+partner pair afterwards.
  const selectableCampaigns = campaigns.filter(
    (c) => c.status !== "archived" || c.id === link?.affiliateCampaignId,
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent
        className="max-w-lg"
        title={mode === "create" ? "Новая трекинговая ссылка" : "Редактирование ссылки"}
        description={
          mode === "create"
            ? "Ссылка создаётся как черновик. Публичный код генерирует сервер."
            : "Публичный код, аффилейт и кампания неизменяемы."
        }
      >
        <form onSubmit={submit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1" noValidate>
          <FormError message={error?.message ?? null} requestId={error?.requestId} />

          <Field id="link-name" label="Название" required error={fieldErrors.displayName}>
            {(aria) => (
              <TextInput
                {...aria}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={160}
              />
            )}
          </Field>

          {mode === "create" ? (
            <Field
              id="link-campaign"
              label="Кампания"
              hint="Необязательно. Доступны только кампании текущего аффилейта."
            >
              {(aria) => (
                <Select
                  {...aria}
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">Без кампании</option>
                  {selectableCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.displayName} ({campaign.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div className="space-y-1">
              <p className="block text-xs font-medium text-text-primary">Кампания</p>
              <p className="text-xs text-text-secondary">
                {link?.affiliateCampaignCode ?? "Без кампании"} — изменить нельзя.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <p className="block text-xs font-medium text-text-primary">Посадочная страница</p>
            <code className="block rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-xs text-text-secondary">
              academy_registration
            </code>
            <p className="text-2xs text-text-secondary">
              Единственное поддерживаемое значение. Произвольный адрес указать нельзя.
            </p>
          </div>

          <Field
            id="link-click-param"
            label="Параметр внешнего клика"
            required
            hint="Имя входящего query-параметра, в котором партнёрская сеть передаёт свой click id."
            error={fieldErrors.clickParam}
          >
            {(aria) => (
              <TextInput
                {...aria}
                value={clickParam}
                onChange={(e) => setClickParam(e.target.value)}
                autoComplete="off"
                maxLength={32}
              />
            )}
          </Field>

          <fieldset className="space-y-2 rounded-sm border border-border p-2">
            <legend className="px-1 text-xs font-medium text-text-primary">
              Дополнительные параметры (sub1–sub5)
            </legend>
            <p className="text-2xs text-text-secondary">
              Необязательные имена входящих параметров. Повторять имена нельзя.
            </p>
            {fieldErrors.duplicate ? (
              <p role="alert" className="text-2xs text-danger">
                {fieldErrors.duplicate}
              </p>
            ) : null}
            {SUB_KEYS.map((key) => (
              <Field key={key} id={`link-${key}`} label={key} error={fieldErrors[key]}>
                {(aria) => (
                  <TextInput
                    {...aria}
                    value={subs[key]}
                    onChange={(e) => setSubs((prev) => ({ ...prev, [key]: e.target.value }))}
                    autoComplete="off"
                    maxLength={32}
                  />
                )}
              </Field>
            ))}
          </fieldset>

          <Field
            id="link-window"
            label="Окно атрибуции (дни)"
            hint="Оставьте пустым, чтобы наследовать значение аффилейта."
            error={fieldErrors.windowDays}
          >
            {(aria) => (
              <TextInput
                {...aria}
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
              />
            )}
          </Field>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm" disabled={pending}>
                Отмена
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
