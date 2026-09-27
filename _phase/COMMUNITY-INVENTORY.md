# ATA-PREPROD-COMMUNITY-END-TO-END-1 — Current-state Community inventory

Read from the live PREPROD host and the source-owning repositories on 2026-08-16.
Nothing here is inferred from documentation alone; every count is a query.

## 0. Starting release state (verified, not assumed)

| Component | `current` target | Source HEAD | Drift | Health |
|---|---|---|---|---|
| backend | `69fd15970b80a98b6aa18972d84ef06187054b26` | `d2a091f0616a5d228a4570ef278a5ba66a47a071` | docs-only: `docs/RELEASE_ARTIFACT_CONTENTS.md`, +48 lines | `200 {"ok":true,"database":"connected"}` |
| academy | `6ff93eafd6634b7f746e000ff7c958812c5a1783` | `6ff93eaf…` (identical) | none | `307` (auth redirect — expected) |
| crm | `49f16adad7b4910907e97807f4c67296fa3569a2` | — | — | `307` (auth redirect — expected) |
| partner | `2265f436edf08380261369599e2d9a61b81582c5` | — | — | `200` |

All four units `active/running`. Migration count **52** (`prisma/migrations`, newest
`20260816120000_learner_ops_review_work_item_anchors`).

Rollback receipts, all four resolve to existing directories:

```
backend  -> /srv/ata/releases/backend/e5214ce40198ba2e70866def13177d70048bea9f
academy  -> /srv/ata/releases/academy/99b2b72fe599c6502552a60fd0945e2ac1fa3b25
crm      -> /srv/ata/releases/crm/d181d331294c0f818e02b4fe8c9c0e205fb1589c
partner  -> /srv/ata/releases/partner/68ade7628bcb00193d625d9b5d448bae8e36f55e
```

Release tooling: `install-release-tooling.sh --check` reports **all 6 files `ok`**, active
tooling matches source commit `92819f6758828ae54de42519c4d003e9e7314f6b` (branch `main`,
tree `f651bf19…`), clean working tree. Source owner `/home/ubuntu/ata-release-tooling`.

Product source ownership confirmed: `/home/ubuntu/learner-ops-v1/{academy,backend}`, both on
branch `product/learner-operations-v1`, both working trees clean. `/srv/ata/repos` was **not**
used as source.

---

## 1. What Community exists today

### 1.1 Data models (Backend `prisma/schema.prisma`, 125 models total)

Seven models form the legacy chat domain:

| Model | Shape | Notes |
|---|---|---|
| `ChatChannel` | slug, title, description, `requiredLevel`, `requiredCheckpoint`, `requiredAchievement`, `isLockedVisible`, `isActive`, **`retentionDays` default 3** | a channel list, not a space of discussions |
| `ChatMessage` | `channelId`, `userId`, **`userName`, `userLevel`, `userRank`, `role`, `achievementTitle` denormalised**, `message`, `isHidden` | flat message. No title, no parent, no thread |
| `MentorChannelAssignment` | channel × mentor | grants a mentor access to a channel |
| `ModeratorChannelAssignment` | channel × moderator | grants a moderator access to a channel |
| `ChatModerationRule` | `type` (`stop_word`), `value`, `isActive` | global stop-word list |
| `ChatMute` | user, optional channel, reason, `expiresAt` | mute, global or per channel |
| `ChatModerationLog` | moderator, user, channel, message, action, reason, metadata | append-only moderation history |

**There is no thread, no discussion, no reply, no reaction, no report and no read-state model
anywhere in the schema.** The word "post", "thread", "topic" and "reply" do not name any model.

### 1.2 Live PREPROD data — this is the decisive fact

```
ChatChannel                  5
ChatMessage                  0
ChatMute                     0
ChatModerationRule           0
ChatModerationLog            0
MentorChannelAssignment      0
ModeratorChannelAssignment   0
```

The five seeded channels:

| id | slug | title | requiredLevel | requiredCheckpoint | requiredAchievement |
|---|---|---|---|---|---|
| 1 | `newcomers` | Вопросы новичков | 1 | — | — |
| 2 | `reports` | Отчёты и разборы | 3 | — | — |
| 3 | `after-checkpoint` | Чат после checkpoint | — | `lvl_04_any_deposit` | — |
| 4 | `achievement-private` | Клуб достижений | — | — | `first-report` |
| 5 | `general` | Общий чат | 1 | — | — |

**Legacy Community has never carried a single message in PREPROD.** It is a seeded,
never-exercised surface. No real PREPROD data depends on it.

### 1.3 Routes and UI

**Backend app (the V1 product, Next.js, port 3100):**

| Route | Kind | State |
|---|---|---|
| `/chat` | page, 39 lines | renders `<ChatRoom>`; kicker "Комьюнити", title "Сообщество" |
| `/mentor-chat` | page, 173 lines | separate 1:1 mentor dialog — **not** community (DD-080 keeps them separate) |
| `/admin/chat-moderation` | page, 6 lines | moderator console |
| `GET/POST /api/chat` | API | list + send messages in one channel |
| `GET /api/chat/channels` | API | channel list with per-channel `unlocked` |
| `GET/POST /api/admin/chat-moderation` | API | rules, mutes, hide/delete, assignments |

**Academy app (the V2 product, port 3050):** `/community` **does not exist**. It is declared in
`src/config/navigation.ts` (`PRIMARY_NAV` and `MORE_MENU`, label "Сообщество") but is absent from
`src/config/built-routes.ts`, so `desktop-route-navigation.tsx` and `mobile-bottom-navigation.tsx`
filter it out. The learner is shown no Community entry at all, and the route would 404.

**CRM app:** no community or chat surface of any kind (`grep -rli community|chat src/` returns only
auth/affiliate files matching on unrelated substrings). Community moderation has no staff console
in the V2 CRM.

### 1.4 Access model (legacy) — `src/lib/chatModeration.ts::canAccessChannel`

```
admin                     → always true
mentor                    → true iff MentorChannelAssignment exists
moderator                 → true iff ModeratorChannelAssignment exists
any other non-"user" role → false
user                      → requiredLevel  ≤ User.level
                          ∧ requiredCheckpoint completed in UserTaskProgress (V1 task table)
                          ∧ requiredAchievement granted in UserAchievement
```

Server-side, single owner, and `/api/chat/channels` reuses the same function for its `unlocked`
flag — so the frontend does not duplicate the rule. That part is sound.

**What is broken about it is the authority it reads.** `User.level` is V1 storage. Live PREPROD:

| user | name | `User.level` | `User.xp` | V2 `highestCompletedLevel` | V2 `currentLevel` |
|---|---|---|---|---|---|
| 56 | G3 E2E QA Learner (synthetic) | 1 | 0 | 14 | 15 |
| 73 | LO Mentor Learner (synthetic) | 1 | 0 | 14 | 15 |
| 35 | L2START live | 1 | 0 | 4 | 5 |
| 53 | PREPROD QA G2E2E1 | 1 | 0 | 4 | 5 |

**Every learner in PREPROD reads `level: 1, xp: 0`.** A learner who has completed fourteen V2
levels would be refused channel `reports` (requiredLevel 3) by the legacy gate. This is not a
hypothetical divergence; it is the current state of every row.

This is already a closed, documented finding: `academy/src/lib/api/legacy-progress-boundary.test.ts`
(LEGACY-USER-PROGRESS-COLUMNS-1) pins that the Academy viewer DTO carries neither `level` nor `xp`,
precisely so no V2 surface can read a stale progress number by accident. Neither column is
synchronised or removed, because V1 rank and V1 chat gating are live consumers.

### 1.5 Moderation model (legacy)

`POST /api/admin/chat-moderation` behind `requireModeratorAccess()`, which resolves to
`canModerateChat(role) → role === "admin" || role === "moderator"` on **`User.role`** — the V1 role
column, not `StaffProfile`. Supported actions: `rule.create`, `rule.toggle`, `mute.create`,
`mute.remove`, `message.hide`, `message.delete`, `assignment.create`. Every action writes
`ChatModerationLog`, and mutations validate CSRF. Write-side protections in `moderateMessage`:
2-second per-user cooldown, active-mute check, a blanket URL/`t.me` regex refusal, and the
stop-word list. Plus `rateLimit(10/min)` per user per channel.

There is **no learner-facing reporting** — a learner cannot flag content. Moderation is
staff-initiated only, and staff can only act on what they happen to read in the last 50 messages.

### 1.6 Role model — two systems, and Community sits on the older one

| axis | column | consumers |
|---|---|---|
| V1 | `User.role` (`user`/`admin`/`support`/`mentor`/`moderator`/`news_editor`) | legacy chat access, `canModerateChat`, V1 route guards |
| V2 | `StaffProfile.staffRole` (9 roles) + `CRM_PERMISSIONS` (35 permissions) | CRM, Learner Operations, curriculum authoring |

`src/lib/crm/roles.ts` already states the boundary explicitly, and it is worth quoting because it
pre-decides part of this phase:

> `moderator` and `content_manager` receive NOTHING. **Community moderation** and curriculum
> authoring are not learner operations. `moderator` is the role that matters here: live PREPROD
> data shows one `moderator` StaffProfile whose `User.role` is `admin`, which today grants it
> silent report-review and level-completion authority.

So `STAFF_ROLE_PERMISSIONS.moderator = []`. There is **no `community_*` permission** in
`CRM_PERMISSIONS` today. Live staff fixtures available for the role matrix:

| userId | displayName | staffRole | `User.role` |
|---|---|---|---|
| 54 | PREPROD QA Operator (synthetic) | `moderator` | admin |
| 68 | LO Оператор (synthetic) | `support` | user |
| 69 | LO Наставник (synthetic) | `mentor` | mentor |
| 70 | LO Администратор (synthetic) | `crm_admin` | user |
| 50 | cremtest | `read_only` | user |

### 1.7 Notification integration

`Notification` + `NotificationType` (17 values). **None is a community event** — the closest are
`support_reply` and `mentor_reply`. Live rows: `support_reply` 6, `postback_received` 3. The legacy
chat writes no notification at all.

The Academy already owns the canonical learner notification surface: `/notifications` reading
`GET /api/backend/notifications` → `proxyBackendJson` → Backend `/api/notifications`, GET only, no
read-state write path yet.

### 1.8 Text / rendering safety (current contract)

Legacy `ChatRoom` renders message text as React children — escaped, no `dangerouslySetInnerHTML`,
no markdown renderer anywhere in the Backend or Academy dependency tree. Links are *refused at
write time* by regex rather than rendered safely. There is no sanitiser to inherit because there is
no rich text to sanitise; the safe contract is "plain text, React-escaped".

### 1.9 Real-time

None. `/chat` polls via `getChatMessages()` on mount only. No websocket, no SSE, no
`socket.io` in either dependency tree.

### 1.10 Canonical product contract that already exists for Community

`academy/docs/CURRICULUM_AND_UNLOCKS.md` §5 fixes a five-space Community map:

| Channel code | Название | Unlock level |
|---|---|:---:|
| `channel.start_questions` | Старт и вопросы | L4 |
| `channel.chart_review` | Разбор графиков | L20 |
| `channel.discipline_journal` | Дисциплина и дневник | L35 |
| `channel.strategies` | Стратегии | L45 |
| `channel.advanced_circle` | Продвинутый круг | L85 |

Honest provenance note: `les-prog.txt` — the canonical curriculum source — defines **tool** unlocks
at checkpoint levels and mentions no community channel. The five unlock levels are a D0 design-doc
decision, not a curriculum threshold. They are not arbitrary: all five are exactly module
checkpoint levels (M1→L4, M4→L20, M7→L35, M9→L45, M17→L85), verified against the published
`ModuleDefinition` rows of curriculum version 4.

The legacy DB channels (`newcomers`, `reports`, `after-checkpoint`, `achievement-private`,
`general`) are a **different, older five** with different slugs and V1 gates. They are not the
canonical V2 map.

---

## 2. Classification

| # | Capability | Class | Reasoning |
|---|---|---|---|
| C-01 | `ChatChannel` / `ChatMessage` models | **LEGACY / PRESERVE** | live V1 authority for `/chat`; 3-day retention and denormalised `userLevel`/`userRank` make them wrong for durable discussion, but nothing may break them |
| C-02 | `/chat`, `/api/chat`, `/api/chat/channels` | **LEGACY / PRESERVE** | V1 product surface, untouched this phase |
| C-03 | `canAccessChannel` reading `User.level` | **UNSAFE TO REUSE** for V2 | reads V1 storage that is `1` for every PREPROD learner; §12 forbids it as V2 authority. Preserved unchanged for V1 |
| C-04 | `requiredCheckpoint` → `UserTaskProgress` | **UNSAFE TO REUSE** for V2 | V1 task table, not the V2 checkpoint owner |
| C-05 | `requiredAchievement` gate | **DEPRECATE-LATER** | V1 achievement economy; no V2 equivalent, and §11/§37 discourage a badge economy |
| C-06 | `ChatModerationLog` | **ADAPT** | the shape is right (actor, target, action, reason, append-only). Community needs its own equivalent rather than overloading a chat-message-shaped log |
| C-07 | `ChatMute` / `ChatModerationRule` / stop-words | **LEGACY / PRESERVE** | 0 rows, V1-scoped; a V1 moderation rule silently governing V2 content would be an invisible authority |
| C-08 | `moderateMessage` write guards (cooldown, rate limit) | **ADAPT** | the *pattern* is right and `rateLimit()` is shared infrastructure; the thresholds suit a chat, not a discussion |
| C-09 | Blanket URL refusal regex | **ADAPT** | refusing all links in a *learning* community blocks legitimate chart/article references. §30 wants safe rendering, not prohibition |
| C-10 | `canModerateChat` on `User.role` | **UNSAFE TO REUSE** | `User.role` is the V1 axis the CRM permission model was built to replace; `roles.ts` already names Community moderation as a missing permission |
| C-11 | `requireLearnerOpsStaff` / `requireLearnerOpsLearner` gates | **REUSE** | the canonical two-gate pattern, permission-checked server-side, error envelope that never names a permission |
| C-12 | `StaffProfile` + `CRM_PERMISSIONS` | **REUSE** | the single canonical staff identity. Community adds a permission, never a second staff model |
| C-13 | `Notification` model + `/notifications` surface | **REUSE** | one canonical learner notification surface already exists; §23 forbids a second |
| C-14 | Academy bounded proxy pattern (`server/proxy/*`) | **REUSE** | constant Backend paths, validated ids, no staff route reachable from the learner origin |
| C-15 | Academy viewer DTO boundary | **REUSE** | already drops `level`/`xp`; Community must not reintroduce them |
| C-16 | V2 progression (`UserCurriculumEnrollment`, `UserLevelProgress`, `resolveUserCurriculumLevelStates`) | **REUSE** | the canonical V2 progression authority for gating and context |
| C-17 | Nav entry `community` in `PRIMARY_NAV`/`MORE_MENU` | **REUSE** | canonical label/order already fixed; only `built-routes.ts` needs the id |
| C-18 | Five-space unlock map (`CURRICULUM_AND_UNLOCKS.md` §5) | **REUSE** | an accepted product contract; avoids inventing spaces or building 20 empty module channels |
| C-19 | Discussion / thread / reply persistence | **MISSING** | no model, no route, no UI |
| C-20 | Learner content reporting | **MISSING** | learners cannot flag anything today |
| C-21 | Community moderation permission | **MISSING** | `CRM_PERMISSIONS` has no `community_*` entry |
| C-22 | Community notifications | **MISSING** | no `NotificationType` value for a reply |
| C-23 | Soft-delete / hidden-content rendering | **MISSING** | `isHidden` exists on `ChatMessage` but the client simply never receives hidden rows; there is no "removed by moderator" rendering contract |
| C-24 | Reactions | **MISSING** (and not built) | §9: absent today, and discussion quality outranks reaction count |
| C-25 | Read state / presence | **MISSING** (and not built) | §37 |
| C-26 | DMs | **MISSING** (and not built) | §38; private help belongs to Support, which shipped in LEARNER-OPERATIONS-V1 |
| C-27 | Real-time transport | **MISSING** (and not built) | §39 permits refresh/revalidation for V1 |
| C-28 | Search | **MISSING** (and not built) | §24; five structured spaces do not need it |

### Dead / fixture-only summary

- `/community` in Academy nav: **declared, unbuilt, filtered out** — dead pointer, no 404 reachable
  by a learner today.
- Legacy `/chat`: **reachable and functional in V1, zero real data.**
- `ChatMute`, `ChatModerationRule`, `ChatModerationLog`, both assignment tables: **zero rows** —
  the legacy moderation model has never been exercised.

**No legacy behaviour is deleted in this phase.**
