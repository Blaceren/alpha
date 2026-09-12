# SQL audit fixtures

Inputs for `scripts/regression/sqlAuditRegression.ts`. They are **never executed** and
live under `scripts/`, which is outside the auditor's production scan scope — so the
deliberately unsafe samples here cannot fail the real `npm run security:sql` run.

`safe-*.ts`   must classify as `safe`.
`unsafe-*.ts` must classify as `unsafe` or `unclassified` — i.e. the auditor must reject them.
