import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPLETION_SOURCE_LABEL,
  completionSourceLabel,
  type CompletionSource,
} from "@/lib/curriculum/completion-source";
import { toAcademyCurriculumView, findLevel } from "@/lib/curriculum/view-model";
import type { BackendCurriculumRead, BackendLevel } from "@/lib/curriculum/backend-dto";

function level(partial: Partial<BackendLevel> & { levelNumber: number; stableCode: string; type: string }): BackendLevel {
  return {
    title: `L${partial.levelNumber}`,
    shortDescription: null,
    learningObjective: "obj",
    completionMethod: "manual",
    xpReward: 10,
    requirements: { previousLevel: partial.levelNumber === 1 ? null : partial.levelNumber - 1, requiredXp: 0, checkpointLevel: null },
    status: "active",
    durableStatus: null,
    progress: null,
    ...partial,
  } as BackendLevel;
}

function enrolledRead(): BackendCurriculumRead {
  return {
    kind: "enrolled",
    curriculum: { code: "ata-v2", name: "ATA", versionNumber: 2, status: "published", effectiveFrom: null, publishedAt: "2026-01-01T00:00:00.000Z" },
    enrollment: { status: "active", enrolledAt: "2026-01-01T00:00:00.000Z", currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: "2026-02-01T00:00:00.000Z", completedAt: null },
    modules: [
      {
        moduleNumber: 1, code: "m01", title: "Module 1", description: "d", firstLevel: 1, lastLevel: 4, checkpointLevel: 4, learningObjective: "lo", status: "active",
        levels: [
          level({ levelNumber: 1, stableCode: "l001", type: "external_event", presentationState: "completed", blockers: [], durableStatus: "completed", progress: { status: "completed", startedAt: "2026-01-02T00:00:00.000Z", lastProgressAt: "2026-01-02T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z", completionMethod: "manual", attemptCount: 1 } }),
          level({ levelNumber: 2, stableCode: "l002", type: "lesson", presentationState: "available", blockers: [] }),
          level({ levelNumber: 3, stableCode: "l003", type: "report", presentationState: "locked", blockers: ["not_current_level", "sequence_incomplete"] }),
          level({ levelNumber: 4, stableCode: "l004", type: "financial_checkpoint", presentationState: "locked", blockers: ["not_current_level", "sequence_incomplete", "checkpoint_engine_unavailable"], requirements: { previousLevel: 3, requiredXp: 0, checkpointLevel: 4 } }),
        ],
      },
    ],
    xp: { kind: "disabled" },
  };
}

/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§8) — no raw completion-source enum
 * reaches learner-facing text.
 *
 * WHAT THIS FAILS ON. Run against the parent build, where
 * `api-level-detail.tsx` rendered `{summary.completionSource}` directly, the
 * rendered-output test below finds the literal `external_event` in the
 * document and fails. That is the exact string a learner read on the L1 Pocket
 * screen.
 *
 * WHY IT DOES NOT BAN UNDERSCORES GLOBALLY. A blanket "no snake_case in the
 * DOM" rule would fail on unrelated legitimate content — data attributes, level
 * codes, test ids — and would be turned off the first time it did. This targets
 * the ACTUAL completion-source vocabulary: the six canonical values, checked by
 * name.
 */

/** The canonical vocabulary, listed so the test owns it independently of the map. */
const CANONICAL_SOURCES: readonly CompletionSource[] = [
  "external_event",
  "financial_checkpoint",
  "mentor_review",
  "self",
  "final_exam",
  "unknown",
];

/** The learner-facing field, rendered exactly as `api-level-detail.tsx` renders it. */
function CompletionSourceField({ source }: { source: string }) {
  return (
    <dl>
      <div>
        <dt>Способ завершения</dt>
        <dd>{completionSourceLabel(source)}</dd>
      </div>
    </dl>
  );
}

describe("completion source — learner-facing presentation", () => {
  it("covers every canonical source with a label", () => {
    for (const source of CANONICAL_SOURCES) {
      expect(COMPLETION_SOURCE_LABEL[source]).toBeTruthy();
    }
    expect(Object.keys(COMPLETION_SOURCE_LABEL).sort()).toEqual([...CANONICAL_SOURCES].sort());
  });

  it("never renders a raw canonical enum to the learner", () => {
    for (const source of CANONICAL_SOURCES) {
      const { unmount } = render(<CompletionSourceField source={source} />);
      const rendered = screen.getByRole("definition").textContent ?? "";

      // The defect, stated as an assertion: the machine value must not be the
      // text a human reads. `self` is a substring of nothing here, so the
      // comparison is exact rather than a contains-check.
      expect(rendered).not.toBe(source);
      for (const canonical of CANONICAL_SOURCES) {
        expect(rendered).not.toContain(canonical);
      }
      expect(rendered.trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("renders Russian copy, not a transliteration of the enum", () => {
    const cases: ReadonlyArray<[CompletionSource, string]> = [
      ["external_event", "Внешнее событие"],
      ["financial_checkpoint", "Контрольная точка"],
      ["mentor_review", "Проверка ментором"],
      ["self", "Самостоятельно"],
      ["final_exam", "Финальный экзамен"],
      ["unknown", "Не определён"],
    ];
    for (const [source, expected] of cases) {
      const { unmount } = render(<CompletionSourceField source={source} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to the unknown copy rather than echoing an unrecognised code", () => {
    // The case nobody anticipated is exactly where echoing would reintroduce
    // the defect, so an unknown source must not appear in the output.
    render(<CompletionSourceField source="some_future_source" />);
    const rendered = screen.getByRole("definition").textContent ?? "";
    expect(rendered).not.toContain("some_future_source");
    expect(rendered).toBe(COMPLETION_SOURCE_LABEL.unknown);
  });

  it("handles null and undefined without rendering an empty field", () => {
    for (const value of [null, undefined]) {
      expect(completionSourceLabel(value)).toBe(COMPLETION_SOURCE_LABEL.unknown);
    }
  });
});

/**
 * The two assertions that FAIL ON THE PARENT BUILD.
 *
 * The block above proves the label module is correct in isolation, which the
 * parent would also pass — it simply had no such module. These two prove the
 * learner-facing screen actually USES it, which is the thing that was broken.
 */
describe("the L1 learner screen does not render the raw enum", () => {
  it("view-model output carries a localised label for a real external_event level", () => {
    const view = toAcademyCurriculumView(enrolledRead());
    // Narrow the discriminated union before reading modules.
    if (view.state === "unavailable" || view.state === "candidate") {
      throw new Error(`fixture produced an unusable view: ${view.state}`);
    }
    const found = findLevel(view, "l001");
    expect(found).toBeTruthy();
    const l1 = found!.level;

    // L1 is `external_event` — the exact level and the exact value a learner
    // read as `external_event` on the Pocket registration screen.
    expect(l1.completionSource).toBe("external_event");
    expect(l1.completionSourceLabel).toBe("Внешнее событие");

    // And it holds for every level the fixture produces, not just L1. Four
    // level types, three distinct sources, none of them rendered raw.
    const rendered = view.modules.flatMap((m) => m.levels.map((lvl) => lvl.completionSourceLabel));
    expect(rendered).toHaveLength(4);
    for (const label of rendered) {
      expect(CANONICAL_SOURCES).not.toContain(label);
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("the detail screen binds the label, not the enum", () => {
    // ON THE PARENT this file contains `{summary.completionSource}` and this
    // assertion fails. Reading the source is deliberate: the component is an
    // async server component behind a session and a provider, and the invariant
    // being protected — "what the learner reads is never the machine value" —
    // is a property of the binding, which is exactly what this inspects.
    const file = readFileSync(
      resolve(__dirname, "../../features/curriculum-api/api-level-detail.tsx"),
      "utf8",
    );
    const completionSourceField = /<dt>Способ завершения<\/dt><dd>\{([^}]+)\}<\/dd>/.exec(file);
    expect(completionSourceField).toBeTruthy();
    // ATA-COMPLETION-TRUTH-1B moved the label from the level TYPE to the level's
    // actual completion METHOD. The invariant this test protects is unchanged —
    // what the learner reads is never the machine value — so it follows the
    // binding to its new source rather than pinning the old field name.
    expect((completionSourceField![1] ?? "").trim()).toBe(
      "completionMethodLabel(summary.completionMethod)",
    );
    expect(file).not.toContain("<dd>{summary.completionSource}</dd>");
    expect(file).not.toContain("<dd>{summary.completionMethod}</dd>");
  });
});
