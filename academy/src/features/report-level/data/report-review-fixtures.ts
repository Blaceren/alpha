/**
 * DEVELOPMENT/TEST review fixture (Phase D3-C).
 *
 * This is the ONE provisional verdict the dev/test adapter may seed (DD-286).
 * It exists for deterministic screenshots and E2E; it is NOT curriculum
 * content, NOT a mentor's words, and the UI marks it «dev/test · provisional»
 * wherever it renders. No reviewer identity exists anywhere in this shape
 * (DD-288).
 *
 * The comment is deliberately neutral about trading: it asks for the structure
 * of the work (a recorded condition, a linked reflection), never for a trading
 * decision — inventing a trading evaluation is forbidden (DD-268).
 */

import { REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import {
  entryFieldSectionId,
  summarySectionId,
  type ReportReviewSectionId,
} from "@/features/report-level/model/report-review";

export const PROVISIONAL_REVIEW_COMMENT =
  "Уточните, какое условие было записано до входа, и свяжите итоговое наблюдение со всеми пятью записями.";

/** The two flagged sections of the authored scenario (internal ids, never rendered). */
export const PROVISIONAL_REVIEW_SECTIONS: ReportReviewSectionId[] = [
  entryFieldSectionId(REPORT_LEVEL_NUMBER, 3, "noticed"),
  summarySectionId(REPORT_LEVEL_NUMBER),
];
