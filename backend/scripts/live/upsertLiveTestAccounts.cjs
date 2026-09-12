/* eslint-disable @typescript-eslint/no-require-imports */
const { Prisma, PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const accounts = [
  { email: 'admin@test.com', role: 'admin', name: 'Live Test Admin' },
  { email: 'user@test.com', role: 'user', name: 'Live Test User' },
  { email: 'support@test.com', role: 'support', name: 'Live Test Support' },
  { email: 'mentor@test.com', role: 'mentor', name: 'Live Test Mentor' },
  { email: 'moderator@test.com', role: 'moderator', name: 'Live Test Moderator' },
  { email: 'news@test.com', role: 'news_editor', name: 'Live Test News Editor' },
];

function requirePassword() {
  const password = process.env.TEST_ACCOUNT_PASSWORD;
  if (!password) {
    throw new Error('TEST_ACCOUNT_PASSWORD is required');
  }
  if (password.length < 12) {
    throw new Error('TEST_ACCOUNT_PASSWORD must be at least 12 characters');
  }
  return password;
}

function userFields() {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === 'User');
  return new Set(model.fields.map((field) => field.name));
}

function pickWritableUserData(fields, account, passwordHash) {
  const now = new Date();
  const data = {};
  if (fields.has('email')) data.email = account.email;
  if (fields.has('name')) data.name = account.name;
  if (fields.has('username')) data.username = account.email.split('@')[0];
  if (fields.has('role')) data.role = account.role;
  if (fields.has('status')) data.status = 'active';
  if (fields.has('isActive')) data.isActive = true;
  if (fields.has('passwordHash')) data.passwordHash = passwordHash;
  if (fields.has('emailVerifiedAt')) data.emailVerifiedAt = now;
  if (fields.has('emailVerified')) data.emailVerified = true;
  if (fields.has('blocked')) data.blocked = false;
  if (fields.has('deactivated')) data.deactivated = false;
  return data;
}

(async () => {
  const password = requirePassword();
  const fields = userFields();
  const passwordHash = await bcrypt.hash(password, 12);

  for (const account of accounts) {
    const existing = await prisma.user.findUnique({
      where: { email: account.email },
      select: { id: true, email: true, role: true },
    });
    const data = pickWritableUserData(fields, account, passwordHash);
    const user = await prisma.user.upsert({
      where: { email: account.email },
      create: data,
      update: data,
      select: {
        email: true,
        role: true,
        ...(fields.has('status') ? { status: true } : {}),
        ...(fields.has('isActive') ? { isActive: true } : {}),
        ...(fields.has('emailVerifiedAt') ? { emailVerifiedAt: true } : {}),
        ...(fields.has('passwordHash') ? { passwordHash: true } : {}),
      },
    });
    console.log(JSON.stringify({
      email: user.email,
      action: existing ? 'updated' : 'created',
      previousRole: existing?.role,
      role: user.role,
      status: user.status,
      isActive: user.isActive,
      emailVerified: user.emailVerifiedAt ? true : undefined,
      hasPasswordHash: !!user.passwordHash,
    }));
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
