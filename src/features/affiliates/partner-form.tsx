"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import {
  createAffiliatePartner,
  updateAffiliatePartner,
  type AffiliateOutcome,
} from "@/application/api/affiliates-client";
import type { AffiliatePartner } from "@/data/contracts/api/affiliates";
import { describeAffiliateFailure, failureRequestId } from "./affiliate-labels";
import { Field, FormError, TextArea, TextInput } from "./affiliate-form-fields";

/**
 * AFD-5A — create and edit an affiliate partner.
 *
 * `code` is present ONLY on create. It is immutable afterwards, the backend
 * rejects it as an unknown field on PATCH, and the edit form therefore renders
 * it as read-only text rather than a disabled input an operator might mistake
 * for something they can enable.
 *
 * Values survive a recoverable validation error: state is not reset on failure,
 * so a rejected submission never costs the operator their typing.
 */

export interface PartnerFormProps {
  mode: "create" | "edit";
  partner?: AffiliatePartner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (partner: AffiliatePartner) => void;
}

export function PartnerFormDialog({ mode, partner, open, onOpenChange, onSaved }: PartnerFormProps) {
  const [code, setCode] = React.useState(partner?.code ?? "");
  const [displayName, setDisplayName] = React.useState(partner?.displayName ?? "");
  const [description, setDescription] = React.useState(partner?.description ?? "");
  const [windowDays, setWindowDays] = React.useState(
    String(partner?.defaultAttributionWindowDays ?? 30),
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; requestId?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Re-seed when a different partner is opened, but never mid-edit.
  React.useEffect(() => {
    if (!open) return;
    setCode(partner?.code ?? "");
    setDisplayName(partner?.displayName ?? "");
    setDescription(partner?.description ?? "");
    setWindowDays(String(partner?.defaultAttributionWindowDays ?? 30));
    setError(null);
    setFieldErrors({});
  }, [open, partner]);

  /** Local, pre-flight complaints only — never a backend message. */
  function validate(): boolean {
    const next: Record<string, string> = {};
    if (mode === "create") {
      const trimmed = code.trim().toLowerCase();
      if (trimmed.length < 3 || trimmed.length > 64 || !/^[a-z0-9_-]+$/.test(trimmed)) {
        next.code =
          "3–64 символа: строчные латинские буквы, цифры, дефис или подчёркивание.";
      }
    }
    if (displayName.trim().length < 1 || displayName.trim().length > 160) {
      next.displayName = "Укажите название длиной от 1 до 160 символов.";
    }
    const days = Number(windowDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      next.windowDays = "Целое число от 1 до 365.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return; // duplicate-submission guard
    if (!validate()) return;

    setPending(true);
    setError(null);

    const days = Number(windowDays);
    const trimmedDescription = description.trim();

    const outcome: AffiliateOutcome<AffiliatePartner> =
      mode === "create"
        ? await createAffiliatePartner({
            code: code.trim().toLowerCase(),
            displayName: displayName.trim(),
            description: trimmedDescription === "" ? null : trimmedDescription,
            defaultAttributionWindowDays: days,
          })
        : await updateAffiliatePartner(partner!.id, {
            displayName: displayName.trim(),
            description: trimmedDescription === "" ? null : trimmedDescription,
            defaultAttributionWindowDays: days,
          });

    setPending(false);

    if (outcome.status === "success") {
      onSaved(outcome.data);
      onOpenChange(false);
      return;
    }
    setError({
      message: describeAffiliateFailure(outcome),
      requestId: failureRequestId(outcome),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent
        title={mode === "create" ? "Новый аффилейт" : "Редактирование аффилейта"}
        description={
          mode === "create"
            ? "Код задаётся один раз и потом не меняется."
            : "Код аффилейта неизменяем."
        }
      >
        <form onSubmit={submit} className="space-y-3" noValidate>
          <FormError message={error?.message ?? null} requestId={error?.requestId} />

          {mode === "create" ? (
            <Field
              id="partner-code"
              label="Код"
              required
              hint="Неизменяемый идентификатор: строчные буквы, цифры, дефис, подчёркивание."
              error={fieldErrors.code}
            >
              {(aria) => (
                <TextInput
                  {...aria}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  maxLength={64}
                />
              )}
            </Field>
          ) : (
            <div className="space-y-1">
              <p className="block text-xs font-medium text-text-primary">Код</p>
              <code className="block rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-xs text-text-secondary">
                {partner?.code}
              </code>
              <p className="text-2xs text-text-secondary">Код неизменяем.</p>
            </div>
          )}

          <Field id="partner-name" label="Название" required error={fieldErrors.displayName}>
            {(aria) => (
              <TextInput
                {...aria}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={160}
              />
            )}
          </Field>

          <Field id="partner-description" label="Описание" error={fieldErrors.description}>
            {(aria) => (
              <TextArea
                {...aria}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
            )}
          </Field>

          <Field
            id="partner-window"
            label="Окно атрибуции по умолчанию (дни)"
            required
            hint="Наследуется ссылками, у которых не задано собственное окно. От 1 до 365."
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
