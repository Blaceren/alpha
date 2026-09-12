/**
 * Canonical employee directory — the single answer to "who is `emp_ret1`?".
 *
 * Before Phase 1B4-C the same question had three hand-maintained answers that had
 * already drifted: `OWNER_LABEL` in config/labels.ts (9 ids), `OWNER_IDS` in the
 * Users filter (6 ids), and the owners actually present in the fixtures (5 ids).
 * A fourth list — the owner picker — would have drifted too, so the lists are
 * derived from here instead.
 *
 * Deliberately NOT an HR model. There is no email, phone, team, workload, role
 * scope or active/inactive flag: none of them exists in the fixtures, and
 * inventing them would be a field that looks authoritative and answers wrongly
 * (the reason D-44 refused `scope: own | team`). Sensitivity of this data is LOW
 * (CRM_DOMAIN_MODEL §14) — synthetic ids and role-ish display names, no PII.
 */
import type { EmployeeId } from "@/domain/shared/primitives";

export interface CrmEmployee {
  readonly employeeId: EmployeeId;
  readonly displayName: string;
  /**
   * May this employee be picked as a user's primary owner?
   *
   * True only for the employees who are already primary owners somewhere in the
   * baseline fixtures. A candidate nobody owns would be an option that widens the
   * demo beyond what the synthetic dataset can show, and a fixture owner missing
   * from the list would be an owner the picker could never restore after a
   * reassignment. A consistency test pins the two sets to each other.
   */
  readonly primaryOwnerCandidate: boolean;
}

/**
 * Every synthetic employee id the project already uses. The non-candidates are
 * here so `employeeLabel()` keeps a caption for ids that appear as note authors
 * or as the demo session actor — dropping them would print a raw code.
 */
export const EMPLOYEE_DIRECTORY: readonly CrmEmployee[] = [
  { employeeId: "emp_admin", displayName: "Администратор", primaryOwnerCandidate: false },
  { employeeId: "emp_mgr", displayName: "Менеджер", primaryOwnerCandidate: true },
  { employeeId: "emp_ret1", displayName: "Retention 1", primaryOwnerCandidate: true },
  { employeeId: "emp_ret2", displayName: "Retention 2", primaryOwnerCandidate: true },
  { employeeId: "emp_men1", displayName: "Mentor 1", primaryOwnerCandidate: true },
  { employeeId: "emp_sup1", displayName: "Support 1", primaryOwnerCandidate: true },
  { employeeId: "emp_mod1", displayName: "Moderator 1", primaryOwnerCandidate: false },
  { employeeId: "emp_an1", displayName: "Analyst 1", primaryOwnerCandidate: false },
  { employeeId: "emp_mock_admin", displayName: "Demo Operator", primaryOwnerCandidate: false },
] as const;

/** Candidates in directory order — the order the picker offers them in. */
export const PRIMARY_OWNER_CANDIDATES: readonly CrmEmployee[] = EMPLOYEE_DIRECTORY.filter(
  (e) => e.primaryOwnerCandidate,
);

export function findEmployee(employeeId: EmployeeId | null | undefined): CrmEmployee | null {
  if (!employeeId) return null;
  return EMPLOYEE_DIRECTORY.find((e) => e.employeeId === employeeId) ?? null;
}

/**
 * Is this a legal target for `assignPrimaryOwner`? The provider validates against
 * this and nothing else, so the picker cannot widen the set by sending a value it
 * was never offered.
 */
export function isPrimaryOwnerCandidate(employeeId: EmployeeId): boolean {
  return PRIMARY_OWNER_CANDIDATES.some((e) => e.employeeId === employeeId);
}
