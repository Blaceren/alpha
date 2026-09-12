import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { computeSignals } from "@/domain/signals/engine";
import { STATE_EVIDENCE_CODES, type StateEvidence } from "@/domain/shared/primitives";
import {
  STATE_EVIDENCE_LABEL,
  evidenceLabel,
  evidenceValue,
  formatEvidence,
} from "./labels";

const clock = new FixedMockClock();
const users = buildDataset(clock);

/** Every evidence object the fixtures can actually produce. */
const allEvidence: StateEvidence[] = users.flatMap((u) =>
  computeSignals(u, clock).flatMap((s) => s.evidence),
);

const CYRILLIC = /[А-Яа-яЁё]/;

describe("StateEvidence label map — completeness", () => {
  it("gives every code in the enum a Russian label", () => {
    for (const code of STATE_EVIDENCE_CODES) {
      const label = STATE_EVIDENCE_LABEL[code];
      expect(label, `missing label for ${code}`).toBeTruthy();
      expect(label, `label for ${code} is not Russian: ${label}`).toMatch(CYRILLIC);
    }
  });

  it("has no label for a code outside the enum (map and enum agree exactly)", () => {
    expect(Object.keys(STATE_EVIDENCE_LABEL).sort()).toEqual([...STATE_EVIDENCE_CODES].sort());
  });

  it("never words a label as the raw code", () => {
    for (const code of STATE_EVIDENCE_CODES) {
      expect(STATE_EVIDENCE_LABEL[code]).not.toContain("_");
      expect(STATE_EVIDENCE_LABEL[code].toLowerCase()).not.toBe(code.replace(/_/g, " "));
    }
  });
});

describe("StateEvidence label map — covers the real dataset", () => {
  it("labels every evidence code the signal engine emits", () => {
    const emitted = new Set(allEvidence.map((e) => e.code));
    expect(emitted.size).toBeGreaterThan(0);
    for (const code of emitted) {
      expect(STATE_EVIDENCE_CODES, `engine emits unmapped code ${code}`).toContain(code);
    }
  });

  it("renders every real evidence item without leaking a raw code", () => {
    for (const e of allEvidence) {
      const { label, value } = formatEvidence(e);
      expect(label).toMatch(CYRILLIC);
      // The rendered pair must never contain the snake_case code or a raw enum
      // member — §22 forbids `support_blocked` / `registration_pending` in the UI.
      expect(`${label} ${value}`).not.toContain("_");
    }
  });

  it("translates enum-valued evidence instead of printing the member", () => {
    const support = allEvidence.find((e) => e.code === "support_state");
    expect(support, "fixtures should contain a support_state evidence").toBeDefined();
    expect(evidenceValue(support!)).not.toMatch(/blocked|open|resolved/);
    expect(evidenceValue(support!)).toMatch(CYRILLIC);

    const registration = allEvidence.find((e) => e.code === "pocket_registration_status");
    expect(registration).toBeDefined();
    expect(evidenceValue(registration!)).not.toMatch(/not_registered|registration_pending/);
    expect(evidenceValue(registration!)).toMatch(CYRILLIC);
  });
});

describe("StateEvidence value rendering", () => {
  const at = clock.nowIso();
  const make = (code: StateEvidence["code"], value: StateEvidence["value"]): StateEvidence => ({
    kind: "metric",
    code,
    value,
    observedAt: at,
    sensitivity: "LOW",
  });

  it("appends the unit so a bare number is never ambiguous", () => {
    expect(evidenceValue(make("hours_since_registration", 30))).toBe("30 ч");
    expect(evidenceValue(make("days_inactive", 7))).toBe("7 д");
    expect(evidenceValue(make("balance_age_minutes", 90))).toBe("90 мин");
    expect(evidenceValue(make("checkpoint_delta_pct", 10))).toBe("10%");
    expect(evidenceValue(make("test_attempts", 3))).toBe("3");
  });

  it("renders flags as Да/Нет, never as yes/no or true/false", () => {
    expect(evidenceValue(make("sla_breached", true))).toBe("Да");
    expect(evidenceValue(make("email_confirmed", false))).toBe("Нет");
    expect(evidenceValue(make("pocket_data_conflict", true))).toBe("Да");
  });

  it("states a missing measurement instead of rendering an empty value", () => {
    expect(evidenceValue(make("balance_age_minutes", null))).toBe("Нет данных");
    expect(evidenceValue(make("latest_test_score", null))).toBe("Нет данных");
  });
});

describe("StateEvidence unknown-code fallback", () => {
  it("falls back to a neutral Russian label, not the raw code", () => {
    const label = evidenceLabel("some_future_code");
    expect(label).not.toContain("some_future_code");
    expect(label).not.toContain("_");
    expect(label).not.toMatch(/future|code/i);
    expect(label).toMatch(CYRILLIC);
  });

  it("falls back to a neutral value, not the raw value", () => {
    const rendered = evidenceValue({
      kind: "metric",
      code: "some_future_code" as StateEvidence["code"],
      value: "support_blocked",
      observedAt: clock.nowIso(),
      sensitivity: "LOW",
    });
    expect(rendered).not.toContain("support_blocked");
  });
});
