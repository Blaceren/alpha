# ATA-PREPROD-COMMUNITY-END-TO-END-1 — Community V1 product contract & gap matrix

Derived from the inventory (`COMMUNITY-INVENTORY.md`), the existing ATA product contract
(`academy/docs/CURRICULUM_AND_UNLOCKS.md`, `DESIGN_DECISIONS.md`, `crm/roles.ts`) and the phase
boundaries. Every decision below is either inherited from an accepted contract or stated here as a
new bounded decision with its reason.

## 1. What Community is, in one sentence

A place where a learner on the ATA path can ask, answer and reflect **alongside people at a known
point on the same path** — and can tell, without asking anyone, where their question belongs.

It is not a chat wall, not a feed, not a signals channel, and not a second support desk.

## 2. Product boundaries (hard)

| Forbidden | Enforcement |
|---|---|
| profit / P&L / deposit / balance / volume as first-class content | no such field exists in any Community model; author projection carries no financial axis |
| financial-status or performance leaderboard | no ranking surface, no ordering by any learner attribute |
| XP for community activity | no Community write touches `XPTransaction`, `UserLevelProgress` or `User.xp`; held by test |
| Community completing Academy levels | no Community write path reaches the progression owner; held by test |
| legacy `User.level` as V2 authority | V2 access resolver reads `UserCurriculumEnrollment` only; held by test |
| Pocket / affiliate / staff-internal data in Community | author projection is a closed field list; LO notes live in a separate table with no route here |
| DMs, followers, reputation economy, presence, read-state | not modelled, not built |
| arbitrary HTML / markdown from learner input | body is plain text, React-escaped; no renderer added |

## 3. Information architecture

```
/community                          Community Home
  → /community/[spaceCode]          a space: its discussions
      → /community/[spaceCode]/[discussionId]   the thread: discussion + replies
      → create discussion (in-space)
```

Three routes. No fourth level, no nested reply depth (§6), no separate community profile
subsystem (§37).

## 4. Spaces — inherited, not invented

`academy/docs/CURRICULUM_AND_UNLOCKS.md` §5 already fixes the five-space map. It is adopted
unchanged as the space set, and the unlock levels are re-expressed against **V2 curriculum
progression** (`UserCurriculumEnrollment.highestCompletedLevel`) instead of `User.level`.

| code | title | read from | write from | rationale for the level |
|---|---|:---:|:---:|---|
| `channel.start_questions` | Старт и вопросы | **enrolled** | L4 | M1 checkpoint |
| `channel.chart_review` | Разбор графиков | L20 | L20 | M4 checkpoint |
| `channel.discipline_journal` | Дисциплина и дневник | L35 | L35 | M7 checkpoint |
| `channel.strategies` | Стратегии | L45 | L45 | M9 checkpoint |
| `channel.advanced_circle` | Продвинутый круг | L85 | L85 | M17 checkpoint |

### 4.1 The one refinement to the inherited map, and why

The doc gives a single unlock level per space. This phase splits it into **read** and **write**,
and only for the entry space (`start_questions`: read from enrollment, write from L4).

Reason, from live data: in PREPROD the highest learner has completed **14** V2 levels, so under a
single-threshold reading of the map, *every learner sees four locked spaces and one open one*, and
every learner below L4 sees **five locked spaces and nothing else**. Community Home would be a
reachable nav entry that answers "nothing here for you" — a dead end (§55) on the first surface a
new learner meets.

The split keeps the accepted L4 write gate exactly as specified (a fresh registration still cannot
post; the anti-spam intent of the checkpoint gate is untouched) while letting a learner below L4
*read* the space they are about to join. Reading peers' questions is the "peer context" and
"belonging" the product exists for. Spaces 2–5 keep read = write, because showing an L4 learner the
advanced circle would reveal future curriculum context for no product gain (§13).

`Модуль N`-style context is derived from V2 progression; nothing renders XP, rank or a level number
as social status (§11).

## 5. Access model

One server-side owner: `backend/src/lib/community/access.ts`.

```
resolveCommunityAccess(userId) →
  { enrolled, highestCompletedLevel, spaces: [{ code, canRead, canWrite, lockedReason }] }
```

- reads `UserCurriculumEnrollment` for the published curriculum version — never `User.level`;
- a learner with no active enrollment gets `enrolled: false` and read-only Community Home with an
  honest explanation;
- staff with the Community moderation permission read every space (they must be able to see what
  they moderate) and are **not** granted write in a space they could not otherwise write in;
- the Academy never re-derives the rule; it renders `canRead` / `canWrite` / `lockedReason` as given
  (§12 "Do not duplicate gating in frontend").

Denial copy names the real requirement (§13): «Откроется после завершения модуля 4», never
«Недостаточный уровень».

**Legacy is untouched.** `ChatChannel.requiredLevel` and `canAccessChannel` keep reading
`User.level` for `/chat`. No synchronisation, no migration to make numbers agree.

## 6. Content model

- **Discussion**: title (required, 3–140), body (required, 1–4000), space, author, timestamps,
  status, `lastActivityAt`.
- **Reply**: body (1–4000), discussion, author, timestamps, status. Flat — a reply has no parent
  reply.
- **Status**: `visible` | `removed_by_moderator` | `removed_by_author`. Removal is soft: the row
  stays, the body is not returned to a learner, and the position renders as a tombstone so a
  thread never loses its shape and replies are never orphaned (§21).
- **Counts** are read from the canonical rows (`_count`), not from a maintained counter that can
  drift (§42). `lastActivityAt` is a real column written in the same transaction as the reply.

Author editing: **not in V1.** Author deletion: **yes** (`removed_by_author`), because a learner
must be able to withdraw their own words; it is the minimum ownership right, and soft-delete keeps
the audit contract intact.

## 7. Moderation

- Learner reporting: `spam` | `off_topic` | `abuse` | `other`, plus an optional bounded note.
  Reporter identity is never exposed to any learner, and no public report count exists (§19).
- Staff actions: hide (`removed_by_moderator`) and restore. Both Backend-authoritative, both
  appended to `CommunityModerationAction` (§20).
- Authorization: a **new** CRM permission `community_moderate`, granted to `moderator` and
  `crm_admin` only. This is the permission `crm/roles.ts` already names as missing. No hardcoded
  admin email, no `User.role` check, no second staff model.
- Staff surface: **CRM**, next to the Learner Operations queue, reusing `resolveCrmSession` and the
  existing permission gate. Not the V1 `/admin/chat-moderation` page — putting V2 moderation into
  the V1 app would merge the two authority models this phase exists to keep apart.

## 8. Notifications

Two new `NotificationType` values, no second notification surface (§23):

| type | when | to |
|---|---|---|
| `community_reply` | someone replies to your discussion (never self) | discussion author |
| `community_moderation` | your discussion or reply was removed by a moderator | content author |

Both carry `metadata: { spaceCode, discussionId }` so the existing `/notifications` list can link
to the thread. No notification for reading, viewing, or activity in a space.

## 9. Write boundaries (§28)

- validation: bounded title/body, trimmed, non-empty after trim;
- duplicate prevention: an identical (author, target, body) within 60s is refused as a duplicate
  rather than creating a second row — this is what makes a double-submit safe;
- rate limit: reuses the shared `rateLimit()` — discussions 5/10min, replies 15/10min, reports
  10/hour;
- links are **allowed** in text and rendered as plain non-clickable text in V1 (§30: safe
  rendering, no auto-embed, no uncontrolled link directory). The legacy blanket URL refusal is a
  chat rule and is not carried into a learning community.

## 10. Gap matrix

| ID | Capability | Now | Target | Work |
|---|---|---|---|---|
| G-01 | durable discussion persistence | none | `CommunitySpace/Discussion/Reply` | migration 53 |
| G-02 | V2 progression access | `User.level` (broken) | `UserCurriculumEnrollment` | new resolver + tests |
| G-03 | Community Home | none | route + relevance | Academy |
| G-04 | space list / detail | legacy channel list | space + discussions | Backend + Academy |
| G-05 | thread + replies | none | thread route | Backend + Academy |
| G-06 | create discussion | none | validated create flow | Backend + Academy |
| G-07 | reply | flat chat message | reply to discussion | Backend + Academy |
| G-08 | learner reporting | none | 4 reasons, private | Backend + Academy |
| G-09 | staff moderation | V1 `User.role` console | `community_moderate` in CRM | Backend + CRM |
| G-10 | moderation audit | chat-shaped log | `CommunityModerationAction` | migration 53 |
| G-11 | notifications | none | 2 types + linkage | Backend + Academy |
| G-12 | nav reachability | declared, filtered out | `built-routes.ts` + entry | Academy |
| G-13 | empty states | none | honest per-surface | Academy |
| G-14 | loading / error / recovery | none | per-surface | Academy |
| G-15 | mobile 390 | n/a | first-class | Academy |
| G-16 | a11y basics | n/a | headings, labels, focus, dialog | Academy |
| G-17 | ownership enforcement | n/a | server-side | Backend + tests |
| G-18 | XP / progression isolation | n/a | proven absent | tests |

## 11. Explicitly not built in V1

reactions · search · sorting beyond recent-activity · real-time · read state · presence ·
DMs · followers · badges · reputation · community profiles · edit-after-post · nested replies ·
per-space membership records · trending.
