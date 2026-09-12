import bcrypt from "bcryptjs";
import { enqueueConversionPostbackSafely } from "@/lib/affiliate/postback/enqueue";
import { NextResponse } from "next/server";
import { toPublicUser } from "@/lib/auth";
import {
  ATTRIBUTION_COOKIE_NAME,
  clearedAttributionCookieOptions,
} from "@/lib/affiliate/attribution-cookie";
import { isAffiliateAttributionEnabled } from "@/lib/affiliate/attribution-config";
import { emitGrowthEvent } from "@/lib/growth/emit";
import { userSourceEventId } from "@/lib/growth/event-keys";
import {
  freezeAttribution,
  isVisitorAlreadyAttributed,
  recordRegistrationConversion,
  resolveRegistrationAttribution,
  type AcquisitionSelection,
} from "@/lib/affiliate/registration-attribution";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { verifyCaptcha } from "@/lib/captcha";
import { isEnrollmentDomainError } from "@/lib/curriculum/enrollment";
import { autoEnrollNewRegistrationInTransaction } from "@/lib/curriculum/registration-enrollment";
import { ACADEMY_REGISTER_SURFACE } from "@/lib/captcha/surface";
import { createEmailVerificationToken, isEmailVerificationRequired } from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import {
  resolveRegistrationReferral,
  revalidateReferralReward,
  type ReferralRewardState,
} from "@/lib/referral/registrationReferral";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  issueSession,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedLegacySessionCookieOptions,
  sessionCookieOptions,
} from "@/lib/session";
import { registerSchema, validateJsonBody } from "@/lib/validation";

/**
 * PHASE-F — the fail-closed answer when auto-enrollment is ON and the curriculum
 * configuration cannot deliver an enrollment.
 *
 * 503, not 500: the platform is temporarily unable to complete a registration it
 * would otherwise accept, and retrying after the configuration is fixed is the
 * correct behaviour for both the learner and the Academy's error mapping.
 *
 * The registration transaction has already rolled back by the time this runs, so
 * there is no account, no session and no learner identity to name — the audit
 * carries the bounded domain code and nothing else.
 */
async function enrollmentUnavailable(
  error: { code: string },
  request: Request,
): Promise<NextResponse> {
  await createAuditLog({
    action: "REGISTRATION_ENROLLMENT_FAILED",
    entityType: "API_ROUTE",
    entityId: "/api/auth/register",
    metadata: { code: error.code },
    request,
  });
  return NextResponse.json(
    {
      error: "REGISTRATION_UNAVAILABLE",
      message: "Регистрация временно недоступна. Попробуйте позже.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  const parsed = await validateJsonBody(request, registerSchema);
  const ip = getRequestIp(request);
  const email = parsed.success ? parsed.data.email : "invalid-email";
  const limit = rateLimit(`auth:register:${ip}`, {
    limit: 3,
    windowMs: 30 * 60 * 1000,
  });

  if (!limit.allowed) {
    await createAuditLog({
      action: "RATE_LIMITED",
      entityType: "API_ROUTE",
      entityId: "/api/auth/register",
      metadata: { email, resetAt: limit.resetAt },
      request,
    });

    return rateLimitedResponse();
  }

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/auth/register",
      metadata: { email, details: parsed.details },
      request,
    });

    return parsed.response;
  }

  const captcha = await verifyCaptcha({
    token: parsed.data.captchaToken,
    purpose: "register",
    // Registration has exactly ONE surface, so it is named here in source
    // rather than read from the request. Nothing a caller sends can change
    // which action this route will accept.
    surface: ACADEMY_REGISTER_SURFACE,
    request,
  });

  if (!captcha.ok) {
    // Fail closed BEFORE any database write. Nothing below this line has run,
    // so a rejected or unverifiable challenge leaves no user, no referral row
    // and no partial state — only an audit of the attempt.
    await createAuditLog({
      action: "CAPTCHA_REJECTED",
      entityType: "API_ROUTE",
      entityId: "/api/auth/register",
      // The outcome is a bounded internal code. The token is NOT recorded here
      // or anywhere else, and neither is the provider's raw answer.
      metadata: { email, outcome: captcha.outcome, code: captcha.code },
      request,
    });

    return NextResponse.json(
      { error: captcha.code, message: captcha.message },
      { status: captcha.status },
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "Email уже занят" },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  // AFD-3A2. Inviter validity and bonus availability are resolved as separate
  // facts (see src/lib/referral/registrationReferral.ts). Only an unknown or
  // blocked inviter rejects; an absent or inactive bonus programme does not.
  const referral = await resolveRegistrationReferral(prisma, parsed.data.referralCode);

  if (referral.kind === "invalid") {
    return NextResponse.json(
      { error: "REFERRAL_INVALID", message: "Реферальная ссылка недействительна" },
      { status: 400 },
    );
  }

  const accepted = referral.kind === "accepted" ? referral : null;

  // AFD-3B2 — acquisition attribution.
  //
  // Resolved HERE, after every gate that can reject the request and before the
  // transaction opens. After the gates, because a CAPTCHA failure, a duplicate
  // email or an invalid inviter must leave no trace in the acquisition ledger.
  // Before the transaction, because this is a read against several tables and
  // holding a write transaction open across it would lengthen the lock for no
  // reason.
  //
  // The ATA invitation referral above and this affiliate attribution are
  // INDEPENDENT and deliberately not merged: one is a learner inviting a friend
  // and the other is a paid acquisition channel. A registration can legitimately
  // have both, one, or neither, and neither cancels the other.
  //
  // Nothing below may throw on the attribution path in a way that fails the
  // registration. Resolution reads only, and every "no" it can return —
  // disabled, no cookie, forged cookie, expired cookie, nothing eligible — is a
  // direct registration, not an error.
  const attributionEnabled = isAffiliateAttributionEnabled();
  const now = new Date();
  const attribution = attributionEnabled
    ? await resolveRegistrationAttribution(prisma, request, now)
    : ({ kind: "unattributed", reason: "feature_disabled" } as const);

  // The transaction RETURNS the reward decision rather than assigning it to an
  // outer variable: the audit and notification steps below run after the commit
  // and must describe what the committed transaction actually did, not what was
  // predicted before it opened.
  //
  // `attributionCandidate` is a LET because the transaction may be re-run once,
  // without attribution, when a concurrent registration wins the same journey.
  let attributionCandidate: AcquisitionSelection | null =
    attribution.kind === "attributed" ? attribution.selection : null;

  const runRegistration = () => prisma.$transaction(async (tx) => {
    // Re-read the mutable conditions inside the transaction. Demotion only: a
    // withdrawn programme cancels the payout, it never cancels the account.
    const reward: ReferralRewardState | null = accepted
      ? await revalidateReferralReward(tx, accepted)
      : null;
    const bonus = accepted && reward === "payable" ? accepted.bonus : null;
    const invitedXp = bonus?.invitedXp ?? 0;
    let created = await tx.user.create({
      data: {
        email: parsed.data.email,
        passwordHash,
        role: "user",
        // The name is required by `registerSchema` now, so there is nothing to
        // fall back to. The generated `Трейдер-####` names that already exist
        // are left exactly as they are: this changes what the product accepts
        // next, not what it decided before.
        name: parsed.data.name,
        level: 1,
        xp: invitedXp,
        notificationSettings: {
          create: {
            emailEnabled: true,
            webPushEnabled: false,
            telegramEnabled: false,
          },
        },
      },
    });

    const tasks = await tx.task.findMany({ orderBy: { stepNumber: "asc" } });
    if (tasks.length > 0) {
      await tx.userTaskProgress.createMany({
        data: tasks.map((task, index) => ({
          userId: created.id,
          taskId: task.id,
          status: index === 0 ? "active" : "locked",
        })),
      });
      created = await tx.user.update({
        where: { id: created.id },
        data: { currentTask: tasks[0].title },
      });

      const checkpointTask = tasks.find(
        (task) => task.completionMethod === "balance_check" && task.balanceThreshold,
      );
      if (checkpointTask?.balanceThreshold) {
        await tx.checkpoint.create({
          data: {
            userId: created.id,
            title: checkpointTask.title,
            stepId: checkpointTask.stepNumber,
            requiredBalance: checkpointTask.balanceThreshold,
            currentBalance: 0,
            status: "active",
          },
        });
      }
      await tx.mentorChatDialog.create({
        data: {
          userId: created.id,
          status: "locked",
          unlockReason: "Доступ открывается после First Deposit / шага 4",
        },
      });
    }

    if (accepted) {
      // The relationship is recorded whenever the inviter is valid. When no
      // bonus is payable the row carries the schema's own "nothing granted"
      // shape — zero amounts and a NULL `bonusGrantedAt` — which is a fact
      // about this registration, not an invented zero-value reward.
      //
      // `invitedUserId` is `@unique`, so the relationship is unique per invitee
      // at the database level; a duplicate is impossible rather than merely
      // unlikely. Self-referral is likewise impossible: the invitee's row is
      // created in this same transaction and cannot own a pre-existing code.
      await tx.referral.create({
        data: {
          inviterUserId: accepted.inviterId,
          invitedUserId: created.id,
          xpEarned: bonus?.inviterXp ?? 0,
          invitedXpEarned: bonus?.invitedXp ?? 0,
          bonusGrantedAt: bonus ? new Date() : null,
        },
      });

      // Everything below is REWARD, and runs only when a reward is payable.
      // With no active configuration there is no inviter XP, no invitee XP and
      // no XpEvent of any kind — the ledger records nothing at all.
      if (bonus) {
        await tx.user.update({
          where: { id: accepted.inviterId },
          data: { xp: { increment: bonus.inviterXp } },
        });
        await tx.xpEvent.createMany({
          data: [
            { userId: accepted.inviterId, amount: bonus.inviterXp, source: "referral_inviter", sourceId: String(created.id) },
            { userId: created.id, amount: bonus.invitedXp, source: "referral_invited", sourceId: String(accepted.inviterId) },
          ],
        });
      }
    }

    // AFD-3B2. Attribution and the conversion event are written INSIDE this
    // transaction, after the user exists. Both are therefore covered by the
    // rollback: a registration that fails for any reason leaves no attribution
    // and no conversion event, and a conversion event that cannot be written
    // takes the registration down with it rather than leaving a learner the
    // ledger has no row for.
    let attributionId: number | null = null;
    if (attributionCandidate !== null) {
      attributionId = await freezeAttribution(tx, created.id, attributionCandidate, now);
    }

    let regConversionEventId: number | null = null;
    if (attributionEnabled) {
      const regConversion = await recordRegistrationConversion(tx, {
        userId: created.id,
        attributionId,
        selection: attributionCandidate,
        // CONV-TIME-1. This was `now` — a clock read taken at the top of the
        // handler, before the transaction opened. The row it writes declares
        // sourceOwner=auth_register and sourceEventId=user:<id>, i.e. it names
        // the User row as its source entity, so its instant must come from the
        // value the database actually persisted. Measured on the first real
        // attributed registration, the two were 11 ms apart, and this is the
        // table a commission period is computed from.
        //
        // Same rule, same transaction, as the ata_reg emit below: the owner owns
        // the instant, not the request clock.
        occurredAt: created.createdAt,
      });
      regConversionEventId = regConversion.conversionEventId;
    }

    // G4-GROWTH — the canonical ATA_REG event, for EVERY successful registration.
    //
    // DELIBERATELY NOT INSIDE THE `attributionEnabled` BRANCH ABOVE. The
    // affiliate conversion ledger only records registrations while attribution
    // is switched on, because its purpose is payout. The growth ledger's purpose
    // is the funnel, and a funnel whose denominator disappears when a marketing
    // flag is toggled is worse than no funnel — §10 requires exactly one ATA_REG
    // per successfully created user, and organic registration with no
    // attribution is explicitly still a registration.
    //
    // ONE PER USER, KEYED ON THE USER ID. Not the email: an address is mutable
    // and re-registrable, so keying on it would let one learner produce two
    // registrations by changing it.
    //
    // IN THIS TRANSACTION, so a rolled-back registration leaves no event. Using
    // the strict emitter rather than the safe one is intentional here and
    // matches the accepted reasoning for the conversion row directly above: a
    // learner who exists with no growth event is a silent hole nothing
    // downstream can detect, whereas a failed registration is loud and
    // retryable.
    // THE OWNER OWNS THE INSTANT, NOT THE REQUEST CLOCK.
    //
    // This used to be `occurredAt: now` — a `new Date()` read taken at the top
    // of the handler, before the transaction opened. `created.createdAt` is the
    // value the database actually persisted, and the two are not the same
    // instant: on the first runtime registration this family ever saw they were
    // 3 ms apart, and the ledger verifier reported the divergence.
    //
    // WHICH ONE IS CANONICAL IS NOT A PREFERENCE. `GROWTH_SOURCE_ENTITY_TYPES`
    // declares `ata_reg -> "User"`, and the backfill projection in
    // scripts/ops/verifyGrowthLedgerProjection.ts derives `occurredAt` from
    // `User.createdAt` for exactly the users an `AUTH_REGISTER` audit row
    // qualifies. The audit row is the MEMBERSHIP predicate; the `User` row owns
    // the fact — "the registration event is the account coming into existence",
    // as event-keys.ts puts it. So backfill and runtime must read the same
    // column, and this reads it.
    //
    // The Pocket family has always done this (`occurredAt: identity.boundAt`,
    // never `now()`), which is why `pocket_reg` reconciled at divergent=0 while
    // this family did not.
    await emitGrowthEvent(tx, {
      eventType: "ata_reg",
      occurredAt: created.createdAt,
      sourceEventId: userSourceEventId(created.id),
      sourceEntityId: created.id,
      userId: created.id,
      attributionId,
      acquisitionClickId: attributionCandidate?.selectedClickId ?? null,
    });

    // PHASE-F — automatic curriculum enrollment, INSIDE this transaction.
    //
    // Last, deliberately: the learner, their legacy task progress, the referral
    // relationship and the attribution are all established first, so the
    // enrollment is written against a complete registration rather than a
    // half-built one, and so nothing above changes shape when the flag is off.
    //
    // OFF (the default, and the live state today) → a no-op that reads and
    // writes nothing, and every line of this transaction behaves exactly as it
    // did before this phase.
    //
    // ON → an enrollment pinned to the single active published curriculum. A
    // refusal THROWS, which rolls this whole transaction back: no user, no
    // referral, no attribution, no conversion event. The handler below turns
    // that into an explicit 503 rather than a 201, because a registration that
    // silently failed to deliver the curriculum is worse than one that visibly
    // did not happen.
    const enrollment = await autoEnrollNewRegistrationInTransaction(tx, {
      userId: created.id,
      asOf: now,
    });

    return { created, reward, bonus, attributionId, enrollment, regConversionEventId };
  });

  // THE REPLAY AND CONCURRENCY BOUNDARY.
  //
  // A copied token, or two browsers registering from the same journey at the
  // same instant, both arrive here believing they are attributed. The database
  // decides: `AffiliateAttribution.anonymousVisitorId` is UNIQUE, so exactly one
  // transaction can commit with it and the other fails.
  //
  // The loser retries ONCE, without attribution, and becomes an honest direct
  // registration. That is the only arrangement in which all three things stay
  // true: both people get the account they asked for, exactly one attribution
  // exists, and no affiliate is paid twice for one journey.
  //
  // The retry is bounded to a single attempt. The second run cannot hit the same
  // collision, because it does not touch AffiliateAttribution at all — so a loop
  // here could never make progress that one pass does not, and an unbounded one
  // would be a way to hold the database open.
  let committed: Awaited<ReturnType<typeof runRegistration>>;
  try {
    committed = await runRegistration();
  } catch (error) {
    // PHASE-F. An enrollment refusal is NOT an attribution collision and must
    // never be retried as one: re-running the transaction would hit the same
    // broken curriculum configuration, and dropping attribution to "fix" it
    // would corrupt the acquisition ledger for a reason unrelated to it. It
    // leaves this handler as an explicit, bounded 503.
    if (isEnrollmentDomainError(error)) return enrollmentUnavailable(error, request);
    if (attributionCandidate === null || !isVisitorAlreadyAttributed(error)) throw error;
    // The whole transaction rolled back, so no partial user exists to clean up.
    attributionCandidate = null;
    try {
      committed = await runRegistration();
    } catch (retryError) {
      if (isEnrollmentDomainError(retryError)) return enrollmentUnavailable(retryError, request);
      throw retryError;
    }
  }

  // AFFILIATE-PLATFORM-V1 §25/§39 — the partner's outbound REG notification.
  //
  // AFTER THE COMMIT, AND IT CANNOT FAIL THE REGISTRATION. A learner creating an
  // account must never depend on a third party's HTTP endpoint, and enqueueing
  // is idempotent per (conversion, endpoint, version), so a failure here is
  // deferred rather than lost.
  //
  // ONLY FOR AN ATTRIBUTED REGISTRATION, because an unattributed one has no
  // partner to tell. The enqueue owner reaches the same conclusion on its own
  // and answers `unattributed`; this branch simply avoids asking.
  if (committed.regConversionEventId !== null) {
    await enqueueConversionPostbackSafely(committed.regConversionEventId, now, prisma);
  }

  const user = committed.created;
  const verificationRequired = isEmailVerificationRequired();
  const verificationToken = verificationRequired
    ? await createEmailVerificationToken(user.id)
    : null;

  await createAuditLog({
    userId: user.id,
    action: "AUTH_REGISTER",
    metadata: { email: parsed.data.email },
    request,
  });

  if (accepted) {
    const { reward, bonus } = committed;

    // The relationship is always audited, whether or not it paid. Previously
    // only a PAID referral left a trace, so a relationship formed under an
    // inactive programme was invisible to support.
    await createAuditLog({
      userId: accepted.inviterId,
      action: "REFERRAL_RELATION_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: { reward: reward ?? "not_configured" },
      request,
    });

    if (bonus) {
      await prisma.notification.createMany({
        data: [
          {
            userId: accepted.inviterId,
            type: "referral_bonus",
            title: "Реферальный бонус",
            message: `Начислено ${bonus.inviterXp} XP за приглашённого пользователя.`,
            metadata: { invitedUserId: user.id },
          },
          {
            userId: user.id,
            type: "referral_bonus",
            title: "Стартовый реферальный бонус",
            message: `Начислено ${bonus.invitedXp} XP.`,
            metadata: { inviterUserId: accepted.inviterId },
          },
        ],
      });
      await createAuditLog({
        userId: accepted.inviterId,
        action: "REFERRAL_BONUS_GRANTED",
        entityType: "User",
        entityId: user.id,
        metadata: { inviterXp: bonus.inviterXp, invitedXp: bonus.invitedXp },
        request,
      });
    }
    // No `else`. With no payable bonus there is no notification promising XP
    // that was never granted — the invitee simply has an account.
  }

  const response = NextResponse.json(
    {
      user: toPublicUser(user),
      verification: {
        required: verificationRequired,
        devToken:
          verificationRequired && process.env.NODE_ENV !== "production"
            ? verificationToken
            : undefined,
      },
    },
    { status: 201 },
  );
  if (!verificationRequired) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await issueSession(user.id),
      sessionCookieOptions,
    );
  }

  // AFD-3B2 — the journey is over, so the pointer to it goes.
  //
  // Cleared on EVERY successful registration, not only an attributed one. A
  // token that survives is a token that can be replayed, and one that was
  // consumed here is now worthless while one that was not eligible will not
  // become eligible later. Leaving it would only mean a browser carrying a
  // stale journey into somebody else's signup.
  //
  // This produces a SECOND Set-Cookie on an unverified-email-free registration.
  // Both are emitted as separate header values — Next.js `cookies.set` appends
  // rather than replaces — and the Academy proxy re-emits each one individually
  // via `getSetCookie()`, so neither cookie can be swallowed by the other or
  // joined into one comma-separated line.
  //
  // Only cleared when the request actually carried one: sending a deletion to a
  // browser that has no attribution cookie is noise in every response. A cookie
  // that was present but unusable — forged, expired, or naming a journey with
  // nothing eligible in it — is cleared too, so the browser stops re-presenting
  // something that will never work.
  const carriedAttributionCookie =
    attribution.kind === "attributed" ||
    (attribution.reason !== "feature_disabled" && attribution.reason !== "no_cookie");

  if (attributionEnabled && carriedAttributionCookie) {
    response.cookies.set(ATTRIBUTION_COOKIE_NAME, "", clearedAttributionCookieOptions());
  }

  return response;
}
