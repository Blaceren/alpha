/**
 * Report definitions (Phase D3-B).
 *
 * Same split as `lesson-fixtures.ts` (DD-243): the curriculum fixture owns
 * structure, this owns the body. D3-B authors exactly ONE report — level 3, the
 * only curriculum level with `kind: "report"`. No other report is invented.
 *
 * `entryCount: 5` is not a layout choice: the curriculum artifact for level 3 is
 * «Отчёт по 5 demo-сделкам», so the number of evidence entries is dictated by the
 * course. It is declared here rather than parsed out of the artifact string,
 * because deriving structure by regexing user-facing copy is how copy edits turn
 * into silent data bugs. A consistency test pins it against the artifact.
 *
 * Every RU string below is PROTOTYPE-ONLY editorial structure and is NOT
 * canonical curriculum content (DD-268).
 */

import { getLevel } from "@/data/curriculum/fixture";
import { isReportLevel, reportCodeFor, type ReportDefinition } from "@/features/report-level/model/report";

/** The single report level D3-B builds. */
export const REPORT_LEVEL_NUMBER = 3;

const LEVEL_003 = getLevel(REPORT_LEVEL_NUMBER);

const REPORT_003: ReportDefinition = {
  level: LEVEL_003,
  code: reportCodeFor(REPORT_LEVEL_NUMBER),
  // Dictated by the curriculum artifact «Отчёт по 5 demo-сделкам».
  entryCount: 5,
  summaryLabel: "Итоговое наблюдение",
  summaryPlaceholder: "Что ты понял по всем пяти записям вместе?",
  editorialNote: "Структура задания уточняется редакцией",
};

const REPORTS: ReadonlyMap<number, ReportDefinition> = new Map([
  [REPORT_LEVEL_NUMBER, REPORT_003],
]);

/**
 * The report definition for a level, or null when this level is not a report
 * level or D3-B did not author it. Never throws, never fabricates a report.
 */
export function getReportDefinition(levelNumber: number): ReportDefinition | null {
  const definition = REPORTS.get(levelNumber);
  if (!definition) return null;
  // Defensive: a definition may only exist for a level the curriculum agrees is
  // a report. If the curriculum ever changes kind, we refuse rather than render.
  return isReportLevel(definition.level) ? definition : null;
}
