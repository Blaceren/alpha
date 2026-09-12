# D3-D — Approved Report Experience

The terminal `approved` verdict for the level-3 report and how it projects onto progression. Reuses
the Evidence Ledger (DD-271) and the Revision Pass language (DD-289); no new art direction.

Related: [D3_REPORT_EXPERIENCE.md](D3_REPORT_EXPERIENCE.md),
[D3_REVISION_EXPERIENCE.md](D3_REVISION_EXPERIENCE.md),
[REPORT_STATE_MACHINE.md](REPORT_STATE_MACHINE.md), [REPORT_STORAGE.md](REPORT_STORAGE.md).

## The honest boundary (DD-299)

A structurally valid `approved` in this browser's `localStorage` is a **provisional frontend
prototype state**, not an authenticated verdict. The frontend cannot cryptographically prove where a
`localStorage` value came from and does not pretend to — no signature, token or hash is added,
because the same client that would mint one also verifies it (that is not a security boundary).
Malformed / unsupported / inconsistent approved records **fail closed**. A real authoritative mentor
verdict will require a backend; until then `dev/test · provisional` stays visible in the approval
context.

## The mandatory architectural boundary (DD-300)

Two different `completed` cases must never be conflated. The experience layer computes:

- **base availability** — from the canonical marker + the ordinary lesson session, **before** any
  report augmentation. `resolveRouteAvailability(3, marker, session)`.
- **effective availability** — after folding this report's approval into the session (through the
  shared `sessionWithApprovedReports` helper).

| Case | Condition | Presentation |
|------|-----------|--------------|
| **Canonical completion** | base availability of L3 already `completed` (Артём on L18) | neutral archive; local report status does not rename the level; **no** «Одобрено»; **no** approved CTA; `currentLevel = 18` unchanged |
| **Approval-induced completion** | base was current/available, status `approved`, effective became `completed` after augmentation | approved archive; «Одобрено»; ledger read-only; next step → `/path` |

`approval-induced ⇔ baseAvailability !== "completed" && status === "approved"`. It is deliberately
**not** decided by the final `availability === "completed"` alone — that is insufficient, since both
cases end at `completed`.

## Lifecycle (DD-297)

```
draft → pending-review → approved            (first pass)
revision-requested → …resubmit… → pending-review → approved   (after a revision)
```

`approved` is **terminal**:

- fields are read-only by construction — `withEntryFieldV3` / `withSummaryV3` return the same object;
- resubmit is impossible; the revision adapter does not apply; a second approval is a no-op;
- the last `review` is preserved as history; `approvedAt` is stored but never rendered;
- XP does not change.

## Progression augmentation (DD-297)

Completion is **derived** from the report workspace — `ata.lesson-progress.v1` is never written.

- `approvedReportLevelNumbers(workspace)` — the report levels whose stored draft is `approved`.
- `sessionWithApprovedReports(session, workspace)` — folds each through the canonical
  `withCompletedLevel`, which records the completion **and** opens the successor in the session's
  `unlocked` set.

The existing `resolveRouteAvailability` then reports L3 completed and L4 open — no second store, no
second route resolver, no hardcoded «after approved open L4». Additive and idempotent; a no-op under
the canonical profile. Wired into the report route/experience, Lessons Library and Path — **not**
Home.

## The approved screen

- calm `Одобрено` chip (success family; green is reserved for saving / readiness / the successful
  action, DD-284) and the line **«Отчёт принят. Уровень 3 завершён.»**;
- a browser-local / provisional explanation, no promise of a server check;
- the Evidence Ledger, entirely read-only;
- if a `review` exists: a quiet **«Комментарий последней проверки»** block — no jump links, no
  attention edges, no pass counter;
- next step: **«Уровень 4 · Контрольная точка»**, **«Требуется: Баланс Pocket от $50»** (target
  only);
- primary CTA **«Посмотреть Путь» → `/path`**; secondary **«К списку уроков» → `/lessons`**.

**Never shown:** current Pocket balance, the deposited amount, a remainder, a progress percentage, a
Pocket CTA/link, XP, mentor identity/avatar, a countdown, a celebration hero, confetti, a large green
surface, a right-hand dashboard card, a rubric/score/grade. `approvedAt` is stored, never displayed.

## The verdict adapter (DD-298)

`ReportVerdictAdapter = "revision-requested" | "approved"`. The resolver is **exact match**; every
unknown value — including `rejected`, `auto-approved`, `mentor-approved` — fails closed to null.

`?verdict=approved` applies **only** when all hold: `scenario === "report"`, status
`pending-review`, the report is ready, and the verdict is not yet applied (a resubmitted
pending-review that still carries a review is eligible). The adapter writes only workspace v3, never
`ata.lesson-progress.v1`, creates no mentor identity or new feedback, keeps the existing review as
history, and stamps `approvedAt` via the deterministic clock adapter. On a storage-write failure it
**leaves the report pending** (no fabricated success); a repeated `?verdict=approved` on an approved
report is a no-op, as is one on a draft/revision-requested or without `?scenario=report`.

No user-facing href carries `scenario` or `verdict`; there is no user «Одобрить» button; nothing is
approved automatically.

## Library & Path (DD-293)

After an approval-induced completion:

- **Library:** the effective current step advances from L3 to L4; L3 reads **«Завершён ·
  Пересмотреть»** (never «Одобрено»); no revision/pending label on the completed L3; L4 is the
  checkpoint next step; the continue area says **«Следующий шаг — контрольная точка · Уровень 4.»**;
  no `href` to the unbuilt `/lessons/level.004`; no Pocket CTA.
- **Path:** L3 = completed (its local report label hidden by the `completed` rule); L4 = current via
  the real resolver; the L4 detail shows only the `$50` checkpoint requirement — no balance /
  progress / Pocket CTA, no special «after approved open 4» hardcode.

Under the canonical profile both surfaces are unchanged: L3 stays completed, L4 stays long-passed,
the local approved renames nothing, no approved banners appear.
