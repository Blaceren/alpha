/**
 * The Today read query: what the UI may ask for. Filter SEMANTICS live in the
 * builder (domain), never in React — the UI passes this shape and renders the
 * result it gets back.
 *
 * Deliberately absent: a `scope: own | team` filter. The contract once declared
 * one, but the mock session gives every role the same `emp_mock_admin` actor id
 * while fixture owners are `emp_ret1`/`emp_men1`/…, so "my queue" would always
 * be empty — a filter that looks real and answers wrongly. The honest
 * equivalent, `ownerId` (including "unassigned"), is offered instead (D-44).
 *
 * Framework-agnostic — no React/Next imports.
 */
import type { EmployeeId } from "@/domain/shared/primitives";
import type { PriorityBand } from "@/domain/priority/priority";
import type { SlaState } from "@/domain/users/user-360";
import type { TodayBasisCode, TodaySectionKey } from "@/config/queues";
import type { TodaySortField } from "./today";

export interface TodayFilters {
  priority?: PriorityBand[];
  /** Тип основания — matches ANY of the user's bases, not just the visible one. */
  basis?: TodayBasisCode[];
  section?: TodaySectionKey[];
  ownerId?: EmployeeId[] | "unassigned";
  sla?: SlaState[];
  /** Free text over the PERMITTED identity projection only (§24). */
  query?: string;
}

export interface TodayQuery {
  filters?: TodayFilters;
  sort?: TodaySortField;
}
