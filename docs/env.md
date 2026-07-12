# Environment

Runtime validation lives in `src/lib/env.ts`.

The build is allowed to run without production secrets. Strict validation happens at runtime, especially in production and in `/api/readiness`.

## Required in production

- `DATABASE_URL`
- `SESSION_SECRET`
- `POSTBACK_SECRET`
- `APP_URL`
- `STORAGE_DRIVER`

## Optional

- `LOCAL_UPLOADS_DIR`
- `NODE_ENV`
- `SMOKE_BASE_URL`
- `VISUAL_QA_BASE_URL`
- `EMAIL_VERIFICATION_REQUIRED`
- `CAPTCHA_DEV_BYPASS`
- `ALLOW_PRODUCTION_SEED`
- `ALLOW_PRODUCTION_BETA_RESET`
- `BETA_RESET_CONFIRM`
- `POCKET_POSTBACK_REQUIRE_SECRET`

## Local defaults

Local development may use:

```env
DATABASE_URL="file:./dev.db"
POSTBACK_SECRET=dev-postback-secret
POCKET_POSTBACK_REQUIRE_SECRET=false
STORAGE_DRIVER=local
LOCAL_UPLOADS_DIR=storage/uploads
```

`SESSION_SECRET` falls back to `local-dev-session-secret` outside production.
`POSTBACK_SECRET` falls back to `dev-postback-secret` outside production.

Those fallback values are rejected when `NODE_ENV=production`.

Closed beta without real providers uses `EMAIL_VERIFICATION_REQUIRED=false` and `CAPTCHA_DEV_BYPASS=true`. If captcha bypass is disabled, the dev token is rejected; no real captcha provider is claimed. Production beta reset is refused unless both `ALLOW_PRODUCTION_BETA_RESET=true` and `BETA_RESET_CONFIRM=RESET_BETA_DATA` are explicitly set.

`POCKET_POSTBACK_REQUIRE_SECRET=false` keeps the Pocket GET adapter in no-secret known-clickid-only mode. `POCKET_POSTBACK_REQUIRE_SECRET=true` requires `POSTBACK_SECRET` through `ow`, `secret`, `token`, or the `x-postback-secret` header. See [Pocket postbacks](pocket-postbacks.md).

Never use `dev-postback-secret` for a production listener. `VISUAL_QA_BASE_URL` normally points to `http://127.0.0.1:3009` during local QA.

## Production notes

Use strong unique values for:

- `SESSION_SECRET`
- `POSTBACK_SECRET`

Set:

```env
APP_URL=https://your-domain.example
STORAGE_DRIVER=local
DATABASE_URL=file:/data/app.db
LOCAL_UPLOADS_DIR=storage/uploads
```

`STORAGE_DRIVER=s3` and `STORAGE_DRIVER=r2` are reserved for future adapters. They currently fail readiness with a clear error instead of silently pretending object storage is configured.
