import type { EmployeeSession } from "@/domain/identity/session";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";

/** Build the provider CrmContext from the current (mock) employee session. */
export function contextFromSession(session: EmployeeSession): CrmContext {
  return {
    actorId: session.employeeId,
    role: session.role,
    now: new Date().toISOString(),
  };
}
