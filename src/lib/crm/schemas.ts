import { z } from "zod";
import { CRM_PERMISSIONS, CRM_STAFF_ROLES } from "./roles";

// Runtime contract for the CRM session DTO. Kept strict so the response can
// never carry an unexpected key (no learner payload leakage).
export const staffRoleSchema = z.enum(CRM_STAFF_ROLES);
export const crmPermissionSchema = z.enum(CRM_PERMISSIONS);

export const crmSessionResponseSchema = z
  .object({
    employeeId: z.string().min(1),
    displayName: z.string().min(1),
    role: staffRoleSchema,
    effectivePermissions: z.array(crmPermissionSchema),
    permissionVersion: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type CrmSessionResponse = z.infer<typeof crmSessionResponseSchema>;

// Runtime contract for the CRM users list (v1). Strict at every level so an
// extra key — a stray financial field, an owner id, a raw Prisma column —
// fails serialization here instead of reaching the client.
export const crmUserListItemSchema = z
  .object({
    // User.id serialized as an opaque decimal string. Clients must not parse it.
    userId: z.string().min(1),
    displayName: z.string().min(1),
    email: z
      .object({
        value: z.string().min(1),
        visibility: z.enum(["full", "masked"]),
      })
      .strict(),
    status: z.enum(["active", "blocked"]),
    level: z.number().int(),
    emailConfirmed: z.boolean(),
    createdAt: z.string().datetime(),
    // Current learner owner — displayName only, or null. Strict, so an owner
    // employeeId, internal ownerId, ownerVersion, StaffRole, email, status or
    // timestamp can never ride along. `null` covers BOTH the pristine no-row
    // state and a persisted row whose ownerId is null; the list does not
    // distinguish them. The name is the live StaffProfile.displayName, resolved
    // through the relation and never snapshotted.
    owner: z
      .object({
        displayName: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const crmUsersResponseSchema = z
  .object({
    items: z.array(crmUserListItemSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmUsersResponse = z.infer<typeof crmUsersResponseSchema>;

// Runtime contract for the CRM user detail foundation (v1). Strict so an extra
// key — an owner id, a financial value, a raw Prisma column — fails here rather
// than reaching the client.
//
// `xp` is nonnegative by a proven backend invariant: User.xp starts at 0, no
// code path decrements it, task rewards are `Int @default(0)` validated
// `min(0)`, promocode awards hard-fail below 1, referral bonuses are positive
// defaults with no write path, and the admin update validates `min(0)`.
// `level` keeps the same plain-integer shape as the accepted Users v1 contract
// so the two endpoints stay adapter-compatible.
export const crmUserDetailResponseSchema = z
  .object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
    email: z
      .object({
        value: z.string().min(1),
        visibility: z.enum(["full", "masked"]),
      })
      .strict(),
    status: z.enum(["active", "blocked"]),
    level: z.number().int(),
    xp: z.number().int().nonnegative(),
    emailConfirmed: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type CrmUserDetailResponse = z.infer<typeof crmUserDetailResponseSchema>;

// Runtime contract for CRM user notes (v1). Strict at every level, so a field
// that Notes v1 deliberately does not expose — employeeId, authorId, author or
// learner email, StaffRole, effectivePermissions, updatedAt, deletedAt,
// visibility, pinned, caseId, capabilities, audit metadata — fails
// serialization here instead of reaching the client.
export const crmUserNoteItemSchema = z
  .object({
    noteId: z.string().min(1),
    body: z.string().min(1),
    // The author's CURRENT StaffProfile display name. Never an id, never an
    // email, and never a stored snapshot.
    authorDisplayName: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export type CrmUserNoteItem = z.infer<typeof crmUserNoteItemSchema>;

export const crmUserNotesResponseSchema = z
  .object({
    items: z.array(crmUserNoteItemSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmUserNotesResponse = z.infer<typeof crmUserNotesResponseSchema>;

// POST returns the created note directly — the same item shape as GET, so the
// client validates one shape, not two.
export const crmUserNoteCreatedSchema = crmUserNoteItemSchema;

// Runtime contract for CRM learner owner (v1). Strict at every level, so a
// field Owner v1 deliberately does NOT expose — the owner's email, User.id,
// userId, internal ownerId, StaffRole, UserRole, permissions,
// effectivePermissions, permissionVersion, status, createdAt/updatedAt,
// history, audit metadata or reason — fails serialization here instead of
// reaching the client. The owner identity is exactly two fields; ownerVersion
// is the opaque optimistic-concurrency token.
export const crmOwnerIdentitySchema = z
  .object({
    employeeId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export type CrmOwnerIdentity = z.infer<typeof crmOwnerIdentitySchema>;

export const crmOwnerResponseSchema = z
  .object({
    owner: crmOwnerIdentitySchema.nullable(),
    // 0 for pristine, never-mutated state; monotonic and never reset thereafter.
    ownerVersion: z.number().int().nonnegative(),
  })
  .strict();

export type CrmOwnerResponse = z.infer<typeof crmOwnerResponseSchema>;

// A candidate is exactly the same two fields as an owner identity — an id to
// send and a caption to show. StaffRole is deliberately absent: exposing it
// would imply a book the backend does not model and leak the role axis.
export const crmOwnerCandidateSchema = crmOwnerIdentitySchema;

export type CrmOwnerCandidate = z.infer<typeof crmOwnerCandidateSchema>;

export const crmOwnerCandidatesResponseSchema = z
  .object({
    items: z.array(crmOwnerCandidateSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmOwnerCandidatesResponse = z.infer<typeof crmOwnerCandidatesResponseSchema>;

// Runtime contract for CRM learner owner HISTORY (OH-1). Strict at every level,
// so a field the history read deliberately does NOT expose — a raw actor/owner
// id under a different key, an email, StaffRole, IP, User-Agent, AuditLog
// metadata, reason, or any internal Prisma field — fails serialization here
// instead of reaching the client. Each staff reference is exactly an opaque id
// plus a display-safe label; the transition is a closed enum derived server-side.
export const crmOwnerHistoryActorSchema = z
  .object({
    employeeId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export type CrmOwnerHistoryActorDto = z.infer<typeof crmOwnerHistoryActorSchema>;

export const crmOwnerHistoryItemSchema = z
  .object({
    historyId: z.string().min(1),
    transition: z.enum(["assigned", "reassigned", "unassigned"]),
    ownerVersion: z.number().int().positive(),
    createdAt: z.string().datetime(),
    actor: crmOwnerHistoryActorSchema,
    previousOwner: crmOwnerHistoryActorSchema.nullable(),
    nextOwner: crmOwnerHistoryActorSchema.nullable(),
  })
  .strict();

export type CrmOwnerHistoryItemDto = z.infer<typeof crmOwnerHistoryItemSchema>;

export const crmOwnerHistoryResponseSchema = z
  .object({
    items: z.array(crmOwnerHistoryItemSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmOwnerHistoryResponse = z.infer<typeof crmOwnerHistoryResponseSchema>;

// Safe CRM error envelope. Never carries raw exceptions or resource existence.
export const crmErrorResponseSchema = z
  .object({
    code: z.string(),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmErrorResponse = z.infer<typeof crmErrorResponseSchema>;

/* ------------------------------------------------ AFD-2 affiliate contracts */

// Every affiliate DTO is `.strict()` for the same reason the learner DTOs are:
// a column added to these tables later — a click count, an attribution id, a
// provider amount — must fail serialization here rather than silently appear in
// a response that promised not to carry it.

const affiliateEntityStatusSchema = z.enum(["active", "paused", "archived"]);
const affiliateLinkStatusSchema = z.enum(["draft", "paused", "archived"]);
// Stored status answers "what did an operator set"; availability answers "could
// this be used". Both ship, because collapsing them hides either the operator's
// choice or the reason a child is unusable.
const affiliateAvailabilitySchema = z.enum(["available", "paused", "archived"]);

export const affiliatePartnerSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().nullable(),
    status: affiliateEntityStatusSchema,
    availability: affiliateAvailabilitySchema,
    defaultAttributionWindowDays: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();

export const affiliatePartnerListSchema = z
  .object({
    items: z.array(affiliatePartnerSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const affiliateCampaignSchema = z
  .object({
    id: z.string().min(1),
    affiliatePartnerId: z.string().min(1),
    affiliatePartnerCode: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
    notes: z.string().nullable(),
    status: affiliateEntityStatusSchema,
    availability: affiliateAvailabilitySchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();

export const affiliateCampaignListSchema = z
  .object({
    items: z.array(affiliateCampaignSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const affiliateTrackingLinkSchema = z
  .object({
    id: z.string().min(1),
    affiliatePartnerId: z.string().min(1),
    affiliatePartnerCode: z.string().min(1),
    affiliateCampaignId: z.string().min(1).nullable(),
    affiliateCampaignCode: z.string().min(1).nullable(),
    publicCode: z.string().length(32),
    displayName: z.string().min(1),
    status: affiliateLinkStatusSchema,
    availability: affiliateAvailabilitySchema,
    // A logical key, never a URL. The DTO carries no `url` field at all, so a
    // CRM cannot render — and an operator cannot copy — a link that would
    // resolve to anything before AFD-3B builds the public route.
    landingKey: z.literal("academy_registration"),
    externalClickParameter: z.string().min(1),
    subParameters: z
      .object({
        sub1: z.string().nullable(),
        sub2: z.string().nullable(),
        sub3: z.string().nullable(),
        sub4: z.string().nullable(),
        sub5: z.string().nullable(),
      })
      .strict(),
    attributionWindowDays: z.number().int().positive().nullable(),
    effectiveAttributionWindowDays: z.number().int().positive(),
    // The two fields that keep this phase honest. No click count, no conversion
    // count and no zero-valued analytics field appears anywhere in this DTO,
    // because a zero would read as "tracking is running and found nothing".
    publicRouteState: z.literal("not_available_until_afd3b"),
    activationState: z.literal("unavailable"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .strict();

export const affiliateTrackingLinkListSchema = z
  .object({
    items: z.array(affiliateTrackingLinkSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export type AffiliatePartnerDto = z.infer<typeof affiliatePartnerSchema>;
export type AffiliateCampaignDto = z.infer<typeof affiliateCampaignSchema>;
export type AffiliateTrackingLinkDto = z.infer<typeof affiliateTrackingLinkSchema>;
