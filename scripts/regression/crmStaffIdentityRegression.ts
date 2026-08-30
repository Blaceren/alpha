import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient, StaffRole, UserRole } from "@prisma/client";
import {
  CRM_PERMISSIONS,
  CRM_STAFF_ROLES,
  STAFF_ROLE_PERMISSIONS,
  isCrmStaffRole,
  resolveEffectivePermissions,
  type CrmPermission,
  type CrmStaffRole,
} from "../../src/lib/crm/roles";
import { staffRoleSchema } from "../../src/lib/crm/schemas";

const dbPath = `/tmp/ata-crm-staff-identity-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const migrationName = "20260719000000_crm_staff_identity";
const migrationPath = path.join(process.cwd(), "prisma", "migrations", migrationName, "migration.sql");

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

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function enumValues(schemaText: string, enumName: string): string[] {
  const match = new RegExp(`enum ${enumName} \\{([^}]*)\\}`).exec(schemaText);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

// Locked contract, duplicated here so the test fails if the shipped matrix drifts.
const LOCKED_MATRIX: Record<CrmStaffRole, CrmPermission[]> = {
  crm_admin: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "view_audit", "manage_settings", "edit_user_notes",
    "view_user_notes", "create_user_notes", "view_affiliate_analytics",
    // PHASE-G0: the only role holding `manage_settings`, this matrix's marker
    // for "owns configuration", and therefore the only approving role.
    "curriculum_read", "curriculum_author", "curriculum_approve",
    // PHASE-G2: deciding which of two competing SOURCES is authority follows the
    // same `manage_settings` marker, so it lands on this role and no other.
    "curriculum_source_authority",
  ],
  crm_manager: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "view_audit", "edit_user_notes",
    "view_user_notes", "create_user_notes", "view_affiliate_analytics",
    // PHASE-G0: read only. It holds `view_audit` (broad supervisory read) but
    // NOT `manage_settings`, so it may inspect authoring and never decide it.
    "curriculum_read",
  ],
  retention_manager: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "edit_user_notes",
    "view_user_notes", "create_user_notes",
  ],
  mentor: [],
  support: ["edit_user_notes", "view_user_notes", "create_user_notes"],
  moderator: [],
  // AFD-5A: analyst's first and only permission. Read-only by construction.
  analyst: ["view_affiliate_analytics"],
  // PHASE-G0: content_manager's first permissions. Authors, never approves.
  content_manager: ["curriculum_read", "curriculum_author"],
  // PHASE-G0: read_only's first permission, and the only kind it may hold.
  read_only: ["curriculum_read"],
  // PHASE-1 ADMIN: the dedicated progression operator. Exactly one permission,
  // and it is the whole reason the role exists.
  //
  // NOTE FOR WHOEVER RUNS THIS NEXT. This LOCKED_MATRIX has been stale since
  // LEARNER-OPERATIONS-V1: it omits the ten `learner_ops_*` grants and
  // COMMUNITY-V1's `community_moderate`, and check 4 still asserts fifteen
  // permissions when the shipped vocabulary has twenty-seven. Those failures
  // PRE-DATE this phase and were reproduced on the unchanged baseline before
  // this line was added — `git show HEAD:src/lib/crm/roles.ts` already declares
  // twenty-six. This entry is added only so the file compiles; deliberately
  // nothing else here is "corrected", because silently rewriting a locked
  // matrix to match the code it is supposed to police would destroy the very
  // signal it exists to raise.
  progression_operator: ["curriculum_progress_override"],
};

async function main() {
  cleanupDb();
  const schemaText = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  await check("1. Prisma schema declares a separate StaffRole enum", () => {
    assert.ok(/enum StaffRole \{/.test(schemaText), "StaffRole enum missing");
    assert.ok(/model StaffProfile \{/.test(schemaText), "StaffProfile model missing");
  });

  await check("2. UserRole remains unchanged (exact six values)", () => {
    assert.deepEqual(enumValues(schemaText, "UserRole"), [
      "user", "admin", "support", "mentor", "moderator", "news_editor",
    ]);
    assert.deepEqual(Object.values(UserRole), [
      "user", "admin", "support", "mentor", "moderator", "news_editor",
    ]);
  });

  await check("3. StaffRole has exactly the nine canonical values (schema, Prisma, TS, Zod parity)", () => {
    const expected = [
      "crm_admin", "crm_manager", "retention_manager", "mentor", "support",
      "moderator", "analyst", "content_manager", "read_only",
    ];
    assert.deepEqual(enumValues(schemaText, "StaffRole"), expected);
    assert.deepEqual(Object.values(StaffRole), expected);
    assert.deepEqual([...CRM_STAFF_ROLES], expected);
    assert.deepEqual([...staffRoleSchema.options], expected);
    assert.equal(new Set(CRM_STAFF_ROLES).size, 9);
  });

  await check("4. CrmPermission has exactly fifteen unique canonical values", () => {
    // Notes v1 appended view_user_notes and create_user_notes. AFD-5A appended
    // view_affiliate_analytics. PHASE-G0 appended the three curriculum-authoring
    // permissions. PHASE-G2 appended curriculum_source_authority. The accepted
    // first eight keep their exact previous relative order, and so do the two
    // Notes v1 entries and the AFD-5A entry — every addition APPENDS, so no
    // existing position ever changes meaning.
    assert.equal(CRM_PERMISSIONS.length, 15);
    assert.equal(new Set(CRM_PERMISSIONS).size, 15);
    assert.deepEqual([...CRM_PERMISSIONS], [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
      "view_user_notes", "create_user_notes", "view_affiliate_analytics",
      "curriculum_read", "curriculum_author", "curriculum_approve",
      "curriculum_source_authority",
    ]);
    assert.deepEqual(CRM_PERMISSIONS.slice(0, 8), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
    ]);
    assert.deepEqual(CRM_PERMISSIONS.slice(0, 10), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
      "view_user_notes", "create_user_notes",
    ]);
    assert.deepEqual(CRM_PERMISSIONS.slice(0, 11), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
      "view_user_notes", "create_user_notes", "view_affiliate_analytics",
    ]);
  });

  await check("5. Matrix has an explicit entry for all nine roles", () => {
    assert.deepEqual(Object.keys(STAFF_ROLE_PERMISSIONS).sort(), [...CRM_STAFF_ROLES].sort());
  });

  await check("6. Matrix matches the locked contract exactly", () => {
    for (const role of CRM_STAFF_ROLES) {
      assert.deepEqual([...STAFF_ROLE_PERMISSIONS[role]], LOCKED_MATRIX[role], `role ${role}`);
    }
  });

  await check("7. effectivePermissions are returned in stable canonical order", () => {
    // crm_admin lists every permission; the resolver must echo canonical order.
    assert.deepEqual(resolveEffectivePermissions("crm_admin"), [...CRM_PERMISSIONS]);
    // crm_manager keeps canonical order even though manage_settings is skipped,
    // and PHASE-G0's curriculum_read lands after it in canonical order rather
    // than beside the other permissions the role happens to hold.
    assert.deepEqual(resolveEffectivePermissions("crm_manager"), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "edit_user_notes", "view_user_notes", "create_user_notes",
      "view_affiliate_analytics", "curriculum_read",
    ]);
    // analyst holds exactly the AFD-5A read permission and nothing else — in
    // particular NOT manage_settings, which is what makes it read-only.
    assert.deepEqual(resolveEffectivePermissions("analyst"), ["view_affiliate_analytics"]);
  });

  await check("8. no role grants a duplicate permission", () => {
    for (const role of CRM_STAFF_ROLES) {
      const list = STAFF_ROLE_PERMISSIONS[role];
      assert.equal(new Set(list).size, list.length, `role ${role} has duplicates`);
    }
  });

  await check("9. crm_admin receives all fifteen permissions", () => {
    assert.equal(resolveEffectivePermissions("crm_admin").length, 15);
    // PHASE-G2 — and it is the ONLY role that may adjudicate source authority.
    for (const role of CRM_STAFF_ROLES) {
      const holds = resolveEffectivePermissions(role).includes("curriculum_source_authority");
      assert.equal(holds, role === "crm_admin", `role ${role} source-authority grant`);
    }
  });

  await check("10. crm_manager does not receive manage_settings", () => {
    const perms = resolveEffectivePermissions("crm_manager");
    assert.ok(!perms.includes("manage_settings"));
    // AFD-5A added view_affiliate_analytics: crm_manager is the only non-admin
    // role holding view_audit, this matrix's marker for broad supervisory read.
    assert.ok(perms.includes("view_affiliate_analytics"));
    // PHASE-G0 added curriculum_read, and deliberately NOT curriculum_approve:
    // approval follows manage_settings, which crm_manager does not hold.
    assert.ok(perms.includes("curriculum_read"));
    assert.ok(!perms.includes("curriculum_author"));
    assert.ok(!perms.includes("curriculum_approve"));
    assert.ok(!perms.includes("curriculum_source_authority"));
    assert.equal(perms.length, 11);
  });

  await check("11. retention_manager receives neither view_audit nor manage_settings", () => {
    const perms = resolveEffectivePermissions("retention_manager");
    assert.ok(!perms.includes("view_audit"));
    assert.ok(!perms.includes("manage_settings"));
    assert.equal(perms.length, 8);
  });

  await check("12. support receives only the three note permissions", () => {
    // support gained the two Notes v1 permissions; it still holds nothing else.
    assert.deepEqual(resolveEffectivePermissions("support"), [
      "edit_user_notes", "view_user_notes", "create_user_notes",
    ]);
  });

  await check("13. mentor and moderator still receive no permissions at all", () => {
    // AFD-5A removed `analyst` from this list. PHASE-G0 removed
    // `content_manager` and `read_only`, which now hold curriculum permissions
    // (asserted in 13c). `mentor` and `moderator` must STAY empty: every grant
    // so far has been a deliberate single decision, never a general loosening,
    // and a mentor reviews LEARNERS rather than the curriculum.
    for (const role of ["mentor", "moderator"]) {
      assert.deepEqual(resolveEffectivePermissions(role), [], `role ${role}`);
    }
  });

  await check("13c. PHASE-G0 curriculum grants are exactly the decided ones", () => {
    // content_manager authors and may NEVER approve — the four-eyes split.
    assert.deepEqual(resolveEffectivePermissions("content_manager"), [
      "curriculum_read", "curriculum_author",
    ]);
    // read_only holds a read permission and nothing that can mutate.
    assert.deepEqual(resolveEffectivePermissions("read_only"), ["curriculum_read"]);

    // Exactly ONE role may approve, and it is the one holding manage_settings.
    const approvers = CRM_STAFF_ROLES.filter((role) =>
      resolveEffectivePermissions(role).includes("curriculum_approve"),
    );
    assert.deepEqual(approvers, ["crm_admin"]);
    for (const role of approvers) {
      assert.ok(
        resolveEffectivePermissions(role).includes("manage_settings"),
        "approval must follow the matrix's own authority marker",
      );
    }

    // Nobody learner-facing may author or approve.
    for (const role of ["mentor", "support", "moderator", "analyst", "retention_manager"]) {
      const perms = resolveEffectivePermissions(role);
      assert.ok(!perms.includes("curriculum_author"), `${role} must not author`);
      assert.ok(!perms.includes("curriculum_approve"), `${role} must not approve`);
    }
  });

  await check("13b. analyst receives exactly the affiliate read permission and no mutation right", () => {
    const perms = resolveEffectivePermissions("analyst");
    assert.deepEqual(perms, ["view_affiliate_analytics"]);
    assert.ok(!perms.includes("manage_settings"), "analyst must never gain manage_settings");
    assert.ok(!perms.includes("export"));
    assert.ok(!perms.includes("reveal_pii"));
    assert.ok(!perms.includes("view_identity_full_email"));
  });

  await check("14. unknown StaffRole fails closed with no permissions", () => {
    assert.deepEqual(resolveEffectivePermissions("root"), []);
    assert.equal(isCrmStaffRole("root"), false);
    assert.equal(isCrmStaffRole("crm_admin"), true);
  });

  // ---- migration + backfill on a real database ----
  const migrate = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });

  await check("15. migration applies cleanly on a fresh database", () => {
    assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);
  });

  process.env.DATABASE_URL = dbUrl;
  const prisma = new PrismaClient();

  try {
    const backfill = migrationSql.split(";").map((statement) => statement.trim()).find((statement) => statement.startsWith("INSERT INTO"));
    assert.ok(backfill, "backfill INSERT not found in migration");

    const staffSpecs: Array<{ email: string; name: string; role: UserRole; expected: StaffRole | null }> = [
      { email: "id-admin@example.com", name: "Ada", role: "admin", expected: "crm_admin" },
      { email: "id-support@example.com", name: "   ", role: "support", expected: "support" },
      { email: "id-mentor@example.com", name: "Mo", role: "mentor", expected: "mentor" },
      { email: "id-moderator@example.com", name: "Mira", role: "moderator", expected: "moderator" },
      { email: "id-news@example.com", name: "Ned", role: "news_editor", expected: "content_manager" },
      { email: "id-learner@example.com", name: "Lena", role: "user", expected: null },
    ];
    const users = new Map<UserRole, { id: number }>();
    for (const spec of staffSpecs) {
      const user = await prisma.user.create({ data: { email: spec.email, name: spec.name, role: spec.role, passwordHash: "x" } });
      users.set(spec.role, user);
    }
    await prisma.$executeRawUnsafe(backfill!);

    await check("16. learner (role=user) receives no StaffProfile", async () => {
      assert.equal(await prisma.staffProfile.count({ where: { user: { role: "user" } } }), 0);
    });

    await check("17. backfill maps each service role to the correct StaffRole", async () => {
      for (const spec of staffSpecs) {
        if (!spec.expected) continue;
        const profile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: users.get(spec.role)!.id } });
        assert.equal(profile.staffRole, spec.expected, `role ${spec.role}`);
      }
      const supportProfile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: users.get("support")!.id } });
      assert.equal(supportProfile.displayName, "Сотрудник", "blank name should fall back");
      const adminProfile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: users.get("admin")!.id } });
      assert.equal(adminProfile.displayName, "Ada");
      assert.equal(adminProfile.permissionVersion, 1);
    });

    await check("15b. employeeId (StaffProfile.id) differs from User.id", async () => {
      const admin = users.get("admin")!;
      const profile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: admin.id } });
      assert.notEqual(profile.id, String(admin.id));
      assert.ok(profile.id.length > 8);
    });

    await check("18. StaffProfile.userId is unique (duplicate rejected)", async () => {
      const admin = users.get("admin")!;
      await assert.rejects(
        () => prisma.staffProfile.create({ data: { userId: admin.id, displayName: "Dupe", staffRole: "read_only" } }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
      );
    });

    await check("19. foreign_key_check is empty after backfill", async () => {
      const rows = await prisma.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check");
      assert.equal(rows.length, 0);
    });

    await check("20. backfill is idempotent (re-run creates no duplicates)", async () => {
      const before = await prisma.staffProfile.count();
      await prisma.$executeRawUnsafe(backfill!);
      assert.equal(await prisma.staffProfile.count(), before);
      assert.equal(before, 5);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
