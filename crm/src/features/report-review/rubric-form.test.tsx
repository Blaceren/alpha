import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RubricForm, emptyRubricValues, toReviewScores, validateRubric, type RubricValues } from "./rubric-form";
import type { Rubric } from "@/data/contracts/api/report-review";

/** Seven criteria, as the fixture publishes; R1 and R4 demand a comment. */
const RUBRIC: Rubric = {
  versionNumber: 1,
  criteria: [
    { code: "r1-process", categoryCode: "c", commentRequired: true, title: "R1 process", description: "d1" },
    { code: "r2-risk", categoryCode: "c", commentRequired: false, title: "R2 risk", description: "d2" },
    { code: "r3-discipline", categoryCode: "c", commentRequired: false, title: "R3 discipline", description: "d3" },
    { code: "r4-evidence", categoryCode: "c", commentRequired: true, title: "R4 evidence", description: "d4" },
    { code: "r5-reflection", categoryCode: "c", commentRequired: false, title: "R5 reflection", description: "d5" },
    { code: "r6-accuracy", categoryCode: "c", commentRequired: false, title: "R6 accuracy", description: "d6" },
    { code: "r7-completeness", categoryCode: "c", commentRequired: false, title: "R7 completeness", description: "d7" },
  ],
  scale: [
    { code: "meets", label: "Соответствует", description: null },
    { code: "revise", label: "Требует доработки", description: null },
  ],
};

function Harness({ showErrors = false }: { showErrors?: boolean }) {
  const [values, setValues] = React.useState<RubricValues>(emptyRubricValues(RUBRIC));
  return <RubricForm rubric={RUBRIC} values={values} onChange={setValues} showErrors={showErrors} />;
}

describe("RubricForm — Backend-driven", () => {
  it("renders all seven criteria in the published order", () => {
    render(<Harness />);
    const legends = screen.getAllByRole("group").map((g) => g.textContent ?? "");
    expect(legends).toHaveLength(7);
    for (const [i, code] of RUBRIC.criteria.map((c) => c.code).entries()) {
      expect(legends[i]).toContain(code);
    }
  });

  it("renders whatever the backend published, not a hardcoded seven", () => {
    const three: Rubric = { ...RUBRIC, criteria: RUBRIC.criteria.slice(0, 3) };
    const Local = () => {
      const [v, setV] = React.useState(emptyRubricValues(three));
      return <RubricForm rubric={three} values={v} onChange={setV} showErrors={false} />;
    };
    render(<Local />);
    expect(screen.getAllByRole("group")).toHaveLength(3);
  });

  it("shows the localized title, description and stable code", () => {
    render(<Harness />);
    expect(screen.getByText("d4")).toBeInTheDocument();
    expect(screen.getByText(/R4 evidence/)).toBeInTheDocument();
    expect(screen.getByText("r4-evidence")).toBeInTheDocument();
  });

  it("uses a fieldset and legend per criterion", () => {
    render(<Harness />);
    // role=group is what a fieldset with a legend exposes.
    expect(screen.getAllByRole("group").length).toBe(7);
  });

  it("renders the scale from the backend, with labels", () => {
    render(<Harness />);
    expect(screen.getAllByRole("radio", { name: "Соответствует" })).toHaveLength(7);
    expect(screen.getAllByRole("radio", { name: "Требует доработки" })).toHaveLength(7);
  });

  it("marks which criteria require a comment", () => {
    render(<Harness />);
    expect(screen.getAllByText(/\(обязателен\)/)).toHaveLength(2);
    expect(screen.getAllByText(/\(необязателен\)/)).toHaveLength(5);
  });
});

describe("RubricForm — interaction", () => {
  it("records a selection and shows it as checked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const radios = screen.getAllByRole("radio", { name: "Соответствует" });
    await user.click(radios[0]!);
    expect(radios[0]).toBeChecked();
  });

  it("is keyboard operable — radios reachable and selectable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    const first = screen.getAllByRole("radio")[0]!;
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    // Arrow keys move within a native radio group.
    expect(screen.getAllByRole("radio", { name: "Требует доработки" })[0]).toBeChecked();
  });

  it("accepts a comment", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getAllByLabelText(/Комментарий/)[0]!;
    await user.type(box, "Полный процесс");
    expect(box).toHaveValue("Полный процесс");
  });
});

describe("RubricForm — validation", () => {
  it("reports every missing score and required comment", () => {
    const v = validateRubric(RUBRIC, emptyRubricValues(RUBRIC));
    expect(v.complete).toBe(false);
    expect(v.missingScores).toHaveLength(7);
    expect(v.missingComments).toEqual(["r1-process", "r4-evidence"]);
  });

  it("is complete only when every score and required comment is present", () => {
    const values: RubricValues = {};
    for (const c of RUBRIC.criteria) {
      values[c.code] = { scaleCode: "meets", comment: c.commentRequired ? "text" : "" };
    }
    expect(validateRubric(RUBRIC, values).complete).toBe(true);
  });

  it("treats a whitespace-only required comment as missing", () => {
    const values: RubricValues = {};
    for (const c of RUBRIC.criteria) values[c.code] = { scaleCode: "meets", comment: "   " };
    expect(validateRubric(RUBRIC, values).missingComments).toEqual(["r1-process", "r4-evidence"]);
  });

  it("shows an error summary only after a decision was attempted", () => {
    const { unmount } = render(<Harness showErrors={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    render(<Harness showErrors />);
    expect(screen.getByRole("alert")).toHaveTextContent(/заполнена не полностью/i);
  });

  it("associates a field-level error with its control", () => {
    render(<Harness showErrors />);
    const box = screen.getAllByLabelText(/Комментарий/)[0]!;
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute("aria-describedby");
  });
});

describe("toReviewScores", () => {
  it("builds one score per published criterion", () => {
    const values: RubricValues = {};
    for (const c of RUBRIC.criteria) values[c.code] = { scaleCode: "meets", comment: "" };
    const scores = toReviewScores(RUBRIC, values);
    expect(scores).toHaveLength(7);
    expect(scores.map((s) => s.criterionCode)).toEqual(RUBRIC.criteria.map((c) => c.code));
  });

  it("omits an empty optional comment rather than sending an empty string", () => {
    const values: RubricValues = {};
    for (const c of RUBRIC.criteria) values[c.code] = { scaleCode: "meets", comment: "  " };
    for (const score of toReviewScores(RUBRIC, values)) {
      expect(score).not.toHaveProperty("comment");
    }
  });

  it("trims a supplied comment", () => {
    const values = { ...emptyRubricValues(RUBRIC), "r1-process": { scaleCode: "meets", comment: "  ok  " } };
    expect(toReviewScores(RUBRIC, values)[0]!.comment).toBe("ok");
  });
});
