/**
 * CRM task contracts. Source of truth: docs/CRM_DOMAIN_MODEL.md §11.
 */
import type {
  EmployeeId,
  ISODateString,
  UserId,
} from "@/domain/shared/primitives";

export type TaskStatus =
  | "open"
  | "in_progress"
  | "waiting_user"
  | "waiting_internal"
  | "completed"
  | "cancelled"
  | "overdue";

export type PriorityLevel = "critical" | "high" | "medium" | "low" | "none";

export interface CrmTask {
  id: string;
  title: string;
  type: string;
  userId: UserId | null;
  caseId: string | null;
  /** Task assignee (separate from the user's single primary owner, DECISIONS D-08). */
  owner: EmployeeId | null;
  createdBy: EmployeeId | "automation";
  source: "manual" | "automation" | "signal" | "recommended_action";
  reasonCode: string;
  priority: PriorityLevel;
  status: TaskStatus;
  dueAt: ISODateString | null;
  completedAt: ISODateString | null;
  outcome: string | null;
  followUpAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
