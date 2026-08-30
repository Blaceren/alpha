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
    // LEARNER-OPERATIONS-V1: the department's full set, including the two review
    // decisions and `learner_ops_admin`.
    "learner_ops_view", "learner_ops_handle", "learner_ops_report_review",
    "learner_ops_mentor_review", "learner_ops_escalate", "learner_ops_manage_queues",
    "learner_ops_qa", "learner_ops_analytics", "learner_ops_admin",
    "learner_ops_escalation_resolve",
    // COMMUNITY-V1.
    "community_moderate",
    // PHASE-1 ADMIN deliberately does NOT appear here. `curriculum_progress_override`
    // belongs to `progression_operator` alone, so the power to change what a
    // learner has completed never arrives bundled with administration.
  ],
  crm_manager: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "view_audit", "edit_user_notes",
    "view_user_notes", "create_user_notes", "view_affiliate_analytics",
    // PHASE-G0: read only. It holds `view_audit` (broad supervisory read) but
    // NOT `manage_settings`, so it may inspect authoring and never decide it.
    "curriculum_read",
    // LEARNER-OPERATIONS-V1: supervisory operations, but NEITHER review decision
    // — approving educational work is not supervision.
    "learner_ops_view", "learner_ops_handle", "learner_ops_escalate",
    "learner_ops_manage_queues", "learner_ops_qa", "learner_ops_analytics",
    "learner_ops_escalation_resolve",
  ],
  retention_manager: [
    "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
    "export", "edit_user_notes",
    "view_user_notes", "create_user_notes",
    // LEARNER-OPERATIONS-V1: frontline handling only.
    "learner_ops_view", "learner_ops_handle",
  ],
  // LEARNER-OPERATIONS-V1 gave `mentor` its first permissions. It may decide BOTH
  // review outcomes and may RESOLVE an escalation — but deliberately may not
  // RAISE one (LO-ESCALATION-RESOLVE-AUTHORITY-1: the authority a question is
  // routed TO must be able to answer it).
  mentor: [
    "learner_ops_view", "learner_ops_handle", "learner_ops_report_review",
    "learner_ops_mentor_review", "learner_ops_escalation_resolve",
  ],
  support: [
    "edit_user_notes", "view_user_notes", "create_user_notes",
    // LEARNER-OPERATIONS-V1: may handle and may RAISE an escalation, and
    // deliberately holds NEITHER review permission — a frontline operator who
    // may answer a learner must not thereby become a progression authority.
    "learner_ops_view", "learner_ops_handle", "learner_ops_escalate",
  ],
  // COMMUNITY-V1 gave `moderator` its first and only permission.
  moderator: ["community_moderate"],
  // AFD-5A gave analyst read-only affiliate inventory; LEARNER-OPERATIONS-V1
  // added operational analytics. Read only in both cases: no `manage_settings`.
  analyst: ["view_affiliate_analytics", "learner_ops_analytics"],
  // PHASE-G0: content_manager authors, never approves.
  content_manager: ["curriculum_read", "curriculum_author"],
  // PHASE-G0 gave read_only its first permission; LEARNER-OPERATIONS-V1 added
  // the department's read. Both are reads, which is the only kind it may hold.
  read_only: ["curriculum_read", "learner_ops_view"],
  // PHASE-1 ADMIN: the dedicated progression operator. Exactly one permission,
  // and it is the whole reason the role exists.
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

  await check("3. StaffRole has exactly the ten canonical values (schema, Prisma, TS, Zod parity)", () => {
    // PHASE-1 ADMIN appended `progression_operator`, the dedicated administrative
    // progression principal. Appended, never inserted, so no existing position
    // changes meaning. It is a code-only addition: Prisma models enums as bare
    // TEXT on SQLite and `StaffProfile.staffRole` carries no CHECK constraint.
    const expected = [
      "crm_admin", "crm_manager", "retention_manager", "mentor", "support",
      "moderator", "analyst", "content_manager", "read_only",
      "progression_operator",
    ];
    assert.deepEqual(enumValues(schemaText, "StaffRole"), expected);
    assert.deepEqual(Object.values(StaffRole), expected);
    assert.deepEqual([...CRM_STAFF_ROLES], expected);
    assert.deepEqual([...staffRoleSchema.options], expected);
    assert.equal(new Set(CRM_STAFF_ROLES).size, 10);
  });

  await check("4. CrmPermission has exactly twenty-seven unique canonical values", () => {
    // Notes v1 appended view_user_notes and create_user_notes. AFD-5A appended
    // view_affiliate_analytics. PHASE-G0 appended the three curriculum-authoring
    // permissions. PHASE-G2 appended curriculum_source_authority. The accepted
    // first eight keep their exact previous relative order, and so do the two
    // Notes v1 entries and the AFD-5A entry — every addition APPENDS, so no
    // existing position ever changes meaning.
    assert.equal(CRM_PERMISSIONS.length, 27);
    assert.equal(new Set(CRM_PERMISSIONS).size, 27);
    assert.deepEqual([...CRM_PERMISSIONS], [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes",
      "view_user_notes", "create_user_notes", "view_affiliate_analytics",
      "curriculum_read", "curriculum_author", "curriculum_approve",
      "curriculum_source_authority",
      // LEARNER-OPERATIONS-V1 appended ten (nine, then
      // `learner_ops_escalation_resolve` splitting raise from resolve).
      // COMMUNITY-V1 appended `community_moderate`. PHASE-1 ADMIN appended
      // `curriculum_progress_override`. Every one APPENDS.
      "learner_ops_view", "learner_ops_handle", "learner_ops_report_review",
      "learner_ops_mentor_review", "learner_ops_escalate",
      "learner_ops_manage_queues", "learner_ops_qa", "learner_ops_analytics",
      "learner_ops_admin", "learner_ops_escalation_resolve",
      "community_moderate",
      "curriculum_progress_override",
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

  await check("5. Matrix has an explicit entry for all ten roles", () => {
    assert.deepEqual(Object.keys(STAFF_ROLE_PERMISSIONS).sort(), [...CRM_STAFF_ROLES].sort());
  });

  await check("6. Matrix matches the locked contract exactly", () => {
    for (const role of CRM_STAFF_ROLES) {
      assert.deepEqual([...STAFF_ROLE_PERMISSIONS[role]], LOCKED_MATRIX[role], `role ${role}`);
    }
  });

  await check("7. effectivePermissions are returned in stable canonical order", () => {
    // crm_admin lists every permission EXCEPT `curriculum_progress_override`
    // (PHASE-1 ADMIN withheld it), so canonical order is asserted against the
    // vocabulary minus exactly that one rather than against the whole list.
    assert.deepEqual(
      resolveEffectivePermissions("crm_admin"),
      CRM_PERMISSIONS.filter((permission) => permission !== "curriculum_progress_override"),
    );
    // crm_manager keeps canonical order even though manage_settings is skipped,
    // and PHASE-G0's curriculum_read lands after it in canonical order rather
    // than beside the other permissions the role happens to hold.
    assert.deepEqual(resolveEffectivePermissions("crm_manager"), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "edit_user_notes", "view_user_notes", "create_user_notes",
      "view_affiliate_analytics", "curriculum_read",
      "learner_ops_view", "learner_ops_handle", "learner_ops_escalate",
      "learner_ops_manage_queues", "learner_ops_qa", "learner_ops_analytics",
      "learner_ops_escalation_resolve",
    ]);
    // analyst holds the AFD-5A read permission and LEARNER-OPERATIONS-V1's
    // analytics read — in particular NOT manage_settings, which is what makes it
    // read-only, and neither review decision.
    assert.deepEqual(resolveEffectivePermissions("analyst"), [
      "view_affiliate_analytics", "learner_ops_analytics",
    ]);
  });

  await check("8. no role grants a duplicate permission", () => {
    for (const role of CRM_STAFF_ROLES) {
      const list = STAFF_ROLE_PERMISSIONS[role];
      assert.equal(new Set(list).size, list.length, `role ${role} has duplicates`);
    }
  });

  await check("9. crm_admin receives twenty-six of the twenty-seven permissions", () => {
    // NOT twenty-seven: `curriculum_progress_override` is deliberately withheld
    // from crm_admin. PHASE-1 ADMIN gave it to `progression_operator` alone, so
    // the power to change what a learner has completed does not arrive as part
    // of an administrator bundle.
    assert.equal(resolveEffectivePermissions("crm_admin").length, 26);
    assert.ok(!resolveEffectivePermissions("crm_admin").includes("curriculum_progress_override"));
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
    assert.equal(perms.length, 18);
  });

  await check("11. retention_manager receives neither view_audit nor manage_settings", () => {
    const perms = resolveEffectivePermissions("retention_manager");
    assert.ok(!perms.includes("view_audit"));
    assert.ok(!perms.includes("manage_settings"));
    assert.equal(perms.length, 10);
  });

  await check("12. support receives notes and frontline handling, and NO review", () => {
    // LEARNER-OPERATIONS-V1 widened support beyond notes — but only to handling
    // and raising. It holds NEITHER `learner_ops_report_review` NOR
    // `learner_ops_mentor_review`, because approving educational work completes a
    // level, and it does not hold `curriculum_progress_override` either.
    assert.deepEqual(resolveEffectivePermissions("support"), [
      "edit_user_notes", "view_user_notes", "create_user_notes",
      "learner_ops_view", "learner_ops_handle", "learner_ops_escalate",
    ]);
  });

  await check("13. no role holds the progression override except progression_operator", () => {
    // THIS CHECK REPLACES "mentor and moderator still receive no permissions at
    // all", which stopped being true: LEARNER-OPERATIONS-V1 gave mentor five
    // permissions and COMMUNITY-V1 gave moderator one. Both were deliberate,
    // documented single decisions.
    //
    // What the original was protecting — that a grant is never a general
    // loosening — is now pinned on the permission that would matter most if it
    // leaked, since it is the only one that changes what a learner has completed.
    for (const role of CRM_STAFF_ROLES) {
      const holds = resolveEffectivePermissions(role).includes("curriculum_progress_override");
      assert.equal(holds, role === "progression_operator", `role ${role} progression override`);
    }
    // And the two review decisions stay with exactly the roles that own them.
    for (const role of CRM_STAFF_ROLES) {
      const review = resolveEffectivePermissions(role).includes("learner_ops_report_review");
      assert.equal(review, role === "crm_admin" || role === "mentor", `role ${role} report review`);
    }
  });

  await check("13c. PHASE-G0 curriculum grants are exactly the decided ones", () => {
    // content_manager authors and may NEVER approve — the four-eyes split.
    assert.deepEqual(resolveEffectivePermissions("content_manager"), [
      "curriculum_read", "curriculum_author",
    ]);
    // read_only holds a read permission and nothing that can mutate.
    assert.deepEqual(resolveEffectivePermissions("read_only"), [
      "curriculum_read", "learner_ops_view",
    ]);

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
    // LEARNER-OPERATIONS-V1 added `learner_ops_analytics`: a second READ, on a
    // second domain. The property this check defends is unchanged — analyst
    // reads and never mutates — so the list grows and the refusals below do not.
    assert.deepEqual(perms, ["view_affiliate_analytics", "learner_ops_analytics"]);
    assert.ok(!perms.includes("manage_settings"), "analyst must never gain manage_settings");
    assert.ok(!perms.includes("learner_ops_handle"), "analyst reads work, never handles it");
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
