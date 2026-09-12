/**
 * CRM case contracts. Source of truth: docs/CRM_DOMAIN_MODEL.md §12.
 */
import type {
  EmployeeId,
  ISODateString,
  UserId,
} from "@/domain/shared/primitives";
import type { PriorityLevel } from "@/domain/tasks/task";

export type CaseType =
  | "retention"
  | "mentor"
  | "support"
  | "checkpoint"
  | "financial_data_conflict"
  | "pocket_connection"
  | "moderation"
  | "identity"
  | "communication"
  | "safety";

export type CaseStatus =
  | "open"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed"
  | "cancelled";

export interface CrmCase {
  id: string;
  userId: UserId;
  type: CaseType;
  status: CaseStatus;
  priority: PriorityLevel;
  owner: EmployeeId | null;
  sla: { dueAt: ISODateString | null; breached: boolean } | null;
  reason: string;
  taskIds: string[];
  noteIds: string[];
  outcome: string | null;
  closingReason: string | null;
  openedAt: ISODateString;
  closedAt: ISODateString | null;
}
