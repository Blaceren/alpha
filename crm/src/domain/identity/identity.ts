/**
 * Identity contracts. Source of truth: docs/CRM_DOMAIN_MODEL.md §2 + PII_ACCESS_POLICY.md.
 * Full email is RESTRICTED and only revealed via the reveal-flow for permitted roles.
 */
import type { ISODateString, UserId } from "@/domain/shared/primitives";

export interface UserIdentity {
  userId: UserId;
  displayName: string;
  /** Always masked in lists (e.g. "a***@g***.com"). */
  maskedEmail: string;
  emailConfirmed: boolean;
  country: string | null;
  locale: string | null;
  registeredAt: ISODateString;
  externalRefs: {
    pocketLinked: boolean;
    /** Opaque reference/hash — never a raw playerId. */
    pocketPlayerRef: string | null;
  };
}
