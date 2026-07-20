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
    "view_user_notes", "create_user_notes",
  ],
  crm_manager: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "view_audit", "edit_user_notes",
    "view_user_notes", "create_user_notes",
  ],
  retention_manager: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "edit_user_notes",
    "view_user_notes", "create_user_notes",
  ],
  mentor: [],
  support: ["edit_user_notes", "view_user_notes", "create_user_notes"],
  moderator: [],
  analyst: [],
  content_manager: [],
  read_only: [],
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

  await check("4. CrmPermission has exactly ten unique canonical values", () => {
    // Notes v1 appended view_user_notes and create_user_notes. The accepted
    // first eight keep their exact previous relative order.
    assert.equal(CRM_PERMISSIONS.length, 10);
    assert.equal(new Set(CRM_PERMISSIONS).size, 10);
    assert.deepEqual([...CRM_PERMISSIONS], [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
      "view_user_notes", "create_user_notes",
    ]);
    assert.deepEqual(CRM_PERMISSIONS.slice(0, 8), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
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
    // crm_manager keeps canonical order even though manage_settings is skipped.
    assert.deepEqual(resolveEffectivePermissions("crm_manager"), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "edit_user_notes", "view_user_notes", "create_user_notes",
    ]);
  });

  await check("8. no role grants a duplicate permission", () => {
    for (const role of CRM_STAFF_ROLES) {
      const list = STAFF_ROLE_PERMISSIONS[role];
      assert.equal(new Set(list).size, list.length, `role ${role} has duplicates`);
    }
  });

  await check("9. crm_admin receives all ten permissions", () => {
    assert.equal(resolveEffectivePermissions("crm_admin").length, 10);
  });

  await check("10. crm_manager does not receive manage_settings", () => {
    const perms = resolveEffectivePermissions("crm_manager");
    assert.ok(!perms.includes("manage_settings"));
    assert.equal(perms.length, 9);
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

  await check("13. mentor, moderator, analyst, content_manager, read_only receive no permissions", () => {
    for (const role of ["mentor", "moderator", "analyst", "content_manager", "read_only"]) {
      assert.deepEqual(resolveEffectivePermissions(role), [], `role ${role}`);
    }
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
