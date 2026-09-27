# ATA-PREPROD-LEARNER-OPERATIONS-CRM-END-TO-END-1
# FINAL VERDICT = PASSED

Reviewed against the live PREPROD runtime on 2026-08-16.

## Deployed state

| component | release |
|---|---|
| Backend | `521cbef204354320beae91c470a37ad12da40d37` |
| CRM | `d181d331294c0f818e02b4fe8c9c0e205fb1589c` |
| Academy | `854e46e65388016df4a560d92a45d168457f0aa3` |
| Partner | `68ade7628bcb00193d625d9b5d448bae8e36f55e` |

Migration **52** applied, **0** unfinished. Integrity `ok`, **0** FK violations.
Permission contract **v4**, **25** permissions, digest
`1514e85f02224b31082bac7e596e96a5dec5682df73855224a2e072e53590110` recomputed from the
deployed file; both repository copies byte-identical (`288dd238…`).
All four services active, **0** restarts. Rollback receipts all point to present releases.

**PROD was never touched.**

## Journey and capability status

| area | status |
|---|---|
| Journey A — Support | PASSED |
| Journey B — Report Review | PASSED |
| Journey C — Mentor Review | PASSED |
| Journey D — Educational Escalation | PASSED |
| Complaint / Service Recovery | PASSED |
| QA | PASSED |
| Knowledge | PASSED |
| VOC | PASSED |
| Analytics | PASSED |
| Configuration | PASSED (read-only by design in V1) |
| Learner 360 | PASSED |
| Role model / dual-axis authority | PASSED |
| Public / internal message separation | PASSED |
| Review-work reconciliation | PASSED |
| Data integrity | PASSED |

## The final role matrix, from the server's own predicates

| principal | User.role | StaffRole | report decision | mentor decision | raise escalation | resolve escalation |
|---|---|---|---|---|---|---|
| lo-operator | user | support | REFUSE | REFUSE | ALLOW | REFUSE |
| lo-reviewer | mentor | mentor | **ALLOW** | **ALLOW** | REFUSE | ALLOW |
| lo-admin | user | crm_admin | REFUSE | REFUSE | ALLOW | ALLOW |
| preprod-qa-operator | admin | moderator | REFUSE | REFUSE | REFUSE | REFUSE |

Each negative control is refused for a DIFFERENT reason, which is what makes the intersection
meaningful rather than incidental: lo-operator fails both axes, lo-admin holds both CRM review
permissions and fails the canonical axis, preprod-qa-operator holds platform `admin` and fails
the CRM axis. Proven in the real product, not only by predicate: the CRM administrator opening
the report-review page is told «Ваша учётная запись сотрудника не имеет прав
наставника-проверяющего», and the mentor page «Ваша учётная запись не имеет прав наставника».
No principal was modified at any point.

## Findings

### Product defects found and fixed

| id | severity | root cause | fix | release | evidence | status |
|---|---|---|---|---|---|---|
| LO-UI-CASE-CREATE-1 | HIGH | 4 of 7 case types are staff-originated but the CRM had no create affordance | «Создать кейс», gated on `learner_ops_handle`, 5 anchor-free types, learner search, masked-address marker | 68b443f4 | LO-000005 created in-browser, 201, count 4→5 | CLOSED |
| LO-360-PROGRESS-DENOMINATOR-1 | MEDIUM | denominator was `progress.length`, so a learner who started nothing showed «0 из 0» | `levelDefinition.count()` per enrolment version, plus separate `startedLevels` | 68b443f4 | «0 из 100 уровней» live; 3 regressions proven RED | CLOSED |
| LO-ACADEMY-SUPPORT-UNREACHABLE-1 | HIGH | two copied `BUILT_ROUTES` sets and a disabled «Ещё» meant `/support` shipped but could not be reached | shared `config/built-routes.ts`; both bars derive from `PRIMARY_NAV` | 854e46e6 | learner reached /support in-browser | CLOSED |
| LO-SLA-WAITING-RESUME-1 | HIGH | clock stayed paused after a learner reply, understating ATA's delay in the flattering direction | learner message on `waiting_learner` returns the case to `in_progress` in the same transaction | e8972172 | regression proven RED; live pause/resume | CLOSED |
| LO-UI-TRANSITION-CHOICES-1 | MEDIUM | CRM rendered a hardcoded status list, offering transitions the server answered 400 to | server projects `LEARNER_OPS_TRANSITIONS[status]` as `allowedTransitions`; UI renders that | 835e1b9 / e7f5a5c | resolved case offers exactly `open`,`closed`; 4 forged transitions → 400 | CLOSED |
| LO-ESCALATION-RESOLVE-AUTHORITY-1 | HIGH | one permission gated both raising and answering an escalation, so the mentor it was addressed to could not answer while the frontline that raised it could self-close | contract v3→v4: new `learner_ops_escalation_resolve` for mentor/crm_admin/crm_manager, NOT support; plus the terminal-state invariant | 34165879 / 4c30a5a1 | live 403 before, resolved by the mentor after; progression untouched | CLOSED |
| LO-REVIEW-WORKITEM-UNREACHABLE-1 | HIGH | `report_review` and `mentor_review` had anchors and queues but nothing could create one — two of seven types unreachable | canonical owners open and reconcile the derived work item inside their own transaction; migration 52 adds anchor uniqueness | 37c8b085 / 94ebaa69 | LO-000007 reconciled, LO-000008 and LO-000009 auto-created live | CLOSED |
| LO-MENTOR-SURFACE-ANCHOR-1 | MEDIUM | mentor review surface did not name its operational case, unlike the report surface | `listMentorReviewQueue` projects the anchored case; row renders reference, owner and boundary | 521cbef / d181d33 | see the verification gap below | DEPLOYED, documented gap |

### Verification gap carried forward

**LO-MENTOR-SURFACE-ANCHOR-1** — MEDIUM, implementation deployed, regression covers both the
present and the absent case, live empty state verified, live completed-object reverse link
verified (`LO-000009` → `curriculum.progression / Прогресс #74`). The active pending-row
click-through was **not reproduced**, because no legitimate pending mentor review remained:
Journey C's L14 is completed, `approveMentorReview` has no path back by design, and the next
mentor-review level is fourteen levels away. Product state was NOT manufactured to turn this
green. **This is not fully browser-proven and is not reported as such.** Accepted as a
documented non-blocking verification gap for V1.

### Process finding

| id | severity | outcome |
|---|---|---|
| LO-ENV-HANDLING-1 | process | `env $(cat backend.env | xargs)` exposes secrets in `ps` and word-splits values; the canonical form is `systemd-run --property=EnvironmentFile=`, used for every ops invocation since | CLOSED |

### Non-blocking product item

| id | severity | status |
|---|---|---|
| LO-ACADEMY-SUPPORT-LAYOUT-1 | LOW | Accepted visual polish. The support page ignores the app content container. No Academy release was otherwise required, so none was spent on it. |

### Infrastructure / release observations — NOT product defects

| id | class | evidence | disposition |
|---|---|---|---|
| DISK-HEADROOM-1 | environment | root at 99%; 9 stale backend releases reclaimed under explicit authorization | RESOLVED |
| DISK-HEADROOM-1a | environment | a reference scan omitted `/srv/ata-data/access-control/`; self-caught, bounded, self-healed | RESOLVED |
| DISK-HEADROOM-2 | environment | publisher refused at 2.5 GiB; 3 authorized deletions, 2 sufficed | RESOLVED |
| DISK-HEADROOM-3 | environment | publisher refused at 2.9 GiB; 5 authorized deletions, all 5 required to cross 8 GiB | RESOLVED |
| ROLLBACK-ANCHOR-DRIFT-1 | infrastructure | the cutover receipt advances on every cutover; `/srv/ata/previous/backend` has not moved from `4208e719` across seven | CARRY FORWARD — evidence only, not repaired |
| RELEASE-WORKTREE-COUPLING-1 | infrastructure | `/srv/ata/worktrees/g2-assessment-binding-fix/node_modules` symlinks into release `d12ab14c`, making a release load-bearing for something outside the release system | CARRY FORWARD — evidence only, not repaired |

Both infrastructure notes belong to the ATA Storage / Release Hygiene Audit, which was NOT
started.

## Hard gates

* **0 BLOCKER, 0 HIGH.**
* Support, report and mentor work all reach the unified queue; the latter two arrive
  automatically from the canonical owners.
* Educational escalation can be raised by the frontline and answered only by a qualified
  authority.
* Internal notes never reached a learner: six canaries, zero hits across learner APIs, DOM
  and every notification's title, message and metadata.
* Operational case status alone cannot complete Academy progression — refused with
  `LEARNER_OPS_CANONICAL_REVIEW_OPEN` and withheld from the projection.
* Report progression is owned by the report-review owner; mentor progression by
  `approveMentorReview`. Each completed exactly once, with XP minted once.
* Learner 360 values all name their canonical source.
* **No false financial claims.** For learner 73, L4/$50 and L10/$100 remain curriculum
  thresholds satisfied by `staging_attested_checkpoint`; the money surface, read by the one
  principal allowed to see it, reports `firstDepositConfirmed: false`,
  `firstDepositEvidence: "none"`, `checkpoints: []`, Pocket `pending`. Zero fabricated
  balance, deposit, DEP/RDEP, P&L, trade history or provider callback anywhere.
* Migration 52 clean; every release currently referenced exists on disk.
