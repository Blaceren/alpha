/**
 * PHASE-G0 — the authoring foundation regression.
 *
 * DISPOSABLE DATABASE ONLY. Builds a throwaway SQLite file from the FULL
 * migration chain, proves the foundation against it, and deletes it. Nothing
 * here touches preprod, and no test sets CURRICULUM_V2_ADMIN_ENABLED on any
 * real environment.
 *
 * WHAT IT MUST PROVE, and why each one is here rather than assumed:
 *   • the migration chain applies from empty AND the new columns actually exist
 *   • a pre-existing published row survives with NO fabricated approval
 *   • the aggregate revision guard refuses a stale write and the WINNER'S write
 *     survives byte-identically — the specific failure a per-row guard misses
 *   • the permission matrix grants and refuses exactly what the product decided
 *   • self-approval is refused BY THE DOMAIN, not by a hidden button
 *   • approval does not publish
 *   • an approved version is immutable
 *   • review notes append, resolve, and cannot name two targets
 *   • the 58 contracts bootstrap with 232 takes / 232 questions / 232 mappings,
 *     fingerprints server-computed, L2 conflict and L18 provenance intact, and
 *     NOTHING mass-approved
 *   • a semantic edit makes evidence stale, a cosmetic one does not
 *   • the validator accepts a good draft and names every bad one
 *   • every lifecycle mutation leaves audit evidence
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-authoring-foundation-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, error: message });
    console.error(`FAIL ${name}`);
    console.error(message);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** A minimal v2 body that satisfies the block contract and the prose floor. */
function goodBody(marker: string) {
  const paragraph =
    "Дисциплина в торговле начинается с плана, который написан до открытия позиции. " +
    "План отвечает на три вопроса: где вход, где выход и сколько капитала под риском. " +
    "Пока эти ответы не записаны, любое движение цены выглядит как повод действовать. " +
    "Записанный план превращает решение в проверку условий, а не в реакцию на эмоцию. ";
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      {
        code: `intro-${marker}`,
        title: `Введение ${marker}`,
        blocks: [
          { type: "heading", level: 3, text: "Почему план важнее прогноза" },
          { type: "rich_text", text: paragraph.repeat(2) },
          {
            type: "callout",
            variant: "risk",
            title: "Риск",
            body: "Торговля сопряжена с риском потери капитала.",
          },
          {
            type: "list",
            ordered: true,
            items: ["Определите вход", "Определите выход", "Определите риск"],
          },
        ],
      },
    ],
  };
}

async function main() {
  cleanupDb();
  const runner = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const notes = await import("../../src/lib/curriculum/authoring-review-notes");
  const video = await import("../../src/lib/curriculum/video-production-authoring");
  const validation = await import("../../src/lib/curriculum/authoring-validation");
  const roles = await import("../../src/lib/crm/roles");
  const authz = await import("../../src/lib/curriculum/authoring-authorization");
  const contract = await import("../../src/lib/curriculum/video-production-contract");
  const constants = await import("../../src/lib/curriculum/constants");

  /* ---------------------------------------------------------------- seed */

  const admin = await prisma.user.create({
    data: { email: "g0-admin@example.com", name: "Legacy Admin", role: "admin" },
  });
  const learner = await prisma.user.create({
    data: { email: "g0-learner@example.com", name: "Learner" },
  });

  async function staff(email: string, staffRole: string) {
    const user = await prisma.user.create({ data: { email, name: email } });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: email, staffRole: staffRole as never },
    });
    return user;
  }

  const editor = await staff("g0-editor@example.com", "content_manager");
  const editorTwo = await staff("g0-editor2@example.com", "content_manager");
  const approver = await staff("g0-approver@example.com", "crm_admin");
  const readOnly = await staff("g0-readonly@example.com", "read_only");
  const mentor = await staff("g0-mentor@example.com", "mentor");
  const support = await staff("g0-support@example.com", "support");
  const analyst = await staff("g0-analyst@example.com", "analyst");

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "g0-authoring", name: "G0 Authoring", versionNumber: 1 },
  });
  const moduleRow = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleNumber: 1,
      code: "g0-module",
      title: "G0",
      firstLevel: 1,
      lastLevel: 100,
    },
  });
  const levels = new Map<number, number>();
  for (let n = 1; n <= 100; n += 1) {
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleRow.id,
        levelNumber: n,
        stableCode: `v2.l${String(n).padStart(3, "0")}.g0`,
        type: "lesson",
        title: `Level ${n}`,
        completionMethod: "manual",
      },
    });
    levels.set(n, level.id);
  }

  try {
    /* ------------------------------------------------- migration honesty */

    await check("1 the new columns exist on both aggregates", async () => {
      for (const table of ["ContentVersion", "AssessmentVersion"]) {
        const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          `PRAGMA table_info("${table}")`,
        );
        const names = new Set(columns.map((column) => column.name));
        for (const expected of [
          "revision",
          "editorialState",
          "lastAuthoredById",
          "lastAuthoredAt",
          "submittedById",
          "submittedAt",
          "changesRequestedById",
          "changesRequestedAt",
          "approvedById",
          "approvedAt",
        ]) {
          assert.ok(names.has(expected), `${table}.${expected} missing`);
        }
      }
    });

    await check("2 a pre-existing PUBLISHED row gets NO fabricated approval", async () => {
      // Written with raw SQL so it bypasses the authoring domain entirely — this
      // is what an upgraded historical row looks like.
      const level = levels.get(1)!;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ContentVersion" ("levelDefinitionId","curriculumVersionId","versionNumber","status","publishedAt","createdAt","updatedAt")
         VALUES (?, ?, ?, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        level,
        curriculum.id,
        99,
      );
      const row = await prisma.contentVersion.findFirst({
        where: { levelDefinitionId: level, versionNumber: 99 },
      });
      assert.ok(row);
      // The runtime axis is preserved exactly.
      assert.equal(row.status, "published");
      // The editorial axis makes no claim about it.
      assert.equal(row.editorialState, "draft");
      assert.equal(row.approvedById, null);
      assert.equal(row.approvedAt, null);
      assert.equal(row.submittedById, null);
      assert.equal(row.revision, 1);
    });

    /* ------------------------------------------------------- permissions */

    await check("3 the permission matrix decides exactly what the product decided", () => {
      const perms = (role: string) => roles.resolveEffectivePermissions(role);

      // content_manager authors but may never approve.
      assert.ok(roles.canAuthorCurriculum(perms("content_manager")));
      assert.ok(roles.canReadCurriculumAuthoring(perms("content_manager")));
      assert.ok(!roles.canApproveCurriculum(perms("content_manager")));

      // crm_admin is the single approving role.
      assert.ok(roles.canApproveCurriculum(perms("crm_admin")));

      // read_only reads and nothing else.
      assert.ok(roles.canReadCurriculumAuthoring(perms("read_only")));
      assert.ok(!roles.canAuthorCurriculum(perms("read_only")));
      assert.ok(!roles.canApproveCurriculum(perms("read_only")));

      // Nobody else gets any of it — mentor and support especially.
      for (const role of ["mentor", "support", "moderator", "analyst", "retention_manager"]) {
        assert.ok(!roles.canApproveCurriculum(perms(role)), `${role} must not approve`);
        assert.ok(!roles.canAuthorCurriculum(perms(role)), `${role} must not author`);
      }
      // crm_manager reads only.
      assert.ok(roles.canReadCurriculumAuthoring(perms("crm_manager")));
      assert.ok(!roles.canAuthorCurriculum(perms("crm_manager")));
      assert.ok(!roles.canApproveCurriculum(perms("crm_manager")));

      // An unknown role fails closed rather than being guessed.
      assert.deepEqual(perms("not_a_role"), []);
    });

    // Load the identity exactly as the gate does, from the real rows.
    async function identity(userId: number) {
      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          status: true,
          staffProfile: { select: { staffRole: true } },
        },
      });
    }

    await check("4 the gate composes both auth axes on the SAME user identity", async () => {
      assert.equal(authz.permissionForCapability("read"), "curriculum_read");
      assert.equal(authz.permissionForCapability("author"), "curriculum_author");
      assert.equal(authz.permissionForCapability("approve"), "curriculum_approve");

      // PATH A — the legacy UserRole=admin compatibility authority still holds
      // every capability, and carries no staff role.
      for (const capability of ["read", "author", "approve"] as const) {
        const decision = authz.authorizeAuthoringIdentity(await identity(admin.id), capability);
        assert.equal(decision.ok, true, `admin must keep ${capability}`);
        if (decision.ok) {
          assert.equal(decision.actor.kind, "user_role_admin");
          assert.equal(decision.actor.staffRole, null);
          assert.equal(decision.actor.actorId, admin.id);
        }
      }

      // PATH B — a CRM staff actor is authorized on the SAME User row, via the
      // StaffProfile that extends it. No second account, no translation.
      const decision = authz.authorizeAuthoringIdentity(await identity(editor.id), "author");
      assert.equal(decision.ok, true);
      if (decision.ok) {
        assert.equal(decision.actor.kind, "crm_staff");
        assert.equal(decision.actor.staffRole, "content_manager");
        assert.equal(decision.actor.actorId, editor.id);
      }

      // A staff actor does NOT become an admin.
      const editorRow = await identity(editor.id);
      assert.equal(editorRow?.role, "user");
    });

    await check("5 every role is authorized exactly as the product decided", async () => {
      const expected: Array<[number, string, boolean, boolean, boolean]> = [
        // actor, label, read, author, approve
        [editor.id, "content_manager", true, true, false],
        [approver.id, "crm_admin", true, true, true],
        [readOnly.id, "read_only", true, false, false],
        [mentor.id, "mentor", false, false, false],
        [support.id, "support", false, false, false],
        [analyst.id, "analyst", false, false, false],
        [learner.id, "learner (no StaffProfile)", false, false, false],
      ];
      for (const [userId, label, read, author, approve] of expected) {
        const row = await identity(userId);
        assert.equal(authz.authorizeAuthoringIdentity(row, "read").ok, read, `${label} read`);
        assert.equal(authz.authorizeAuthoringIdentity(row, "author").ok, author, `${label} author`);
        assert.equal(authz.authorizeAuthoringIdentity(row, "approve").ok, approve, `${label} approve`);
      }

      // A learner is 403 (authenticated, not staff), never accidentally 200.
      const learnerRow = await identity(learner.id);
      const denial = authz.authorizeAuthoringIdentity(learnerRow, "read");
      assert.equal(denial.ok, false);
      if (!denial.ok) assert.equal(denial.status, 403);

      // No session at all is 401, and a blocked account is 401 too.
      assert.deepEqual(authz.authorizeAuthoringIdentity(null, "read"), { ok: false, status: 401 });
      assert.deepEqual(
        authz.authorizeAuthoringIdentity(
          { id: 1, role: "admin", status: "blocked", staffProfile: null },
          "read",
        ),
        { ok: false, status: 401 },
      );

      // An unrecognised stored staff role fails closed rather than being guessed.
      assert.deepEqual(
        authz.authorizeAuthoringIdentity(
          { id: 1, role: "user", status: "active", staffProfile: { staffRole: "not_a_role" } },
          "read",
        ),
        { ok: false, status: 403 },
      );
    });

    /* --------------------------------------------------------- lifecycle */

    async function newContentVersion(levelNumber: number, versionNumber: number) {
      return prisma.contentVersion.create({
        data: {
          levelDefinitionId: levels.get(levelNumber)!,
          curriculumVersionId: curriculum.id,
          versionNumber,
          createdById: editor.id,
          lastAuthoredById: editor.id,
          lastAuthoredAt: new Date(),
        },
      });
    }

    await check("6 draft -> submit -> changes requested -> submit -> approve", async () => {
      const version = await newContentVersion(2, 1);

      const submitted = await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: editor.id,
      });
      assert.equal(submitted.editorialState, "submitted_for_review");

      const returned = await lifecycle.requestChanges({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: approver.id,
      });
      assert.equal(returned.editorialState, "changes_requested");

      // The author edits, which bumps the aggregate.
      await prisma.$transaction(async (tx) => {
        await lifecycle.bumpAggregate(tx, {
          kind: "content",
          id: version.id,
          expectedRevision: 1,
          actorId: editor.id,
        });
      });

      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 2,
        actorId: editor.id,
      });

      const approved = await lifecycle.approveVersion({
        kind: "content",
        id: version.id,
        expectedRevision: 2,
        actorId: approver.id,
        validationPassed: true,
      });
      assert.equal(approved.editorialState, "approved");

      const row = await prisma.contentVersion.findUniqueOrThrow({ where: { id: version.id } });
      assert.equal(row.approvedById, approver.id);
      assert.ok(row.approvedAt);
      assert.equal(row.submittedById, editor.id);
    });

    await check("7 APPROVAL DOES NOT PUBLISH", async () => {
      const row = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: levels.get(2)!, versionNumber: 1 },
      });
      assert.equal(row.editorialState, "approved");
      // The runtime axis is untouched by the editorial one.
      assert.equal(row.status, "draft");
      assert.equal(row.publishedAt, null);
      const bindings = await prisma.levelResourceBinding.count({
        where: { contentVersionId: row.id },
      });
      assert.equal(bindings, 0);
    });

    await check("8 an APPROVED version is immutable to in-place edits", async () => {
      const row = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: levels.get(2)!, versionNumber: 1 },
      });
      await assert.rejects(
        prisma.$transaction((tx) =>
          lifecycle.bumpAggregate(tx, {
            kind: "content",
            id: row.id,
            expectedRevision: row.revision,
            actorId: editor.id,
          }),
        ),
        (error: unknown) =>
          error instanceof Error && error.message.includes("approved"),
      );
    });

    await check("9 a SUBMITTED version cannot be edited in place either", async () => {
      const version = await newContentVersion(3, 1);
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: editor.id,
      });
      await assert.rejects(
        prisma.$transaction((tx) =>
          lifecycle.bumpAggregate(tx, {
            kind: "content",
            id: version.id,
            expectedRevision: 1,
            actorId: editor.id,
          }),
        ),
        (error: unknown) => error instanceof Error && error.message.includes("awaiting review"),
      );
    });

    /* ------------------------------------------------------ self-approval */

    await check("10 SELF-APPROVAL IS REFUSED BY THE DOMAIN", async () => {
      const version = await newContentVersion(4, 1);
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: approver.id,
      });
      // `approver` holds curriculum_approve — the permission gate would let them
      // through. The refusal must come from the domain, on identity.
      assert.ok(roles.canApproveCurriculum(roles.resolveEffectivePermissions("crm_admin")));
      await assert.rejects(
        lifecycle.approveVersion({
          kind: "content",
          id: version.id,
          expectedRevision: 1,
          actorId: approver.id,
          validationPassed: true,
        }),
        (error: unknown) =>
          error instanceof Error && error.message.includes("may not approve"),
      );
      const row = await prisma.contentVersion.findUniqueOrThrow({ where: { id: version.id } });
      assert.equal(row.editorialState, "submitted_for_review");
      assert.equal(row.approvedById, null);
    });

    await check("11 the LAST AUTHOR is excluded even when someone else submitted", async () => {
      const version = await newContentVersion(5, 1);
      // `approver` writes the text.
      await prisma.$transaction((tx) =>
        lifecycle.bumpAggregate(tx, {
          kind: "content",
          id: version.id,
          expectedRevision: 1,
          actorId: approver.id,
        }),
      );
      // A different editor submits it.
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 2,
        actorId: editor.id,
      });
      await assert.rejects(
        lifecycle.approveVersion({
          kind: "content",
          id: version.id,
          expectedRevision: 2,
          actorId: approver.id,
          validationPassed: true,
        }),
        (error: unknown) => error instanceof Error && error.message.includes("may not approve"),
      );
    });

    await check("12 approval is refused when validation did not pass", async () => {
      const version = await newContentVersion(6, 1);
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: editor.id,
      });
      await assert.rejects(
        lifecycle.approveVersion({
          kind: "content",
          id: version.id,
          expectedRevision: 1,
          actorId: approver.id,
          validationPassed: false,
        }),
        (error: unknown) => error instanceof Error && error.message.includes("validation"),
      );
      const row = await prisma.contentVersion.findUniqueOrThrow({ where: { id: version.id } });
      assert.equal(row.editorialState, "submitted_for_review");
    });

    /* -------------------------------------------------------- concurrency */

    await check("13 CONTENT aggregate: stale write loses, winner survives intact", async () => {
      const version = await newContentVersion(7, 1);
      const localization = await prisma.contentLocalization.create({
        data: {
          contentVersionId: version.id,
          locale: "ru",
          title: "Исходный заголовок",
          body: goodBody("base") as never,
        },
      });

      // Editor A loads revision 1.
      const seenByA = 1;

      // Editor B changes a CHILD and bumps the aggregate: 1 -> 2.
      await prisma.$transaction(async (tx) => {
        await lifecycle.bumpAggregate(tx, {
          kind: "content",
          id: version.id,
          expectedRevision: 1,
          actorId: editorTwo.id,
        });
        await tx.contentLocalization.update({
          where: { id: localization.id },
          data: { title: "Заголовок редактора B" },
        });
      });

      // Editor A now writes with the stale revision. The child write is in the
      // SAME transaction, so it must roll back with the guard.
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await lifecycle.bumpAggregate(tx, {
            kind: "content",
            id: version.id,
            expectedRevision: seenByA,
            actorId: editor.id,
          });
          await tx.contentLocalization.update({
            where: { id: localization.id },
            data: { title: "Заголовок редактора A" },
          });
        }),
        (error: unknown) =>
          error instanceof Error && error.message.includes("moved to revision 2"),
      );

      // B's write survives byte-identically and A's never landed.
      const after = await prisma.contentLocalization.findUniqueOrThrow({
        where: { id: localization.id },
      });
      assert.equal(after.title, "Заголовок редактора B");
      const versionAfter = await prisma.contentVersion.findUniqueOrThrow({
        where: { id: version.id },
      });
      assert.equal(versionAfter.revision, 2);
      assert.equal(versionAfter.lastAuthoredById, editorTwo.id);
    });

    await check("14 ASSESSMENT aggregate: stale write loses, question rollback proven", async () => {
      const assessment = await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: levels.get(8)!,
          curriculumVersionId: curriculum.id,
          versionNumber: 1,
          passPercent: 75,
          createdById: editor.id,
        },
      });
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: assessment.id,
          questionNumber: 1,
          stableKey: "T8.1",
          type: "single_choice",
          options: ["a", "b", "c", "d"] as never,
          correctAnswer: "a" as never,
        },
      });

      await prisma.$transaction(async (tx) => {
        await lifecycle.bumpAggregate(tx, {
          kind: "assessment",
          id: assessment.id,
          expectedRevision: 1,
          actorId: editorTwo.id,
        });
        await tx.questionDefinition.update({
          where: { id: question.id },
          data: { correctAnswer: "b" as never },
        });
      });

      const questionsBefore = await prisma.questionDefinition.count({
        where: { assessmentVersionId: assessment.id },
      });

      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await lifecycle.bumpAggregate(tx, {
            kind: "assessment",
            id: assessment.id,
            expectedRevision: 1,
            actorId: editor.id,
          });
          // A whole new question that must NOT survive the conflict.
          await tx.questionDefinition.create({
            data: {
              assessmentVersionId: assessment.id,
              questionNumber: 2,
              stableKey: "T8.2",
              type: "single_choice",
              options: ["a", "b", "c", "d"] as never,
              correctAnswer: "c" as never,
            },
          });
        }),
        (error: unknown) => error instanceof Error && error.message.includes("moved to revision"),
      );

      const questionsAfter = await prisma.questionDefinition.count({
        where: { assessmentVersionId: assessment.id },
      });
      assert.equal(questionsAfter, questionsBefore, "the losing writer's child row must not persist");
      const winner = await prisma.questionDefinition.findUniqueOrThrow({ where: { id: question.id } });
      assert.equal(winner.correctAnswer, "b");
    });

    /* ------------------------------------------------------- review notes */

    await check("15 review notes append, carry the revision, and resolve", async () => {
      const version = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: levels.get(7)! },
      });
      const note = await notes.addReviewNote({
        target: { kind: "content", contentVersionId: version.id },
        body: "Второй блок нужно сократить.",
        path: "sections[0].blocks[1].text",
        authorId: approver.id,
      });
      assert.equal(note.authorId, approver.id);
      assert.equal(note.targetRevision, version.revision);
      assert.equal(note.resolvedAt, null);

      const open = await notes.countOpenReviewNotes({
        kind: "content",
        contentVersionId: version.id,
      });
      assert.equal(open, 1);

      const resolved = await notes.resolveReviewNote({ noteId: note.id, target: { kind: "content", contentVersionId: version.id }, actorId: editor.id });
      assert.equal(resolved.resolvedById, editor.id);
      assert.ok(resolved.resolvedAt);

      // Resolving twice is an error, never a silent no-op.
      await assert.rejects(
        notes.resolveReviewNote({ noteId: note.id, target: { kind: "content", contentVersionId: version.id }, actorId: editor.id }),
        (error: unknown) => error instanceof Error && error.message.includes("already resolved"),
      );
    });

    await check("16 a review note cannot name zero or two targets", async () => {
      const version = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: levels.get(7)! },
      });
      // The DATABASE enforces it, not just the domain: this raw insert names two.
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "EditorialReviewNote" ("contentVersionId","assessmentVersionId","targetRevision","body","authorId","createdAt")
           VALUES (?, ?, 1, 'two targets', ?, CURRENT_TIMESTAMP)`,
          version.id,
          1,
          approver.id,
        ),
      );
      // And zero.
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "EditorialReviewNote" ("targetRevision","body","authorId","createdAt")
           VALUES (1, 'no target', ?, CURRENT_TIMESTAMP)`,
          approver.id,
        ),
      );
    });

    await check("17 review notes expose no delete in the normal workflow", () => {
      assert.equal(
        Object.keys(notes).some((key) => /delete|destroy|purge/i.test(key)),
        false,
        "the review-note domain must expose no delete operation",
      );
    });

    /* --------------------------------------------------- video production */

    const contractsFile = contract.parseVideoProductionContracts(
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"),
          "utf8",
        ),
      ),
    );
    assert.ok(contractsFile.ok, "the canonical contracts file must parse");
    const file = contractsFile.file;

    await check("18 the bootstrap imports 58 / 232 / 232 / 232 deterministically", async () => {
      const summary = await video.bootstrapVideoProductionVersions({
        file,
        curriculumVersionId: curriculum.id,
        actorId: admin.id,
      });
      assert.equal(summary.levelsConsidered, 58);
      assert.equal(summary.created, 58);
      assert.equal(summary.takes, 232);
      assert.equal(summary.questions, 232);
      assert.equal(summary.takeQuestionMappings, 232);
      assert.equal(summary.sourceBacked, 1);
      assert.equal(summary.proposedCanon, 57);

      const stored = await prisma.videoProductionVersion.count();
      assert.equal(stored, 58);

      // Deterministic: a second run creates nothing and overwrites nothing.
      const again = await video.bootstrapVideoProductionVersions({
        file,
        curriculumVersionId: curriculum.id,
        actorId: admin.id,
      });
      assert.equal(again.created, 0);
      assert.equal(again.skippedExisting, 58);
      assert.equal(await prisma.videoProductionVersion.count(), 58);
    });

    await check("19 THE BOOTSTRAP APPROVES NOTHING", async () => {
      const approved = await prisma.videoProductionVersion.count({
        where: { editorialState: "approved" },
      });
      assert.equal(approved, 0, "no migration or bootstrap may mass-approve the Blueprint");
      const draft = await prisma.videoProductionVersion.count({
        where: { editorialState: "draft" },
      });
      assert.equal(draft, 58);
      const withApprover = await prisma.videoProductionVersion.count({
        where: { NOT: { approvedById: null } },
      });
      assert.equal(withApprover, 0);
    });

    await check("20 L18 keeps SOURCE_BACKED provenance separate from approval", async () => {
      const row = await prisma.videoProductionVersion.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 18 },
      });
      assert.equal(row.sourceProvenance, "SOURCE_BACKED");
      // Provenance is NOT approval. These are two columns for this exact reason.
      assert.equal(row.editorialState, "draft");
      assert.equal(row.approvedById, null);
      // The source's own AWAITING_APPROVAL is preserved inside the payload as
      // provenance, without becoming a platform decision.
      const payload = video.contractFromRow(row);
      assert.equal(payload.approval, "AWAITING_APPROVAL");
      assert.equal(payload.sourceProvenance, "SOURCE_BACKED");
    });

    await check("21 the 57 PROPOSED_CANON banks are still proposals", async () => {
      const proposed = await prisma.videoProductionVersion.count({
        where: { curriculumVersionId: curriculum.id, sourceProvenance: "PROPOSED_CANON" },
      });
      assert.equal(proposed, 57);
      const proposedApproved = await prisma.videoProductionVersion.count({
        where: { sourceProvenance: "PROPOSED_CANON", editorialState: "approved" },
      });
      assert.equal(proposedApproved, 0);
    });

    await check("22 the L2 source conflict survives the migration unresolved", async () => {
      // The conflict lives in the canonical file and the foundation neither
      // resolves it nor drops it.
      const conflicts = file.sourceConflicts.filter((entry) => entry.levelNumber === 2);
      assert.equal(conflicts.length, 7);
      for (const entry of conflicts) {
        assert.ok(entry.blueprintValue.length > 0);
        assert.ok(entry.otherValue.length > 0);
        assert.notEqual(entry.blueprintValue, entry.otherValue);
      }
      // The Blueprint side is what the durable row carries, still as a proposal.
      const row = await prisma.videoProductionVersion.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 2 },
      });
      assert.equal(row.editorialState, "draft");
      const payload = video.contractFromRow(row);
      assert.equal(payload.questions[0].prompt, conflicts.find((c) => c.field === "questions[0].prompt")!.blueprintValue);
    });

    await check("23 fingerprints are SERVER-computed and a caller cannot supply them", async () => {
      const row = await prisma.videoProductionVersion.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 18 },
      });
      const payload = video.contractFromRow(row);
      assert.equal(row.contractFingerprint, contract.calculateContractFingerprint(payload));
      assert.equal(row.assessmentFingerprint, contract.calculateAssessmentFingerprint(payload));

      // A payload carrying a forged fingerprint field is REJECTED outright,
      // because the accepted contract schema is strict.
      assert.throws(() =>
        video.parseContractPayload({ ...payload, contractFingerprint: "0".repeat(64) }),
      );
    });

    await check("24 a SEMANTIC edit makes production evidence stale", async () => {
      const row = await prisma.videoProductionVersion.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 18 },
      });
      const payload = video.contractFromRow(row);

      // Give it evidence reviewed against the CURRENT contract. Not stale yet.
      const reviewed = {
        ...payload,
        production: {
          ...payload.production,
          video: "VIDEO_RECORDED" as const,
          qa: "QA_PASSED" as const,
          reviewedContractVersion: payload.contractVersion,
          reviewedContractFingerprint: contract.calculateContractFingerprint(payload),
        },
      };
      const withEvidence = await video.updateVideoProductionContract({
        id: row.id,
        expectedRevision: row.revision,
        payload: reviewed,
        actorId: editor.id,
      });
      assert.equal(withEvidence.qaState, "QA_PASSED");
      assert.equal(withEvidence.productionEvidenceStale, false);

      // Now change a QUESTION PROMPT — a semantic contract field.
      const semantic = {
        ...reviewed,
        questions: reviewed.questions.map((question, index) =>
          index === 0 ? { ...question, prompt: `${question.prompt} Уточнение по теме.` } : question,
        ),
      };
      const afterSemantic = await video.updateVideoProductionContract({
        id: row.id,
        expectedRevision: withEvidence.revision,
        payload: semantic,
        actorId: editor.id,
      });
      assert.notEqual(afterSemantic.contractFingerprint, withEvidence.contractFingerprint);
      assert.notEqual(afterSemantic.assessmentFingerprint, withEvidence.assessmentFingerprint);
      assert.equal(
        afterSemantic.productionEvidenceStale,
        true,
        "a changed question prompt must invalidate a QA pass",
      );
      // The QA state is NOT silently reset — it is retained AND marked stale, so
      // the UI can say "QA устарело" rather than pretending QA never happened.
      assert.equal(afterSemantic.qaState, "QA_PASSED");
    });

    // Only 58 of the 100 levels are video_test levels, so the levels used below
    // are read from the canonical file rather than guessed.
    const videoLevels = file.contracts.map((entry) => entry.levelNumber).filter((n) => n !== 18);

    await check("25 a NON-SEMANTIC edit follows the accepted fingerprint semantics", async () => {
      const row = await prisma.videoProductionVersion.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: videoLevels[0] },
      });
      const payload = video.contractFromRow(row);
      const reviewed = {
        ...payload,
        production: {
          ...payload.production,
          video: "VIDEO_RECORDED" as const,
          qa: "QA_PASSED" as const,
          reviewedContractVersion: payload.contractVersion,
          reviewedContractFingerprint: contract.calculateContractFingerprint(payload),
        },
      };
      const withEvidence = await video.updateVideoProductionContract({
        id: row.id,
        expectedRevision: row.revision,
        payload: reviewed,
        actorId: editor.id,
      });
      assert.equal(withEvidence.productionEvidenceStale, false);

      // Reword the SHOT LIST. Production direction, excluded from the accepted
      // fingerprint projection, so a recorded video does not become stale.
      const cosmetic = {
        ...reviewed,
        visualBrief: [...reviewed.visualBrief.slice(0, -1), "Обновлённая заметка по кадру."],
      };
      const afterCosmetic = await video.updateVideoProductionContract({
        id: row.id,
        expectedRevision: withEvidence.revision,
        payload: cosmetic,
        actorId: editor.id,
      });
      assert.equal(afterCosmetic.contractFingerprint, withEvidence.contractFingerprint);
      assert.equal(
        afterCosmetic.productionEvidenceStale,
        false,
        "re-wording a shot list must not invalidate 58 recorded videos",
      );
    });

    await check("26 the video aggregate honours the same revision guard", async () => {
      const row = await prisma.videoProductionVersion.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: videoLevels[1] },
      });
      const payload = video.contractFromRow(row);
      await video.updateVideoProductionContract({
        id: row.id,
        expectedRevision: row.revision,
        payload,
        actorId: editorTwo.id,
      });
      await assert.rejects(
        video.updateVideoProductionContract({
          id: row.id,
          expectedRevision: row.revision,
          payload,
          actorId: editor.id,
        }),
        (error: unknown) => error instanceof Error && error.message.includes("moved to revision"),
      );
    });

    /* --------------------------------------------------------- validation */

    await check("27 a good draft passes content validation", () => {
      const result = validation.validateAuthoringContent({
        body: goodBody("ok"),
        title: "Дисциплина и план",
        assets: new Map(),
        requiresTeaching: true,
      });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
    });

    await check("28 the Unicode placeholder matcher is the SHARED one", () => {
      for (const bad of [
        "Материал готовится",
        "Скоро будет доступно",
        "Раздел в разработке",
        "Это черновик урока",
        "Значение уточняется",
        "ЗАГЛУШКА",
        "TODO",
      ]) {
        const body = goodBody("ph");
        body.sections[0].blocks[1] = { type: "rich_text", text: bad } as never;
        const result = validation.validateAuthoringContent({
          body,
          title: "Заголовок",
          assets: new Map(),
          requiresTeaching: false,
        });
        assert.ok(
          result.issues.some((issue) => issue.code === "CONTENT_PLACEHOLDER"),
          `"${bad}" must be refused`,
        );
      }
      // And the legitimate prose the regression suites established stays legal.
      for (const good of ["Ученик ведёт черновик сделки", "Рынок скоро вернётся к среднему"]) {
        const body = goodBody("ok2");
        body.sections[0].blocks.push({ type: "rich_text", text: good } as never);
        const result = validation.validateAuthoringContent({
          body,
          title: "Заголовок",
          assets: new Map(),
          requiresTeaching: false,
        });
        assert.ok(
          !result.issues.some((issue) => issue.code === "CONTENT_PLACEHOLDER"),
          `"${good}" must remain legal`,
        );
      }
    });

    // Each defect is validated in ISOLATION. Bundling them hid a real result
    // earlier: an `open_tool` CTA without a toolCode is refused by the block
    // SCHEMA, so the body never parsed and the asset and tool checks downstream
    // never ran — the suite would have passed a validator that only reported the
    // first problem it met.
    await check("29a a missing asset reference is named", () => {
      const body = goodBody("asset");
      body.sections[0].blocks.push(
        { type: "image", assetCode: "missing-asset", alt: "Схема", caption: "" } as never,
      );
      const result = validation.validateAuthoringContent({
        body,
        title: "Заголовок",
        assets: new Map([["other-asset", "image"]]),
        requiresTeaching: false,
      });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((issue) => issue.code === "CONTENT_ASSET_MISSING"));
    });

    await check("29b an unknown tool code is named", () => {
      const body = goodBody("tool");
      body.sections[0].blocks.push(
        { type: "tool_link", toolCode: "tool.not_a_real_tool", label: "Инструмент", context: "" } as never,
      );
      const result = validation.validateAuthoringContent({
        body,
        title: "Заголовок",
        assets: new Map(),
        requiresTeaching: false,
      });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((issue) => issue.code === "CONTENT_TOOL_CODE_UNKNOWN"));
      // A canonical tool code is accepted, so the check is the vocabulary and
      // not the block type.
      const good = goodBody("tool2");
      good.sections[0].blocks.push(
        { type: "tool_link", toolCode: "tool.trading_journal", label: "Журнал", context: "" } as never,
      );
      assert.equal(
        validation.validateAuthoringContent({
          body: good,
          title: "Заголовок",
          assets: new Map(),
          requiresTeaching: false,
        }).ok,
        true,
      );
    });

    await check("29c a CTA that smuggles a destination is refused", () => {
      // `open_tool` without a target, and a non-tool action WITH one. Both are
      // refused — by the schema, the validator, or both — and either way the
      // result is not ok and the caller is told where.
      for (const bad of [
        { type: "cta", action: "open_tool", label: "Открыть", body: "", toolCode: null },
        { type: "cta", action: "next_level", label: "Дальше", body: "", toolCode: "tool.watchlist" },
      ]) {
        const body = goodBody("cta");
        body.sections[0].blocks.push(bad as never);
        const result = validation.validateAuthoringContent({
          body,
          title: "Заголовок",
          assets: new Map(),
          requiresTeaching: false,
        });
        assert.equal(result.ok, false, JSON.stringify(bad));
        assert.ok(
          result.issues.some((issue) => issue.path.length > 0),
          "the refusal must point at a path the editor can act on",
        );
      }
    });

    await check("30 an asset of the WRONG KIND is refused", () => {
      const body = goodBody("kind");
      body.sections[0].blocks.push(
        { type: "image", assetCode: "the-video", alt: "Схема", caption: "" } as never,
      );
      const result = validation.validateAuthoringContent({
        body,
        title: "Заголовок",
        assets: new Map([["the-video", "video"]]),
        requiresTeaching: false,
      });
      assert.ok(result.issues.some((issue) => issue.code === "CONTENT_ASSET_KIND_MISMATCH"));
    });

    await check("31 internal production data may not appear in the learner body", () => {
      const body = goodBody("leak");
      body.sections[0].blocks.push(
        { type: "rich_text", text: "Смотри дубль T18.3 в сценарии." } as never,
      );
      const result = validation.validateAuthoringContent({
        body,
        title: "Заголовок",
        assets: new Map(),
        requiresTeaching: false,
      });
      assert.ok(result.issues.some((issue) => issue.code === "CONTENT_PRODUCTION_LEAK"));
    });

    await check("32 a correct answer leaked into the lesson body is detected", () => {
      const answer = "Платформа последовательно открывает следующий шаг после выполнения условия.";
      const body = goodBody("answer");
      body.sections[0].blocks.push({ type: "rich_text", text: `Запомните: ${answer}` } as never);
      const leaks = validation.detectAnswerLeakage({ body, correctAnswerTexts: [answer] });
      assert.equal(leaks.length, 1);
      assert.equal(leaks[0].code, "CONTENT_ANSWER_LEAK");

      // A short shared word must NOT trigger it.
      const clean = validation.detectAnswerLeakage({
        body: goodBody("clean"),
        correctAnswerTexts: ["план"],
      });
      assert.equal(clean.length, 0);
    });

    await check("33 the 4x4 take mapping is enforced for ATA video levels", () => {
      const ok = validation.validateAuthoringAssessment({
        ataVideoLevelNumber: 18,
        questions: [1, 2, 3, 4].map((n) => ({
          questionNumber: n,
          stableKey: `T18.${n}`,
          prompt: `Вопрос ${n}`,
          optionLabels: ["а", "б", "в", "г"],
          correctAnswer: "а",
          explanation: null,
        })),
      });
      assert.equal(ok.ok, true, JSON.stringify(ok.issues));

      // Wrong cardinality.
      const three = validation.validateAuthoringAssessment({
        ataVideoLevelNumber: 18,
        questions: [1, 2, 3].map((n) => ({
          questionNumber: n,
          stableKey: `T18.${n}`,
          prompt: `Вопрос ${n}`,
          optionLabels: ["а", "б", "в", "г"],
          correctAnswer: "а",
          explanation: null,
        })),
      });
      assert.ok(three.issues.some((issue) => issue.code === "ASSESSMENT_CARDINALITY"));
      assert.ok(three.issues.some((issue) => issue.code === "ASSESSMENT_TAKE_UNMAPPED"));

      // Duplicate take, and a take from another level.
      const wrong = validation.validateAuthoringAssessment({
        ataVideoLevelNumber: 18,
        questions: [
          { questionNumber: 1, stableKey: "T18.1", prompt: "a", optionLabels: ["а", "б", "в", "г"], correctAnswer: "а", explanation: null },
          { questionNumber: 2, stableKey: "T18.1", prompt: "b", optionLabels: ["а", "б", "в", "г"], correctAnswer: "а", explanation: null },
          { questionNumber: 3, stableKey: "T19.3", prompt: "c", optionLabels: ["а", "б", "в", "г"], correctAnswer: "а", explanation: null },
          { questionNumber: 4, stableKey: "нет", prompt: "d", optionLabels: ["а", "б"], correctAnswer: null, explanation: null },
        ],
      });
      const codes = new Set(wrong.issues.map((issue) => issue.code));
      assert.ok(codes.has("ASSESSMENT_TAKE_DUPLICATE"));
      assert.ok(codes.has("ASSESSMENT_TAKE_LEVEL_MISMATCH"));
      assert.ok(codes.has("ASSESSMENT_TAKE_MAPPING_INVALID"));
      assert.ok(codes.has("ASSESSMENT_OPTION_CARDINALITY"));
      assert.ok(codes.has("ASSESSMENT_ANSWER_MISSING"));
    });

    await check("34 a learner-empty body is refused for a level that must teach", () => {
      const thin = {
        format: "ata.lesson.blocks",
        version: 2,
        sections: [
          {
            code: "thin",
            title: "Тонко",
            blocks: [
              { type: "heading", level: 3, text: "Заголовок" },
              { type: "divider" },
              { type: "cta", action: "next_level", label: "Дальше", body: "", toolCode: null },
            ],
          },
        ],
      };
      const result = validation.validateAuthoringContent({
        body: thin,
        title: "Тонко",
        assets: new Map(),
        requiresTeaching: true,
      });
      assert.ok(result.issues.some((issue) => issue.code === "CONTENT_LEARNER_EMPTY"));
    });

    /* -------------------------------------------------------------- audit */

    await check("35 every lifecycle mutation left audit evidence", async () => {
      for (const action of [
        constants.CURRICULUM_AUDIT_ACTIONS.authoringSubmittedForReview,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringChangesRequested,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringApproved,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringReviewNoteAdded,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringReviewNoteResolved,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringVideoProductionCreated,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringVideoProductionUpdated,
        constants.CURRICULUM_AUDIT_ACTIONS.authoringVideoProductionBootstrapped,
      ]) {
        const rows = await prisma.auditLog.findMany({ where: { action } });
        assert.ok(rows.length > 0, `no audit row for ${action}`);
        for (const row of rows) {
          assert.ok(row.userId !== null, `${action} has no actor`);
          assert.ok(row.entityType !== null, `${action} has no target type`);
          assert.ok(row.entityId !== null, `${action} has no target id`);
          assert.ok(row.createdAt instanceof Date, `${action} has no timestamp`);
        }
      }

      // The approval row proves the two humans were different.
      const approvals = await prisma.auditLog.findMany({
        where: { action: constants.CURRICULUM_AUDIT_ACTIONS.authoringApproved },
      });
      for (const row of approvals) {
        const meta = row.metadata as Record<string, unknown>;
        assert.notEqual(meta.authoredBy, row.userId);
        assert.notEqual(meta.submittedBy, row.userId);
      }
    });

    await check("36 no authoring action ever wrote learner progress or XP", async () => {
      assert.equal(await prisma.xPTransaction.count(), 0);
      assert.equal(await prisma.userLevelProgress.count(), 0);
      assert.equal(await prisma.userLessonProgress.count(), 0);
      assert.equal(await prisma.assessmentAttempt.count(), 0);
      assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
      // And no content was published as a side effect of any of it.
      assert.equal(
        await prisma.contentVersion.count({ where: { status: "published", versionNumber: { not: 99 } } }),
        0,
      );
    });

    await check("37 the preview snapshot table can hold an immutable frozen render", async () => {
      const version = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: levels.get(7)! },
      });
      const snapshot = await prisma.authoringPreviewSnapshot.create({
        data: {
          snapshotCode: "prev_0123456789abcdef",
          levelDefinitionId: levels.get(7)!,
          curriculumVersionId: curriculum.id,
          contentVersionId: version.id,
          contentRevision: version.revision,
          payload: { body: goodBody("snap"), assets: {} } as never,
          createdById: approver.id,
        },
      });
      assert.equal(snapshot.contentRevision, version.revision);

      // A version without its revision cannot prove what was rendered.
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "AuthoringPreviewSnapshot" ("snapshotCode","levelDefinitionId","curriculumVersionId","contentVersionId","payload","createdById","createdAt")
           VALUES ('prev_bad_pair_00000000', ?, ?, ?, '{}', ?, CURRENT_TIMESTAMP)`,
          levels.get(7)!,
          curriculum.id,
          version.id,
          approver.id,
        ),
      );
      // A snapshot of nothing is not a preview.
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `INSERT INTO "AuthoringPreviewSnapshot" ("snapshotCode","levelDefinitionId","curriculumVersionId","payload","createdById","createdAt")
           VALUES ('prev_no_target_0000000', ?, ?, '{}', ?, CURRENT_TIMESTAMP)`,
          levels.get(7)!,
          curriculum.id,
          approver.id,
        ),
      );
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  if (OUT) {
    fs.writeFileSync(
      OUT,
      JSON.stringify({ suite: "g0-authoring-foundation", passed, failed, results }, null, 2),
    );
  }

  console.log(`\nPHASE-G0 authoring foundation: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
