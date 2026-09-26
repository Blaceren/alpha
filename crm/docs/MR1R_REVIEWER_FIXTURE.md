# MR-1R reviewer E2E fixture

How the real-backend reviewer suite (`playwright.review.config.ts`, `tests-e2e-review/`) gets its
data, and why it is built the way it is.

## The problem this replaced

The suite originally ran against a single SQLite database that had been built by hand once and then
reused. Its journeys are *terminal decisions* — they approve and reject reports — so one complete
pass turned every seeded report `approved`, and `approved` has no reviewer-facing reverse
transition. The queue rendered «Очередь пуста» and the next run failed on missing data. Nothing in
the repository could rebuild the database, so there was no way to recover except by hand.

Two smaller defects hid behind that one: the pooled-reviewer cursor reset whenever Playwright
restarted its worker after a failure (turning one failure into several rate-limited ones), and the
learner-resubmission helper shelled out to a script in an untracked `tmp/` directory that no longer
existed.

## How it works now

The suite owns its whole fixture. Every run builds a new database, starts a backend against it, and
destroys both at the end.

```
globalSetup  → seed a fresh migration-34 database, start the backend, submit 5 reports
   tests     → read-only observation of THIS run's database
globalTeardown → stop the backend (process group), verify the port is free, remove the run directory
```

### Run layout

```
$MR1R_FIXTURE_DIR/                       default /home/ubuntu/workspaces/.mr1r-fixture
  backend.env                            synthetic secrets, OUTSIDE the repository
  runs/<UTC-timestamp>-<pid>/
    mr1r.sqlite                          this run's database
    manifest.json                        ids this run created
    backend.log
    backend.pid
```

The run directory is published to the workers as `MR1R_RUN_DIR`. Playwright forks workers after
global setup returns, so a worker restarted mid-suite reads the same run.

### Seeding steps

1. `prisma/migrate.ts` from the Backend RR-1 worktree — asserts exactly 34 migrations.
2. `scripts/curriculum/importCurriculumPackage.ts --package …rev3.approved.json` — asserts 43
   published report fields.
3. Authoring the import deliberately leaves undone: publish the curriculum version, author and
   publish the R1–R7 rubric with its `meets`/`revise` scale and two rejection reasons, create the
   `LevelReportBinding`. (Package import cannot author a rubric, and a binding requires an approved
   rubric version.)
4. 61 synthetic identities, all `@fixture.invalid`, with a bcrypt hash of `MR1R_FIXTURE_PASSWORD`.
5. Five report owners enrolled at L3 with L1–L2 completed.
6. Each owner's report submitted **through the Backend's own learner API** (`PUT …/report/draft`
   then `POST …/report/submit`), so revisions, receipts and workflow versions are written by the
   domain rather than hand-built. The seed then asserts 5 `pending_review` rows and zero
   `XPTransaction` rows.

Roughly ten seconds end to end.

### Who owns which report

| Scenario | Owner | Decided by |
|---|---|---|
| Queue rendering (A, B, and the "queue intact" checks in E and G) | `queueAlpha`, `queueBeta` | nobody, ever |
| D → E → F → G | `learnerA` | that chain only |
| H — idempotency | `learnerB` | Journey H only |
| I — two-reviewer race | `learnerC` | Journey I only |

`queueAlpha` and `queueBeta` exist only to be looked at. Because no journey decides them, the
queue-rendering assertions do not depend on what else has already run.

D → E → F → G is a real chain and stays one: proving that a *corrected* revision is approved requires
a revision request first. Each link asserts the state it needs before acting, so a broken chain
reports where it broke instead of timing out in the UI.

### Reviewer identities

The Backend rate-limits login to 5 attempts per 10 minutes per `(ip + email)`, and because the CRM
calls it server-side with no forwarding headers the ip part is the constant `"unknown"` — so the
email is the real key. Each test therefore spends a pooled identity derived from its own title
(`mentorFor`/`adminFor` in `support/review-e2e-config.ts`), not from a shared cursor. Repeated calls
inside one test get consecutive slots, which is what lets Journey I run two genuinely different
reviewers.

## Running it

```bash
export MR1R_FIXTURE_PASSWORD=...        # from the isolated fixture env; never hard-coded
npx playwright test --config=playwright.review.config.ts
```

| Variable | Default | Purpose |
|---|---|---|
| `MR1R_FIXTURE_PASSWORD` | *(required)* | password for every synthetic identity |
| `MR1R_FIXTURE_DIR` | `/home/ubuntu/workspaces/.mr1r-fixture` | fixture root |
| `MR1R_FIXTURE_ENV` | `$MR1R_FIXTURE_DIR/backend.env` | backend env file |
| `MR1R_E2E_CRM_PORT` | `3033` | CRM dev server |
| `MR1R_E2E_BACKEND_PORT` | `3220` | fixture backend |
| `MR1R_KEEP_FIXTURE` | unset | keep the run directory after teardown for investigation |

Live runtime ports (3010, 3020, 3100, 3110) are refused by `FORBIDDEN_PORTS`, and any database path
resolving into `/runtime/ata-dev`, `ata-dev.sqlite` or `ata-prod` is refused outright.

## Invariants worth keeping

- The seeder submits through the real API. If the report payload ever drifts from the curriculum
  package, **seeding** fails loudly rather than a test failing obscurely later.
- Observation is read-only (`sqlite3` opened `mode=ro`). The suite cannot mutate the fixture it is
  measuring.
- Teardown verifies the port is free and throws if it is not, so a leaked listener is a failure
  rather than a surprise for the next run.
- A half-seeded fixture is deleted rather than left for the next run to inherit.
