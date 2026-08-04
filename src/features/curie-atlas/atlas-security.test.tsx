/**
 * AFD-5D3 — CRM contract hostility, label security and UX honesty.
 *
 * WHAT THIS ADDS TO THE ACCEPTED SUITES. AFD-5D2A proved the CRM renders the
 * backend's verdict and derives nothing. It tested WELL-FORMED responses. This
 * file sends malformed, contradictory and hostile ones, and asserts the
 * workspace refuses them rather than rendering something an operator would act
 * on.
 *
 * THE PRINCIPLE. A parse failure must be a bounded error state. Rendering "most
 * of" an analytical report is the one outcome worse than rendering none of it:
 * the operator cannot see which part was dropped.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { AtlasSufficiencyPanel } from "./atlas-overview";

import { KNOWN_REASON_CODES, atlasReportSchema } from "@/data/contracts/api/curie-atlas";
import { atlasReport, finding, evidence, issue } from "@/test/atlas-fixtures";
import { reasonCodeLabel, supportTierLabel, issueScopeLabel } from "./atlas-labels";

/** Parse a mutated report and report whether the contract accepted it. */
function accepts(mutate: (report: Record<string, unknown>) => void): boolean {
  const body = JSON.parse(JSON.stringify(atlasReport())) as Record<string, unknown>;
  mutate(body);
  return atlasReportSchema.safeParse(body).success;
}

/* ==================================================================== */
/* A. THE CONTRACT REFUSES HOSTILE RESPONSES                            */
/* ==================================================================== */

describe("the Atlas contract is hostile to malformed responses", () => {
  it("accepts the known-good fixture, so the negatives below mean something", () => {
    // Without this, every `expect(false)` below could be passing because the
    // fixture itself is broken.
    expect(atlasReportSchema.safeParse(atlasReport()).success).toBe(true);
  });

  it("refuses a response carrying the pre-rename `opportunities` collection", () => {
    expect(accepts((r) => { r.opportunities = []; })).toBe(false);
  });

  it("refuses `modelInvoked: true` — a model claim is a contract violation", () => {
    expect(
      accepts((r) => {
        (r.engine as Record<string, unknown>).modelInvoked = true;
      }),
    ).toBe(false);
  });

  it("refuses a missing or wrong agent identity", () => {
    expect(accepts((r) => { delete r.agent; })).toBe(false);
    expect(accepts((r) => { (r.agent as Record<string, unknown>).code = "curie_pulse"; })).toBe(false);
    expect(accepts((r) => { (r.agent as Record<string, unknown>).version = "2.0.0"; })).toBe(false);
  });

  it("refuses an unknown top-level status", () => {
    expect(accepts((r) => { r.status = "probably_fine"; })).toBe(false);
    expect(accepts((r) => { delete r.status; })).toBe(false);
  });

  it("refuses an unknown sufficiency status", () => {
    expect(
      accepts((r) => {
        (r.dataSufficiency as Record<string, unknown>).status = "mostly";
      }),
    ).toBe(false);
  });

  it("refuses an unknown support tier", () => {
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.supportTier = "certain";
      }),
    ).toBe(false);
  });

  it("refuses a finding with an unknown section or severity", () => {
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.section = "recommendation";
      }),
    ).toBe(false);
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.severity = "critical";
      }),
    ).toBe(false);
  });

  it("refuses an unexpected top-level field", () => {
    expect(accepts((r) => { r.recommendations = ["increase budget"]; })).toBe(false);
    expect(accepts((r) => { r.forecast = { nextPeriod: 42 }; })).toBe(false);
  });

  it("refuses a PII-shaped field anywhere in the response", () => {
    expect(accepts((r) => { r.learnerEmail = "person@example.com"; })).toBe(false);
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.learnerId = 42;
      }),
    ).toBe(false);
    expect(
      accepts((r) => {
        const ev = (r.observations as Record<string, unknown>[])[0]!.evidence as Record<
          string,
          unknown
        >[];
        ev[0]!.pocketPlayerId = "PP-99";
      }),
    ).toBe(false);
  });

  it("refuses a comparison whose fields are numbers rather than exact strings", () => {
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.comparison = {
          kind: "count_change",
          currentValue: 25,
          baselineValue: 10,
          absoluteDelta: 15,
          percentagePointDelta: null,
          relativeDelta: null,
        };
      }),
    ).toBe(false);
  });

  it("refuses a comparison with an absent field instead of an explicit null", () => {
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.comparison = {
          kind: "count_change",
          currentValue: "25",
          baselineValue: "10",
          absoluteDelta: "15",
          // percentagePointDelta omitted — the shape must be TOTAL
          relativeDelta: null,
        };
      }),
    ).toBe(false);
  });

  it("refuses a finding whose required fields are missing", () => {
    expect(
      accepts((r) => {
        delete (r.observations as Record<string, unknown>[])[0]!.evidence;
      }),
    ).toBe(false);
    expect(
      accepts((r) => {
        delete (r.observations as Record<string, unknown>[])[0]!.supportTier;
      }),
    ).toBe(false);
    expect(
      accepts((r) => {
        delete (r.observations as Record<string, unknown>[])[0]!.comparison;
      }),
    ).toBe(false);
  });

  it("refuses a sufficiency issue with no evidence or no code", () => {
    expect(
      accepts((r) => {
        (r.dataSufficiency as Record<string, unknown>).issues = [
          { code: "SAMPLE_TOO_SMALL" },
        ];
      }),
    ).toBe(false);
    expect(
      accepts((r) => {
        (r.dataSufficiency as Record<string, unknown>).issues = [
          { code: "", evidence: [] },
        ];
      }),
    ).toBe(false);
  });

  it("REJECTS an unknown reason code, and rejects the whole response with it", () => {
    // AFD-5D3 reversed AFD-5D2A here. The vocabulary is closed; an eighth code
    // is a contract violation, not a labelling gap.
    expect(
      accepts((r) => {
        (r.dataSufficiency as Record<string, unknown>).issues = [
          {
            code: "SOME_FUTURE_REASON",
            evidence: [{ key: "k", value: "1", source: "summary" }],
          },
        ];
      }),
    ).toBe(false);
  });

  it("accepts every one of the seven published reason codes", () => {
    for (const code of KNOWN_REASON_CODES) {
      expect(
        accepts((r) => {
          (r.dataSufficiency as Record<string, unknown>).issues = [
            { code, evidence: [{ key: "k", value: "1", source: "summary" }] },
          ];
        }),
        `rejected the published code ${code}`,
      ).toBe(true);
    }
  });

  it("rejects a response whose issues are VALID except for one unknown code", () => {
    // No partial trust: the good half must not render.
    expect(
      accepts((r) => {
        (r.dataSufficiency as Record<string, unknown>).issues = [
          { code: "SAMPLE_TOO_SMALL", evidence: [{ key: "k", value: "1", source: "summary" }] },
          { code: "STILL_NOT_REAL", evidence: [{ key: "k", value: "1", source: "summary" }] },
        ];
      }),
    ).toBe(false);
  });

  it("refuses a malformed evidence source", () => {
    expect(
      accepts((r) => {
        const ev = (r.observations as Record<string, unknown>[])[0]!.evidence as Record<
          string,
          unknown
        >[];
        ev[0]!.source = "guess";
      }),
    ).toBe(false);
  });
});

/* ==================================================================== */
/* A2. THE NUMERIC COMPARISON CONTRACT                                  */
/*                                                                      */
/* The values are NUMERIC IN MEANING and carried as EXACT DECIMAL       */
/* STRINGS. Valid backend-owned comparisons must be ACCEPTED; only      */
/* malformed or contract-invalid ones are refused. The exact accepted   */
/* representation was measured from analysis-support.ts, not assumed.   */
/* ==================================================================== */

/** Replace the first observation's comparison and report acceptance. */
function acceptsComparison(comparison: unknown): boolean {
  return accepts((r) => {
    (r.observations as Record<string, unknown>[])[0]!.comparison = comparison as never;
  });
}

const VALID_COUNT_CHANGE = {
  kind: "count_change",
  currentValue: "10",
  baselineValue: "25",
  absoluteDelta: "-15",
  percentagePointDelta: null,
  relativeDelta: "60.0",
};
const VALID_RATE_CHANGE = {
  kind: "rate_change",
  currentValue: "35.0",
  baselineValue: "40.0",
  absoluteDelta: null,
  percentagePointDelta: "5.0",
  relativeDelta: null,
};
const VALID_MEMBER_VS_AGGREGATE = {
  kind: "member_vs_aggregate",
  currentValue: "40.0",
  baselineValue: "25.0",
  absoluteDelta: null,
  percentagePointDelta: "15.0",
  relativeDelta: null,
};

describe("valid backend numeric comparison evidence is ACCEPTED", () => {
  it("accepts each of the three real shapes the engine publishes", () => {
    expect(acceptsComparison(VALID_COUNT_CHANGE), "count_change").toBe(true);
    expect(acceptsComparison(VALID_RATE_CHANGE), "rate_change").toBe(true);
    expect(acceptsComparison(VALID_MEMBER_VS_AGGREGATE), "member_vs_aggregate").toBe(true);
  });

  it("accepts a rising count, a zero delta and the 0 % and 100 % boundaries", () => {
    expect(
      acceptsComparison({ ...VALID_COUNT_CHANGE, currentValue: "25", baselineValue: "10", absoluteDelta: "15", relativeDelta: "150.0" }),
    ).toBe(true);
    expect(
      acceptsComparison({ ...VALID_COUNT_CHANGE, currentValue: "10", baselineValue: "10", absoluteDelta: "0", relativeDelta: "0.0" }),
    ).toBe(true);
    expect(
      acceptsComparison({ ...VALID_RATE_CHANGE, currentValue: "0.0", baselineValue: "100.0", percentagePointDelta: "100.0" }),
    ).toBe(true);
  });

  it("accepts a null delta, which is how the engine reports one it will not compute", () => {
    // `absoluteDelta` is null when the counts exceed safe-integer range, and
    // `relativeDelta` is null when the baseline is zero. Both are real states.
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, absoluteDelta: null })).toBe(true);
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, relativeDelta: null })).toBe(true);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, percentagePointDelta: null })).toBe(true);
  });

  it("accepts `comparison: null` for the majority of findings that compare nothing", () => {
    expect(acceptsComparison(null)).toBe(true);
  });
});

describe("malformed numeric comparison evidence is REJECTED", () => {
  it("rejects a wrong primitive type", () => {
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, currentValue: 10 })).toBe(false);
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, absoluteDelta: -15 })).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, percentagePointDelta: 5 })).toBe(false);
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, currentValue: true })).toBe(false);
  });

  it("rejects NaN, Infinity and other non-finite text", () => {
    for (const bad of ["NaN", "Infinity", "-Infinity", "1e400", "", " ", "null"]) {
      expect(acceptsComparison({ ...VALID_COUNT_CHANGE, currentValue: bad }), bad).toBe(false);
    }
  });

  it("rejects out-of-contract precision and non-canonical numerals", () => {
    // The engine publishes one decimal place for a percentage. More precision
    // means the value did not come from the published formatter.
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, currentValue: "35.000" })).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, currentValue: "35,0" })).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, currentValue: "0x23" })).toBe(false);
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, currentValue: "10.5" })).toBe(false);
  });

  it("rejects an impossible rate range", () => {
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, currentValue: "140.0" })).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, currentValue: "-5.0" })).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, percentagePointDelta: "250.0" })).toBe(false);
  });

  it("rejects a partial structure with a field omitted rather than null", () => {
    const { relativeDelta, ...partial } = VALID_COUNT_CHANGE;
    expect(acceptsComparison(partial)).toBe(false);
    const { percentagePointDelta, ...partialRate } = VALID_RATE_CHANGE;
    expect(acceptsComparison(partialRate)).toBe(false);
  });

  it("rejects an incompatible unit: a field belonging to the OTHER kind", () => {
    // A count change has no percentage-point delta, and a rate change has no
    // absolute delta. Carrying one is a unit error, not a harmless extra.
    expect(
      acceptsComparison({ ...VALID_COUNT_CHANGE, percentagePointDelta: "5.0" }),
    ).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, absoluteDelta: "-5" })).toBe(false);
    expect(acceptsComparison({ ...VALID_RATE_CHANGE, relativeDelta: "12.5" })).toBe(false);
  });

  it("rejects an operand/evidence mismatch: a delta that contradicts its own values", () => {
    // The decisive factual check. 10 − 25 is −15; a response claiming +99 is
    // internally inconsistent whatever its sentence says.
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, absoluteDelta: "99" })).toBe(false);
    expect(
      acceptsComparison({ ...VALID_RATE_CHANGE, percentagePointDelta: "42.0" }),
    ).toBe(false);
  });

  it("rejects an unknown comparison kind", () => {
    expect(acceptsComparison({ ...VALID_COUNT_CHANGE, kind: "forecast_change" })).toBe(false);
  });

  it("rejects an extra field smuggled into the comparison", () => {
    expect(
      acceptsComparison({ ...VALID_COUNT_CHANGE, currency: "USD", learnerId: 7 }),
    ).toBe(false);
  });
});

/* ==================================================================== */
/* B. LABEL SECURITY                                                    */
/* ==================================================================== */

describe("entity and reason labels are safe text", () => {
  const HOSTILE = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "[click](https://evil.example)",
    "[31mred[0m",           // terminal escape
    "‮gnisitrevda",                  // right-to-left override
    "​hidden",                       // zero-width space
    "Кампания́́́",       // stacked combining marks
    "'; DROP TABLE AffiliatePartner; --",
  ];

  it("a HOSTILE reason code is rejected by the contract, never labelled", () => {
    // AFD-5D3: there is no fallback label to reach. The defence is that the
    // response carrying such a code is refused outright, so no labeller is ever
    // handed attacker-shaped text.
    for (const value of HOSTILE) {
      expect(
        accepts((r) => {
          (r.dataSufficiency as Record<string, unknown>).issues = [
            { code: value, evidence: [{ key: "k", value: "1", source: "summary" }] },
          ];
        }),
        `a hostile reason code was accepted: ${value}`,
      ).toBe(false);
    }
  });

  it("an unknown support tier CANNOT arrive, because the tier enum is closed", () => {
    // `supportTierLabel` falls back to echoing its input. That is unreachable
    // rather than safe-by-construction, and the distinction matters: the reason
    // the echo cannot be exploited is that `atlasSupportTierSchema` is a CLOSED
    // enum, so a hostile tier fails parsing before any labeller sees it.
    //
    // Asserted here so that if the tier schema is ever loosened the way the
    // reason-code schema deliberately was, this fails and someone adds a bounded
    // fallback first.
    for (const value of HOSTILE) {
      expect(
        accepts((r) => {
          (r.observations as Record<string, unknown>[])[0]!.supportTier = value;
        }),
        `a hostile support tier was accepted: ${value}`,
      ).toBe(false);
    }
    // The echo itself, stated rather than hidden.
    expect(supportTierLabel("not_a_tier" as never)).toBe("not_a_tier");
  });

  it("a hostile issue SCOPE is reachable, and renders as inert text", () => {
    // `scope` is `z.string()` in the DTO — deliberately open, like the reason
    // code — so unlike the tier it CAN carry an arbitrary backend string, and
    // `issueScopeLabel` echoes what it does not recognise.
    //
    // The guarantee is therefore not "it cannot arrive" but "it cannot execute".
    // That is asserted against the real DOM rather than argued from React's
    // reputation.
    for (const value of HOSTILE) {
      expect(
        accepts((r) => {
          (r.dataSufficiency as Record<string, unknown>).status = "partial";
          (r.dataSufficiency as Record<string, unknown>).issues = [
            {
              code: "SAMPLE_TOO_SMALL",
              scope: value,
              evidence: [{ key: "denominator", value: "5", source: "summary" }],
            },
          ];
          r.status = "partial";
        }),
        `the contract rejected a scope it should carry: ${value}`,
      ).toBe(true);
    }

    const report = atlasReport({
      status: "partial",
      dataSufficiency: {
        status: "partial",
        issues: HOSTILE.map((value) =>
          issue({
            code: "SAMPLE_TOO_SMALL",
            scope: value,
            evidence: [evidence({ key: "denominator", value: "5" })],
          }),
        ),
      },
    });

    const { container } = render(<AtlasSufficiencyPanel report={report} />);

    // NOTHING EXECUTABLE WAS CREATED. The assertion is STRUCTURAL, not a
    // substring scan: `onerror` and `javascript:` legitimately appear in the
    // serialized HTML as ESCAPED TEXT, and a naive `not.toContain` would fail on
    // correct behaviour. What must not exist is an element or an attribute.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    for (const node of Array.from(container.querySelectorAll("*"))) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.name.toLowerCase().startsWith("on"), `${attr.name} was created`).toBe(false);
        expect(attr.value.toLowerCase()).not.toContain("javascript:");
      }
    }
    // The markup was escaped rather than parsed.
    expect(container.innerHTML).toContain("&lt;script&gt;");

    // And the strings survive as VISIBLE TEXT, which is the correct outcome:
    // the operator sees exactly what the data contains.
    expect(container.textContent).toContain("<script>alert(1)</script>");

    // HONEST LIMIT, ASSERTED RATHER THAN GLOSSED. React escapes MARKUP; it does
    // not neutralise bidirectional or zero-width characters, so those reach the
    // DOM intact and could visually reorder a label. That is acceptable here
    // only because `scope` is populated from backend constants — the write
    // boundary for operator-authored text (`normalizeDisplayName`) rejects this
    // whole character class. If `scope` ever carries stored text, it needs the
    // same treatment.
    expect(container.textContent).toContain("\u202e");
  });

  it("the contract rejects a dimensionId that is not a plain integer", () => {
    // The only entity reference the backend publishes is a numeric id. A string
    // here would be a name arriving by the back door.
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.dimensionId = "Кампания <script>";
      }),
    ).toBe(false);
    expect(
      accepts((r) => {
        (r.observations as Record<string, unknown>[])[0]!.dimensionId = 1.5;
      }),
    ).toBe(false);
  });

  it("the contract rejects an evidence dimensionId that is not an integer", () => {
    expect(
      accepts((r) => {
        const ev = (r.observations as Record<string, unknown>[])[0]!.evidence as Record<
          string,
          unknown
        >[];
        ev[0]!.dimensionId = "<img src=x>";
      }),
    ).toBe(false);
  });
});

/* ==================================================================== */
/* C. UX HONESTY, AT THE LABEL LAYER                                    */
/* ==================================================================== */

describe("the labels never claim intelligence the product does not have", () => {
  it("no published label mentions AI, a model, a prediction or a recommendation", () => {
    const FORBIDDEN = /\b(AI|ИИ|нейросет|модел|LLM|прогноз|рекоменд|предсказ|советуе)/i;
    const samples = [
      reasonCodeLabel("SAMPLE_TOO_SMALL"),
      reasonCodeLabel("COMPARISON_PERIOD_UNAVAILABLE"),
      reasonCodeLabel("MIXED_CURRENCY"),
      reasonCodeLabel("COHORT_FOLLOWUP_INCOMPLETE"),
      reasonCodeLabel("INTEGRITY_WARNING"),
      reasonCodeLabel("METRIC_UNAVAILABLE"),
      reasonCodeLabel("BREAKDOWN_TRUNCATED"),
      supportTierLabel("descriptive"),
      supportTierLabel("moderate"),
      supportTierLabel("strong"),
    ];
    for (const label of samples) {
      expect(label, `"${label}" implies intelligence the engine does not have`).not.toMatch(
        FORBIDDEN,
      );
    }
  });

  it("the support-tier labels describe EVIDENCE, not confidence or certainty", () => {
    // A tier is how much data stands behind a statement. Naming it «уверенность»
    // would convert a denominator into a probability nobody computed.
    for (const tier of ["descriptive", "moderate", "strong"] as const) {
      expect(supportTierLabel(tier)).not.toMatch(/уверен|вероятн|точн|достоверн/i);
    }
  });
});
