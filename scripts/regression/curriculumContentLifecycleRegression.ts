import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { isContentDomainError } from "../../src/lib/curriculum/content-errors";
import type { ContentDomainErrorCode } from "../../src/lib/curriculum/content-errors";

const dbPath = path.join(os.tmpdir(), `ata-content-lifecycle-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

async function expectError(fn: () => Promise<unknown>, code: ContentDomainErrorCode) {
  try {
    await fn();
  } catch (error) {
    if (isContentDomainError(error, code)) return error;
    throw new Error(`expected ${code}, got ${String(error)}`);
  }
  throw new Error(`expected ${code}, operation succeeded`);
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function body(marker = "base") {
  return {
    sections: [{ code: `intro-${marker}`, title: `Title ${marker}`, body: `Body ${marker}` }],
    examples: [{ title: `Example ${marker}`, body: `Example body ${marker}` }],
    commonMistakes: [{ mistake: `Mistake ${marker}`, correction: `Correction ${marker}` }],
    glossary: [{ term: `Term ${marker}`, definition: `Definition ${marker}` }],
    nextAction: { label: `Action ${marker}`, body: `Action body ${marker}` },
    riskDisclaimer: `Risk ${marker}`,
  };
}

async function main() {
  cleanupDb();
  const runner = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  delete process.env.CURRICULUM_V2_CONTENT_ENABLED;
  const { prisma } = await import("../../src/lib/prisma");
  const content = await import("../../src/lib/curriculum/content");

  const admin = await prisma.user.create({
    data: { email: "content-admin@example.com", name: "Content Admin", role: "admin" },
  });
  const regular = await prisma.user.create({
    data: { email: "content-user@example.com", name: "Content User" },
  });
  const blocked = await prisma.user.create({
    data: { email: "content-blocked@example.com", name: "Blocked", role: "admin", status: "blocked" },
  });
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "content-life", name: "Content Life", versionNumber: 1 },
  });
  const curriculumModule = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleNumber: 1,
      code: "content-module",
      title: "Content",
      firstLevel: 1,
      lastLevel: 4,
    },
  });
  const levels = await Promise.all(
    [1, 2, 3, 4].map((number) =>
      prisma.levelDefinition.create({
        data: {
          curriculumVersionId: curriculum.id,
          moduleId: curriculumModule.id,
          levelNumber: number,
          stableCode: `v2.l${String(number).padStart(3, "0")}.content-${number}`,
          type: "lesson",
          title: `Level ${number}`,
          completionMethod: "manual",
        },
      }),
    ),
  );
  const foreignCurriculum = await prisma.curriculumVersion.create({
    data: { code: "content-foreign", name: "Foreign", versionNumber: 1 },
  });
  const foreignModule = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: foreignCurriculum.id,
      moduleNumber: 1,
      code: "foreign-module",
      title: "Foreign",
      firstLevel: 1,
      lastLevel: 1,
    },
  });
  const foreignLevel = await prisma.levelDefinition.create({
    data: {
      curriculumVersionId: foreignCurriculum.id,
      moduleId: foreignModule.id,
      levelNumber: 1,
      stableCode: "v2.l001.foreign",
      type: "lesson",
      title: "Foreign",
      completionMethod: "manual",
    },
  });

  const baseline = {
    assessmentAttempts: await prisma.assessmentAttempt.count(),
    lessonProgress: await prisma.userLessonProgress.count(),
    xp: await prisma.xPTransaction.count(),
    v1Tasks: await prisma.task.count(),
    v1Progress: await prisma.userTaskProgress.count(),
  };

  try {
    await check("1. flag defaults off and performs no write", async () => {
      const before = await prisma.contentVersion.count();
      await expectError(
        () => content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[0].id }),
        "CONTENT_DISABLED",
      );
      assert.equal(await prisma.contentVersion.count(), before);
    });

    await check("2. unrelated curriculum flags do not enable content", async () => {
      process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
      process.env.CURRICULUM_V2_READ_ENABLED = "true";
      process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
      process.env.CURRICULUM_V2_XP_ENABLED = "true";
      await expectError(
        () => content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[0].id }),
        "CONTENT_DISABLED",
      );
    });

    process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
    await check("3. content flag is read dynamically", async () => {
      const created = await content.createContentVersion({
        actorId: admin.id,
        levelDefinitionId: levels[0].id,
        changeNotes: "first draft",
      });
      assert.equal(created.versionNumber, 1);
      assert.equal(created.status, "draft");
      await content.deleteContentVersion({ actorId: admin.id, contentVersionId: created.id });
    });

    await check("4. missing actor is rejected", () =>
      expectError(
        () => content.createContentVersion({ actorId: 2_000_000_000, levelDefinitionId: levels[0].id }),
        "CONTENT_ACTOR_FORBIDDEN",
      ).then(() => undefined),
    );
    await check("5. non-admin actor is rejected", () =>
      expectError(
        () => content.createContentVersion({ actorId: regular.id, levelDefinitionId: levels[0].id }),
        "CONTENT_ACTOR_FORBIDDEN",
      ).then(() => undefined),
    );
    await check("6. blocked admin actor is rejected", () =>
      expectError(
        () => content.createContentVersion({ actorId: blocked.id, levelDefinitionId: levels[0].id }),
        "CONTENT_ACTOR_FORBIDDEN",
      ).then(() => undefined),
    );

    await check("7. lifecycle and identity fields are strict-forbidden", async () => {
      await expectError(
        () => content.createContentVersion({
          actorId: admin.id,
          levelDefinitionId: levels[0].id,
          versionNumber: 77,
          status: "published",
          publishedAt: new Date(),
          createdById: regular.id,
        }),
        "CONTENT_INPUT_INVALID",
      );
    });

    const first = await content.createContentVersion({
      actorId: admin.id,
      levelDefinitionId: levels[0].id,
      videoDurationSeconds: null,
    });
    const secondDraft = await content.createContentVersion({
      actorId: admin.id,
      levelDefinitionId: levels[0].id,
    });
    await check("8. version number is allocated monotonically in the transaction", () => {
      assert.equal(first.versionNumber, 1);
      assert.equal(secondDraft.versionNumber, 2);
      assert.equal(first.createdById, admin.id);
    });

    await check("9. draft ContentVersion metadata updates", async () => {
      const updated = await content.updateContentVersion({
        actorId: admin.id,
        contentVersionId: first.id,
        patch: { changeNotes: "ready" },
      });
      assert.equal(updated.changeNotes, "ready");
    });
    await check("10. no-change update has no audit", async () => {
      const before = await prisma.auditLog.count();
      await expectError(
        () => content.updateContentVersion({
          actorId: admin.id,
          contentVersionId: first.id,
          patch: { changeNotes: "ready" },
        }),
        "CONTENT_NO_CHANGES",
      );
      assert.equal(await prisma.auditLog.count(), before);
    });

    await check("11. invalid locale and unsafe body are rejected before writes", async () => {
      const before = await prisma.contentLocalization.count();
      await expectError(
        () => content.createContentLocalization({
          actorId: admin.id,
          contentVersionId: first.id,
          locale: "RU_bad",
          title: "Unsafe",
          subtitle: "",
          learningObjectiveExtension: "",
          summary: "",
          transcript: null,
          body: { ...body("bad"), riskDisclaimer: "<script>alert(1)</script>" },
        }),
        "CONTENT_INPUT_INVALID",
      );
      assert.equal(await prisma.contentLocalization.count(), before);
    });

    const localization = await content.createContentLocalization({
      actorId: admin.id,
      contentVersionId: first.id,
      locale: "EN-us",
      title: "Lifecycle lesson",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "Summary",
      transcript: null,
      body: body("one"),
    });
    await check("12. explicit locale is normalized and content body is stored", () => {
      assert.equal(localization.locale, "en-us");
      assert.deepEqual(localization.body, body("one"));
    });
    await check("13. duplicate normalized locale is a typed conflict", () =>
      expectError(
        () => content.createContentLocalization({
          actorId: admin.id,
          contentVersionId: first.id,
          locale: "en-US",
          title: "Duplicate",
          subtitle: "",
          learningObjectiveExtension: "",
          summary: "",
          transcript: null,
          body: body("duplicate"),
        }),
        "CONTENT_LOCALIZATION_CONFLICT",
      ).then(() => undefined),
    );
    await check("14. answer authority cannot be smuggled into body", () =>
      expectError(
        () => content.updateContentLocalization({
          actorId: admin.id,
          contentLocalizationId: localization.id,
          patch: { body: { ...body("answer"), correctAnswer: "secret" } },
        }),
        "CONTENT_INPUT_INVALID",
      ).then(() => undefined),
    );
    await check("15. localization update is draft-only and audited", async () => {
      const updated = await content.updateContentLocalization({
        actorId: admin.id,
        contentLocalizationId: localization.id,
        patch: { summary: "Updated summary" },
      });
      assert.equal(updated.summary, "Updated summary");
      assert.equal(await prisma.auditLog.count({ where: { action: "CONTENT_LOCALIZATION_UPDATED" } }), 1);
    });

    await check("16. invalid asset URL is rejected", () =>
      expectError(
        () => content.createContentAsset({
          actorId: admin.id,
          contentVersionId: first.id,
          kind: "image",
          assetCode: "hero-image",
          locale: null,
          url: "http://user@example.com/unsafe.png",
          mimeType: "image/png",
          sizeBytes: 10,
          durationSeconds: null,
          checksum: null,
          sortOrder: 0,
        }),
        "CONTENT_INPUT_INVALID",
      ).then(() => undefined),
    );
    const asset = await content.createContentAsset({
      actorId: admin.id,
      contentVersionId: first.id,
      kind: "image",
      assetCode: "hero-image",
      locale: null,
      url: "https://cdn.example.com/hero.png",
      mimeType: "image/png",
      sizeBytes: 10,
      durationSeconds: null,
      checksum: null,
      sortOrder: 0,
    });
    await check("17. metadata-only HTTPS asset is created", () => {
      assert.equal(asset.url, "https://cdn.example.com/hero.png");
      assert.equal(asset.assetCode, "hero-image");
    });
    await check("18. duplicate asset code/order is typed conflict", () =>
      expectError(
        () => content.createContentAsset({
          actorId: admin.id,
          contentVersionId: first.id,
          kind: "chart",
          assetCode: "hero-image",
          locale: null,
          url: "https://cdn.example.com/chart.png",
          mimeType: "image/png",
          sizeBytes: null,
          durationSeconds: null,
          checksum: null,
          sortOrder: 1,
        }),
        "CONTENT_ASSET_CONFLICT",
      ).then(() => undefined),
    );
    await check("19. asset update is audited without URL payload", async () => {
      const updated = await content.updateContentAsset({
        actorId: admin.id,
        contentAssetId: asset.id,
        patch: { sortOrder: 2 },
      });
      assert.equal(updated.sortOrder, 2);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "CONTENT_ASSET_UPDATED" } });
      assert.doesNotMatch(JSON.stringify(audit.metadata), /cdn\.example|hero\.png/);
    });

    const noLocalization = await content.createContentVersion({
      actorId: admin.id,
      levelDefinitionId: levels[1].id,
    });
    await check("20. publication without localization is rejected and audited", async () => {
      await expectError(
        () => content.publishContentVersion({ actorId: admin.id, contentVersionId: noLocalization.id }),
        "CONTENT_PUBLICATION_INVALID",
      );
      assert.equal(await prisma.auditLog.count({ where: { action: "CONTENT_PUBLICATION_REJECTED" } }), 1);
      assert.equal((await prisma.contentVersion.findUniqueOrThrow({ where: { id: noLocalization.id } })).status, "draft");
    });

    await check("21. valid first publication is atomic", async () => {
      const result = await content.publishContentVersion({ actorId: admin.id, contentVersionId: first.id });
      assert.equal(result.published.status, "published");
      assert.equal(result.replaced, null);
      assert.equal(result.bindingMoved, false);
      assert.notEqual(result.published.publishedAt, null);
    });
    await check("22. published content/localization/asset are immutable", async () => {
      await expectError(
        () => content.updateContentVersion({ actorId: admin.id, contentVersionId: first.id, patch: { changeNotes: "x" } }),
        "CONTENT_PUBLISHED_IMMUTABLE",
      );
      await expectError(
        () => content.deleteContentLocalization({ actorId: admin.id, contentLocalizationId: localization.id }),
        "CONTENT_PUBLISHED_IMMUTABLE",
      );
      await expectError(
        () => content.updateContentAsset({ actorId: admin.id, contentAssetId: asset.id, patch: { sortOrder: 3 } }),
        "CONTENT_PUBLISHED_IMMUTABLE",
      );
    });

    const assessment = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: levels[0].id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "published",
        passPercent: 80,
        publishedAt: new Date(),
        createdById: admin.id,
      },
    });
    const assessmentOnly = await prisma.levelResourceBinding.create({
      data: {
        levelDefinitionId: levels[0].id,
        curriculumVersionId: curriculum.id,
        assessmentVersionId: assessment.id,
        createdById: admin.id,
      },
    });
    await check("23. exact content binding preserves assessment pin", async () => {
      const binding = await content.setLevelContentBinding({
        actorId: admin.id,
        levelDefinitionId: levels[0].id,
        contentVersionId: first.id,
      });
      assert.equal(binding.id, assessmentOnly.id);
      assert.equal(binding.assessmentVersionId, assessment.id);
      assert.equal(binding.contentVersionId, first.id);
    });
    await check("24. repeated exact bind is no-change without audit", async () => {
      const before = await prisma.auditLog.count();
      await expectError(
        () => content.setLevelContentBinding({
          actorId: admin.id,
          levelDefinitionId: levels[0].id,
          contentVersionId: first.id,
        }),
        "CONTENT_NO_CHANGES",
      );
      assert.equal(await prisma.auditLog.count(), before);
    });
    await check("25. direct archive rejects a bound published version", () =>
      expectError(
        () => content.archiveContentVersion({ actorId: admin.id, contentVersionId: first.id }),
        "CONTENT_BINDING_CONFLICT",
      ).then(() => undefined),
    );
    await check("26. cross-level content binding is rejected", () =>
      expectError(
        () => content.setLevelContentBinding({
          actorId: admin.id,
          levelDefinitionId: foreignLevel.id,
          contentVersionId: first.id,
        }),
        "CONTENT_VERSION_MISMATCH",
      ).then(() => undefined),
    );

    await content.createContentLocalization({
      actorId: admin.id,
      contentVersionId: secondDraft.id,
      locale: "en",
      title: "Replacement",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "",
      transcript: null,
      body: body("replacement"),
    });
    await check("27. replacement requires explicit current published ID", () =>
      expectError(
        () => content.publishContentVersion({ actorId: admin.id, contentVersionId: secondDraft.id }),
        "CONTENT_REPLACEMENT_REQUIRED",
      ).then(() => undefined),
    );
    await check("28. stale expected replacement ID is rejected", () =>
      expectError(
        () => content.publishContentVersion({
          actorId: admin.id,
          contentVersionId: secondDraft.id,
          expectedPublishedContentVersionId: 2_000_000_000,
        }),
        "CONTENT_REPLACEMENT_MISMATCH",
      ).then(() => undefined),
    );
    await check("29. replacement archives old, publishes new, and moves binding atomically", async () => {
      const result = await content.publishContentVersion({
        actorId: admin.id,
        contentVersionId: secondDraft.id,
        expectedPublishedContentVersionId: first.id,
      });
      assert.equal(result.replaced?.status, "archived");
      assert.notEqual(result.replaced?.archivedAt, null);
      assert.equal(result.published.status, "published");
      assert.equal(result.bindingMoved, true);
      const binding = await prisma.levelResourceBinding.findUniqueOrThrow({
        where: { levelDefinitionId: levels[0].id },
      });
      assert.equal(binding.contentVersionId, secondDraft.id);
      assert.equal(binding.assessmentVersionId, assessment.id);
    });

    await check("30. clearing content preserves assessment binding", async () => {
      const result = await content.clearLevelContentBinding({
        actorId: admin.id,
        levelDefinitionId: levels[0].id,
      });
      assert.equal(result.deleted, false);
      assert.equal(result.binding?.contentVersionId, null);
      assert.equal(result.binding?.assessmentVersionId, assessment.id);
    });
    await check("31. clear without content binding is typed not-found", () =>
      expectError(
        () => content.clearLevelContentBinding({ actorId: admin.id, levelDefinitionId: levels[0].id }),
        "CONTENT_BINDING_NOT_FOUND",
      ).then(() => undefined),
    );
    await check("32. unbound published content archives once", async () => {
      const archived = await content.archiveContentVersion({
        actorId: admin.id,
        contentVersionId: secondDraft.id,
      });
      assert.equal(archived.status, "archived");
      await expectError(
        () => content.archiveContentVersion({ actorId: admin.id, contentVersionId: secondDraft.id }),
        "CONTENT_ARCHIVED_IMMUTABLE",
      );
    });

    const third = await content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[2].id });
    await content.createContentLocalization({
      actorId: admin.id,
      contentVersionId: third.id,
      locale: "pl",
      title: "Third",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "",
      transcript: null,
      body: body("third"),
    });
    await content.publishContentVersion({ actorId: admin.id, contentVersionId: third.id });
    await content.setLevelContentBinding({
      actorId: admin.id,
      levelDefinitionId: levels[2].id,
      contentVersionId: third.id,
    });
    await check("33. clearing a content-only binding deletes the empty row", async () => {
      const result = await content.clearLevelContentBinding({
        actorId: admin.id,
        levelDefinitionId: levels[2].id,
      });
      assert.equal(result.deleted, true);
      assert.equal(await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: levels[2].id } }), null);
    });

    const nonEmpty = await content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[3].id });
    const disposableLocalization = await content.createContentLocalization({
      actorId: admin.id,
      contentVersionId: nonEmpty.id,
      locale: "de",
      title: "Disposable",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "",
      transcript: null,
      body: body("disposable"),
    });
    await check("34. non-empty draft cannot be deleted", () =>
      expectError(
        () => content.deleteContentVersion({ actorId: admin.id, contentVersionId: nonEmpty.id }),
        "CONTENT_NOT_EMPTY",
      ).then(() => undefined),
    );
    await check("35. localization delete then empty draft delete succeeds", async () => {
      await content.deleteContentLocalization({
        actorId: admin.id,
        contentLocalizationId: disposableLocalization.id,
      });
      await content.deleteContentVersion({ actorId: admin.id, contentVersionId: nonEmpty.id });
      assert.equal(await prisma.contentVersion.findUnique({ where: { id: nonEmpty.id } }), null);
    });

    const publishedCurriculum = await prisma.curriculumVersion.create({
      data: { code: "parent-published", name: "Published", versionNumber: 1, status: "published", publishedAt: new Date() },
    });
    const publishedModule = await prisma.moduleDefinition.create({
      data: { curriculumVersionId: publishedCurriculum.id, moduleNumber: 1, code: "p", title: "P", firstLevel: 1, lastLevel: 1 },
    });
    const publishedLevel = await prisma.levelDefinition.create({
      data: { curriculumVersionId: publishedCurriculum.id, moduleId: publishedModule.id, levelNumber: 1, stableCode: "v2.l001.parent", type: "lesson", title: "P", completionMethod: "manual" },
    });
    await check("36. published parent curriculum blocks content authoring", () =>
      expectError(
        () => content.createContentVersion({ actorId: admin.id, levelDefinitionId: publishedLevel.id }),
        "CONTENT_PUBLISHED_IMMUTABLE",
      ).then(() => undefined),
    );

    const rollbackCreateBefore = await prisma.contentVersion.count();
    await check("37. audit failure rolls back create and is sanitized", async () => {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER fail_content_create_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CONTENT_VERSION_CREATED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await expectError(
          () => content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[3].id }),
          "CONTENT_INTERNAL_ERROR",
        );
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_content_create_audit");
      }
      assert.equal(await prisma.contentVersion.count(), rollbackCreateBefore);
    });

    const rollbackUpdate = await content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[3].id });
    await check("38. audit failure rolls back update", async () => {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER fail_content_update_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CONTENT_VERSION_UPDATED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await expectError(
          () => content.updateContentVersion({ actorId: admin.id, contentVersionId: rollbackUpdate.id, patch: { changeNotes: "must rollback" } }),
          "CONTENT_INTERNAL_ERROR",
        );
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_content_update_audit");
      }
      assert.equal((await prisma.contentVersion.findUniqueOrThrow({ where: { id: rollbackUpdate.id } })).changeNotes, null);
    });

    await content.createContentLocalization({
      actorId: admin.id,
      contentVersionId: rollbackUpdate.id,
      locale: "es",
      title: "Rollback publish",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "",
      transcript: null,
      body: body("rollback-publish"),
    });
    await check("39. audit failure rolls back publication", async () => {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER fail_content_publish_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CONTENT_VERSION_PUBLISHED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await expectError(
          () => content.publishContentVersion({ actorId: admin.id, contentVersionId: rollbackUpdate.id }),
          "CONTENT_INTERNAL_ERROR",
        );
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_content_publish_audit");
      }
      assert.equal((await prisma.contentVersion.findUniqueOrThrow({ where: { id: rollbackUpdate.id } })).status, "draft");
    });

    await content.publishContentVersion({ actorId: admin.id, contentVersionId: rollbackUpdate.id });
    await check("40. audit failure rolls back binding", async () => {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER fail_content_bind_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CONTENT_BOUND' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await expectError(
          () => content.setLevelContentBinding({ actorId: admin.id, levelDefinitionId: levels[3].id, contentVersionId: rollbackUpdate.id }),
          "CONTENT_INTERNAL_ERROR",
        );
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_content_bind_audit");
      }
      assert.equal(await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: levels[3].id } }), null);
    });

    const rollbackDelete = await content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[1].id });
    await check("41. audit failure rolls back delete", async () => {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER fail_content_delete_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CONTENT_VERSION_DELETED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await expectError(
          () => content.deleteContentVersion({ actorId: admin.id, contentVersionId: rollbackDelete.id }),
          "CONTENT_INTERNAL_ERROR",
        );
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_content_delete_audit");
      }
      assert.notEqual(await prisma.contentVersion.findUnique({ where: { id: rollbackDelete.id } }), null);
    });

    const raceDraft = await content.createContentVersion({ actorId: admin.id, levelDefinitionId: foreignLevel.id });
    await content.createContentLocalization({
      actorId: admin.id,
      contentVersionId: raceDraft.id,
      locale: "fr",
      title: "Race",
      subtitle: "",
      learningObjectiveExtension: "",
      summary: "",
      transcript: null,
      body: body("race"),
    });
    const originalTransaction = prisma.$transaction.bind(prisma);
    const p2002 = () => new Prisma.PrismaClientKnownRequestError("forced P2002", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
      meta: { target: "ContentVersion_levelDefinitionId_published" },
    });
    await check("42. P2002 recovery returns only durably verified publication", async () => {
      Object.defineProperty(prisma, "$transaction", {
        configurable: true,
        value: async (...args: Parameters<typeof prisma.$transaction>) => {
          await (originalTransaction as (...items: Parameters<typeof prisma.$transaction>) => Promise<unknown>)(...args);
          throw p2002();
        },
      });
      try {
        const result = await content.publishContentVersion({ actorId: admin.id, contentVersionId: raceDraft.id });
        assert.equal(result.recovered, true);
        assert.equal(result.published.id, raceDraft.id);
      } finally {
        Object.defineProperty(prisma, "$transaction", { configurable: true, value: originalTransaction });
      }
      assert.equal(await prisma.auditLog.count({ where: { action: "CONTENT_VERSION_PUBLISHED", entityId: String(raceDraft.id) } }), 1);
    });

    const raceLoser = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: foreignLevel.id,
        curriculumVersionId: foreignCurriculum.id,
        versionNumber: 2,
        createdById: admin.id,
      },
    });
    await check("43. unverified P2002 is mapped to replacement-required, never success", async () => {
      Object.defineProperty(prisma, "$transaction", {
        configurable: true,
        value: async () => { throw p2002(); },
      });
      try {
        await expectError(
          () => content.publishContentVersion({ actorId: admin.id, contentVersionId: raceLoser.id }),
          "CONTENT_REPLACEMENT_REQUIRED",
        );
      } finally {
        Object.defineProperty(prisma, "$transaction", { configurable: true, value: originalTransaction });
      }
      assert.equal((await prisma.contentVersion.findUniqueOrThrow({ where: { id: raceLoser.id } })).status, "draft");
    });

    await check("44. unknown database failures are internal, not false conflicts", async () => {
      Object.defineProperty(prisma, "$transaction", {
        configurable: true,
        value: async () => { throw new Error("unknown-db-failure"); },
      });
      try {
        await expectError(
          () => content.createContentVersion({ actorId: admin.id, levelDefinitionId: levels[1].id }),
          "CONTENT_INTERNAL_ERROR",
        );
      } finally {
        Object.defineProperty(prisma, "$transaction", { configurable: true, value: originalTransaction });
      }
    });

    await check("45. audit metadata excludes content bodies, transcript, and asset URLs", async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "CONTENT_" } } });
      const serialized = JSON.stringify(rows.map((row) => row.metadata));
      assert.doesNotMatch(serialized, /Body one|Updated summary|cdn\.example|Rollback publish/);
    });

    await check("46. assessment runtime, lesson progress, XP, and V1 remain untouched", async () => {
      assert.equal(await prisma.assessmentAttempt.count(), baseline.assessmentAttempts);
      assert.equal(await prisma.userLessonProgress.count(), baseline.lessonProgress);
      assert.equal(await prisma.xPTransaction.count(), baseline.xp);
      assert.equal(await prisma.task.count(), baseline.v1Tasks);
      assert.equal(await prisma.userTaskProgress.count(), baseline.v1Progress);
    });

    await check("47. feature flag can be disabled again without stale capture", async () => {
      process.env.CURRICULUM_V2_CONTENT_ENABLED = "false";
      await expectError(
        () => content.deleteContentVersion({ actorId: admin.id, contentVersionId: rollbackDelete.id }),
        "CONTENT_DISABLED",
      );
      process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  await check("48. temporary database is removed", () => assert.equal(fs.existsSync(dbPath), false));
  assert.equal(passed + failed, 48, "content lifecycle scenario count drifted");
}

main()
  .then(() => {
    console.log(`\ncurriculum content lifecycle regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum content lifecycle regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
