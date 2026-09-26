# Test Accounts

Version: `0.1.0-beta.1`

Local seed creates these demo accounts for closed beta verification:

| Role | Email | Password |
| --- | --- | --- |
| User | `user@test.com` | `<local seed password>` |
| Admin | `admin@test.com` | `<local seed password>` |
| Support | `support@test.com` | `<local seed password>` |
| Mentor | `mentor@test.com` | `<local seed password>` |
| Moderator | `moderator@test.com` | `<local seed password>` |
| News editor | `news@test.com` | `<local seed password>` |

## Live closed-beta test accounts

Dedicated live accounts are maintained separately from destructive local seed/reset flows.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@test.com` | `<ask project owner for live test password>` |
| User | `user@test.com` | `<ask project owner for live test password>` |
| Support | `support@test.com` | `<ask project owner for live test password>` |
| Mentor | `mentor@test.com` | `<ask project owner for live test password>` |
| Moderator | `moderator@test.com` | `<ask project owner for live test password>` |
| News editor | `news@test.com` | `<ask project owner for live test password>` |

The live password is intentionally not committed to docs or scripts. On the live server it is stored as an operator-only secure note:

```text
/home/ubuntu/trading-mvp/.secure/live-test-account-password.txt
```

Use `TEST_ACCOUNT_PASSWORD` when rotating/upserting live accounts:

```bash
TEST_ACCOUNT_PASSWORD='<temporary live test password>' node scripts/live/upsertLiveTestAccounts.cjs
```

The upsert script only creates/updates the dedicated `*@test.com` users, sets the requested role, keeps the account active, stores a fresh password hash, and marks email as verified when the live schema supports email verification. It does not reset the production DB and does not touch postbacks, exchange accounts, or live tester records.

## Seed baseline

- User XP: `420`
- Active task: step `4`
- Unread notifications: `0`
- Demo exchange account exists.
- Previous-day daily reward exists so the next claim verifies streak continuation.
- General chat is open and level-5 chat remains visibly locked for the demo user.
- Seed promocode `MVP100` and achievement catalog exist.
- Reports, support, feedback, uploads, and audit smoke records are reset by seed/smoke cleanup.
- Service roles are redirected to their own work areas and denied the user dashboard.

Real closed beta testers should register unique emails instead of sharing seeded or dedicated test credentials. A new tester receives active task step 1, locked later tasks, a checkpoint record, and a locked mentor dialog.

Do not treat seeded or live test accounts as production user credentials.
