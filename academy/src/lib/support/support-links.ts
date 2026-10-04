/** The query parameter that names the open case on the support desk. */
export const SUPPORT_CASE_PARAM = "case";

/** The desk's own address for a case (2026-10-04, launch audit). */
export function supportCaseHref(id: string): string {
  return `/profile/support?${SUPPORT_CASE_PARAM}=${encodeURIComponent(id)}`;
}
