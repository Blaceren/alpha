"use client";

import * as React from "react";
import {
  groupReportFields,
  isConditionalNote,
  presentValue,
  type FieldGroup,
  type GroupedField,
} from "@/domain/report-review/field-groups";
import type { DetailPayload } from "@/data/contracts/api/report-review";

/**
 * Read-only presentation of the submitted report.
 *
 * Strictly read-only: there is no input, no form and no mutation path anywhere in
 * this tree. A mentor reviews what the learner submitted; the learner's values are
 * theirs to change, and the reviewer UI must never be able to edit them.
 *
 * Every label, help text and field order comes from the Backend definition. The
 * grouping into trades and a summary is derived from the published field codes —
 * see `domain/report-review/field-groups.ts` for why that is not a duplicate
 * schema.
 */

function groupHeading(group: FieldGroup): string {
  switch (group.kind) {
    case "trade":
      return `Сделка ${group.tradeNumber}`;
    case "summary":
      return "Итоги и выводы";
    default:
      return "Общие подтверждения";
  }
}

function ValueCell({ field }: { field: GroupedField }) {
  const presented = presentValue(field);

  switch (presented.kind) {
    case "boolean":
      // Word, not a coloured dot: never colour-only.
      return <span className="text-text-primary">{presented.value ? "Да" : "Нет"}</span>;

    case "text":
      return <span className="whitespace-pre-wrap break-words text-text-primary">{presented.value}</span>;

    case "number":
      return <span className="tabular-nums text-text-primary">{presented.value}</span>;

    case "code":
      // The reviewer DTO carries no localized labels for choice options, so the
      // stable code is the honest fallback. Marked as a code so it cannot be
      // mistaken for prose, and never translated locally.
      return (
        <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-2xs text-text-primary">
          {presented.value}
        </code>
      );

    case "codeList":
      return presented.values.length === 0 ? (
        <span className="text-text-muted">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {presented.values.map((code) => (
            <code
              key={code}
              className="rounded bg-elevated px-1.5 py-0.5 font-mono text-2xs text-text-primary"
            >
              {code}
            </code>
          ))}
        </span>
      );

    case "absent":
      return (
        <span className="text-text-muted">
          {isConditionalNote(field.definition)
            ? "Не применимо — план соблюдён"
            : "Не заполнено (необязательное поле)"}
        </span>
      );

    case "unsupported":
      // Loud and safe. A coerced value is a value a mentor might review as if it
      // were correct.
      return (
        <span role="alert" className="block rounded border border-warning/50 bg-warning/10 p-2">
          <span className="block text-2xs font-semibold text-text-primary">
            Значение не отображено безопасно
          </span>
          <span className="block text-2xs text-text-secondary">
            Тип поля «{presented.declaredType}» не поддерживается этим представлением или значение не
            соответствует типу. Проверьте отчёт через backend.
          </span>
          <code className="mt-1 block font-mono text-2xs text-text-muted">{presented.rawPreview}</code>
        </span>
      );
  }
}

export interface ReportFieldsProps {
  payload: DetailPayload;
}

export function ReportFields({ payload }: ReportFieldsProps) {
  const groups = React.useMemo(
    () => groupReportFields(payload.assignment.fields, payload.revision.values),
    [payload.assignment.fields, payload.revision.values],
  );
  const tradeCount = groups.filter((g) => g.kind === "trade").length;

  return (
    <section aria-labelledby="report-fields-heading" className="space-y-4">
      <div>
        <h2 id="report-fields-heading" className="text-base font-semibold text-text-primary">
          Содержание отчёта
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {payload.assignment.fields.length} полей из определения задания (версия №
          {payload.assignment.versionNumber}): {tradeCount}{" "}
          {tradeCount === 5 ? "групп сделок" : "групп(ы) сделок"} и итоговый блок. Значения показаны
          только для чтения.
        </p>
      </div>

      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`group-${group.key}`}
          className="rounded-lg border border-border bg-surface"
        >
          <h3
            id={`group-${group.key}`}
            className="border-b border-border px-4 py-2 text-sm font-semibold text-text-primary"
          >
            {groupHeading(group)}
          </h3>
          <dl className="divide-y divide-border">
            {group.fields.map((field) => (
              <div key={field.definition.code} className="grid gap-1 px-4 py-3 sm:grid-cols-[16rem_1fr] sm:gap-4">
                <dt className="text-sm text-text-secondary">
                  <span className="block font-medium text-text-primary">{field.definition.label}</span>
                  <span className="block font-mono text-2xs text-text-muted">{field.definition.code}</span>
                  {field.definition.helpText ? (
                    <span className="mt-0.5 block text-2xs text-text-muted">{field.definition.helpText}</span>
                  ) : null}
                </dt>
                <dd className="text-sm">
                  <ValueCell field={field} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </section>
  );
}
