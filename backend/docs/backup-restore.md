# Backup and Restore

The backup scripts support only SQLite `DATABASE_URL` values that start with `file:`.

Backups are written to `backups/`, which is ignored by git.

## Backup

```powershell
npm.cmd run db:backup
npm.cmd run db:backup:verify
```

The script copies the active SQLite DB to:

```text
backups/sqlite-<timestamp>.db
```

## Restore

Restore requires an explicit backup file:

```powershell
npm.cmd run db:restore -- sqlite-2026-06-28T10-00-00-000Z.db
```

Absolute paths are also accepted:

```powershell
npm.cmd run db:restore -- C:\path\to\backup.db
```

Before restore overwrites the active SQLite DB, it copies the current DB to:

```text
backups/pre-restore-<timestamp>.db
```

This keeps restore from deleting current data silently.

Preview a restore without writing:

```powershell
npm.cmd run db:restore -- sqlite-<timestamp>.db --dry-run
```

Relative restore paths must remain inside `backups/`; explicit absolute paths are allowed. Backup and restored files are checked for a valid SQLite header.

Local retention is manual: keep multiple dated backups and periodically copy known-good backups off the application host.

## Production note

SQLite and local disk uploads are suitable for MVP/dev deployments. For real production, use PostgreSQL and private object storage with a tested backup and disaster recovery process.
