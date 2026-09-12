# Quickstart

## 1. Create env

```powershell
Copy-Item .env.example .env
```

For local testing, keep:

```env
DATABASE_URL="file:./dev.db"
STORAGE_DRIVER=local
LOCAL_UPLOADS_DIR=storage/uploads
```

Use non-production demo secrets locally. Do not commit real secrets.

## 2. Install dependencies

```powershell
npm.cmd ci
```

If `node_modules` already exists and you are iterating locally, `npm.cmd install` is also fine.

## 3. Prepare database

```powershell
npm.cmd run setup:local
```

This runs Prisma generate, migrations, and seed.

## 4. Run dev

```powershell
npm.cmd run dev
```

Open:

- http://127.0.0.1:3000
- http://127.0.0.1:3000/login

## 5. Production-style local check

```powershell
npm.cmd run build
npm.cmd run start -- --port 3009
```

Check:

- http://127.0.0.1:3009/api/health
- http://127.0.0.1:3009/api/readiness

## 6. Smoke

```powershell
$env:SMOKE_BASE_URL="http://127.0.0.1:3009"
npm.cmd run smoke:integration
npm.cmd run smoke:mvp
```

Or run the full RC helper:

```powershell
npm.cmd run verify:rc
```
