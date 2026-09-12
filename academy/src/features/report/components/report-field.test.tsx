import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportField } from "@/features/report/components/report-field";
import type { ReportFieldDefinition } from "@/lib/report/types";

const base: ReportFieldDefinition = {
  stableKey: "trade1-direction",
  type: "single_choice",
  required: true,
  sortOrder: 1,
  validation: null,
  requiredWhen: null,
  choices: [],
  label: "Направление",
  helpText: "",
  placeholder: "",
};

describe("ReportField — choice label fallback", () => {
  it("renders the stable code when a single_choice label is empty (never an unlabelled radio)", () => {
    const field: ReportFieldDefinition = { ...base, choices: [{ code: "up", label: "" }, { code: "down", label: "" }] };
    render(<ReportField field={field} value={undefined} error={null} disabled={false} effectivelyRequired onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "up" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "down" })).toBeInTheDocument();
  });

  it("prefers the localized label when present", () => {
    const field: ReportFieldDefinition = { ...base, choices: [{ code: "up", label: "Вверх" }] };
    render(<ReportField field={field} value={undefined} error={null} disabled={false} effectivelyRequired onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Вверх" })).toBeInTheDocument();
  });

  it("fails an unknown type visibly rather than dropping it", () => {
    const field = { ...base, type: "mystery" as unknown as ReportFieldDefinition["type"] };
    render(<ReportField field={field} value={undefined} error={null} disabled={false} effectivelyRequired={false} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/не поддерживается/i);
  });
});
