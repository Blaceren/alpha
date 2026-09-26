# Deployment

This project is prepared for normal deployment outside a local machine, while still using SQLite and local disk uploads as the current MVP storage.

For real production, prefer PostgreSQL plus private object storage such as S3, R2, or another compatible provider.

## Build locally

```powershell
npm.cmd ci
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run build
```

## Run production mode locally

Set production-safe env values first:

```powershell
$env:DATABASE_URL="file:./dev.db"
$env:SESSION_SECRET="replace-with-a-long-random-session-secret"
$env:POSTBACK_SECRET="replace-with-a-long-random-postback-secret"
$env:APP_URL="http://127.0.0.1:3009"
$env:STORAGE_DRIVER="local"
$env:LOCAL_UPLOADS_DIR="storage/uploads"
npm.cmd run start -- --port 3009
```

## Health checks

Simple health:

```powershell
Invoke-RestMethod http://127.0.0.1:3009/api/health
```

Readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:3009/api/readiness
```

Expected readiness response:

```json
{
  "ok": true,
  "checks": {
    "database": "ok",
    "storage": "ok",
    "env": "ok"
  }
}
```

If a required production env value is missing, database is unavailable, or storage is misconfigured, `/api/readiness` returns `503` without exposing secret values.

## Pocket postbacks

The Pocket-compatible GET adapter is:

```text
http://57.128.213.204:8080/api/postbacks/pocket
```

Required Pocket URLs are documented in [Pocket postbacks](pocket-postbacks.md). Use a HTTPS domain instead of the raw IP/HTTP address before production.

The existing JSON endpoint remains:

```text
POST /api/exchange/postbacks/receive
```

It still requires `x-postback-secret`.

## Smoke

```powershell
$env:SMOKE_BASE_URL="http://127.0.0.1:3009"
$env:SMOKE_POSTBACK_SECRET=$env:POSTBACK_SECRET
npm.cmd run smoke:integration
```

CI uses:

```powershell
npm.cmd run smoke:ci
```

`smoke:ci` starts `next start`, waits for `/api/health`, waits for `/api/readiness`, then runs the integration smoke.

## Docker

The included `Dockerfile` uses Node 22, `npm ci`, `prisma generate`, `npm run build`, and starts with `npm run start` on port `3000`.

`docker-compose.yml` defines:

- app service
- `.env` env file
- SQLite volume mounted at `/data`
- uploads volume mounted at `/app/storage/uploads`

Example `.env` values for compose:

```env
DATABASE_URL=file:/data/app.db
SESSION_SECRET=replace-with-a-long-random-session-secret
POSTBACK_SECRET=replace-with-a-long-random-postback-secret
APP_URL=http://127.0.0.1:3000
STORAGE_DRIVER=local
LOCAL_UPLOADS_DIR=storage/uploads
```

Run:

```powershell
docker compose up --build
```
