# ATA production deployment on AWS

Runbook for deploying **backend**, **academy** and **crm** to a single EC2
instance with SQLite on an attached EBS volume.

Everything here is executed **on the instance**, except step 0. Reach the box
with **SSM Session Manager**, not SSH — the security group opens no port 22.

---

## Architecture

```
                  Route 53
          ┌───────────────┼───────────────┐
    academy.<dom>    api.<dom>       crm.<dom>
          └───────────────┼───────────────┘
                     Elastic IP
                          │
                  EC2 t3.medium (Ubuntu 24.04)
                   nginx :443  (Let's Encrypt)
      ┌───────────────────┼───────────────────┐
 academy :3120       backend :3110        crm :3130
                          │
                 /srv/ata-data   (EBS #2, separate volume)
                   ├── db/app.db
                   └── uploads/
```

**Academy and CRM reach the backend over loopback**, not through the public
`api.` hostname. Both origin validators require `https://` for a non-loopback
host but accept plain `http` for `127.0.0.1`, so loopback keeps that traffic off
the network entirely and avoids a pointless TLS round trip into the same machine.

`api.<dom>` is public for exactly two reasons: Pocket's postback callbacks, and
the backend's own admin UI.

### Why one instance

The Prisma provider is `sqlite` and uploads go to local disk. That means one
node, no autoscaling, and a short outage on deploy. Moving to multiple instances
requires migrating the provider to Postgres and regenerating 52 migrations — a
separate project, not a config change.

---

## Layout on the instance

| Path | What |
|---|---|
| `/home/ubuntu/learner-ops-v1` | source checkout (this repo) |
| `/srv/ata/config/*.env` | secrets, `root:ata`, mode `0640` |
| `/srv/ata/releases/<app>/<commit>` | immutable built releases |
| `/srv/ata/current/<app>` | symlink → the live release |
| `/srv/ata-data/db/app.db` | the database (separate EBS volume) |
| `/srv/ata-data/uploads/` | report attachments |
| `/srv/ata-data/backups/` | local backup copies |

The checkout path is **not arbitrary** — `tools/build-release.sh` hardcodes it.

---

## Step 0 — AWS resources (from your workstation)

Region: whichever is closest to your learners.

- **EC2** `t3.medium` (2 vCPU / 4 GB), Ubuntu 24.04 LTS, `gp3` root 30 GB.
  4 GB is driven by **builds**, not by runtime: three Next servers idle well
  under 1 GB combined, but a single `next build` can take 2–3 GB.
- **Second EBS volume**, `gp3`, 20 GB — attached, not yet formatted.
  Separate on purpose: the instance can be replaced without touching the data,
  and snapshots of it are clean.
- **Elastic IP**, associated.
- **Security group**: inbound `80` and `443` from `0.0.0.0/0`. **No port 22.**
- **IAM instance role**: `AmazonSSMManagedInstanceCore`, plus `s3:PutObject` on
  the backup bucket.
- **S3 bucket** for backups — block public access on, versioning on, lifecycle
  rule for expiry.
- **Route 53**: `A` records for `api.`, `academy.`, `crm.` → the Elastic IP.

DNS must resolve **before** step 5, or certificate issuance fails.

---

## Step 1 — Bootstrap the instance

```bash
sudo bash deploy/aws/bootstrap.sh \
  --domain example.com \
  --timezone Europe/Kyiv \
  --data-device /dev/nvme1n1 --format-data-volume
```

Idempotent — safe to re-run. Drop `--format-data-volume` on every later run;
it exists so an empty disk is never erased without someone saying so.

Installs **Node 22.14.0 exactly**, from the official tarball with a checksum
check. Not NodeSource, and not "latest 22.x": all three apps set
`engine-strict=true` alongside `engines.node: "22.14.x"`, so npm **refuses** to
install on 22.20 and the failure (`EBADENGINE`) is not obvious from the message.

Then clone the repo:

```bash
git clone <url> /home/ubuntu/learner-ops-v1
```

---

## Step 2 — Environment files

Copy each template, fill in every `__PLACEHOLDER__`:

```bash
sudo cp deploy/aws/env/backend.env.template /srv/ata/config/backend.env
sudo cp deploy/aws/env/academy.env.template /srv/ata/config/academy.env
sudo cp deploy/aws/env/crm.env.template     /srv/ata/config/crm.env
sudo chown root:ata /srv/ata/config/*.env && sudo chmod 0640 /srv/ata/config/*.env
```

Generate the secrets:

```bash
openssl rand -base64 48   # SESSION_SECRET
```

The templates carry the rules inline. Three worth repeating:

- **`ATA_ENVIRONMENT=production`** is a separate axis from `NODE_ENV`, because
  this project serves a production *build* everywhere — `NODE_ENV` cannot
  classify a host. Absent or misspelled fails startup, deliberately.
- **`CAPTCHA_LOGIN_ENFORCED=true`** is mandatory outside `dev`. Without it the
  backend does not boot.
- **`TURNSTILE_EXPECTED_ACTION` must not be set.** It is retired, and its mere
  presence is a hard startup failure. It is still in `backend/.env.example`,
  which is a dev template and stale on this point — don't copy from it.

### Do not use `backend/.env.example` as the source

It also still lists `CAPTCHA_DEV_BYPASS`, which has been removed from the
contract entirely. Setting it grants nothing.

---

## Step 3 — Database

Run from the **source checkout**, not from a release. Releases are pruned with
`npm prune --omit=dev`, which removes `tsx` and `prisma`.

```bash
cd /home/ubuntu/learner-ops-v1/backend
npm ci
set -a && . /srv/ata/config/backend.env && set +a
npx prisma generate
npm run prisma:migrate          # NOT `prisma migrate deploy`
```

`prisma:migrate` runs `backend/prisma/migrate.ts`, a custom runner. It handles
`PRAGMA foreign_keys=OFF` hoisting that plain `migrate deploy` gets wrong — one
migration was silently mis-applied that way before.

**Do not seed.** `ALLOW_PRODUCTION_SEED=false` blocks it, by design. Create the
first admin account as a deliberate, separate act.

```bash
sudo chown -R ata:ata /srv/ata-data/db
```

---

## Step 4 — Build and release

One at a time. Three concurrent builds will OOM the instance.

```bash
sudo bash deploy/aws/build.sh backend
sudo bash deploy/aws/build.sh academy
sudo bash deploy/aws/build.sh crm
```

First release only — create the symlinks by hand, because cutover refuses to
operate on anything that is not already a symlink to an existing release:

```bash
sudo ln -s /srv/ata/releases/backend/<commit> /srv/ata/current/backend
sudo ln -s /srv/ata/releases/academy/<commit> /srv/ata/current/academy
sudo ln -s /srv/ata/releases/crm/<commit>     /srv/ata/current/crm
```

Every release after that:

```bash
sudo bash deploy/aws/cutover.sh <app> <commit> <build-id>
```

---

## Step 5 — Certificates and go live

```bash
sudo systemctl start nginx
for s in api academy crm; do
  sudo certbot certonly --webroot -w /var/www/certbot -d $s.example.com
done

for s in api academy crm; do
  sudo ln -sf /etc/nginx/sites-available/ata-$s.conf /etc/nginx/sites-enabled/
done
sudo nginx -t && sudo systemctl reload nginx

sudo systemctl enable --now ata-prod-backend ata-prod-academy ata-prod-crm
sudo systemctl enable --now ata-db-backup.timer
```

Sites are enabled only *after* issuance because their TLS blocks reference
certificate paths that do not exist until then — nginx will not load otherwise.

---

## Verification

```bash
systemctl status ata-prod-backend ata-prod-academy ata-prod-crm
curl -fsS https://api.example.com/api/health
```

1. **Academy loads**, and in DevTools **no request goes directly to the
   backend** — the browser must only ever hit same-origin `/api/backend/*`.
   That is the fastest signal `ACADEMY_MODE` is right.
2. **CRM loads and its lists populate.** 404s on CRM API calls mean the build
   did not have `CRM_BACKEND_ORIGIN` — rebuild, don't patch the env and restart.
3. **Image endpoint is closed** (see below):
   ```bash
   curl -o /dev/null -w '%{http_code}\n' \
     'https://academy.example.com/_next/image?url=/x&w=64&q=75'   # expect 404
   ```
4. **Registration end to end.** This exercises Turnstile. Without
   `TURNSTILE_SITE_KEY` the site serves fine but the form blocks submission —
   it looks like a product bug, not a config error.
5. **Backups round-trip.** A backup never restored is not a backup:
   ```bash
   sudo systemctl start ata-db-backup.service
   journalctl -u ata-db-backup -n 20 --no-pager
   # then actually restore one into a scratch file and open it
   ```
6. **Reboot the instance.** All three units must come back on their own and
   `/srv/ata-data` must mount from `fstab`.

### Before enabling Pocket

Send a request with a **dummy** value — never the real secret — and prove it is
absent from the logs:

```bash
curl -si 'https://api.example.com/api/postbacks/pocket?goal=reg&ow=DUMMYNOTTHESECRET'
grep -c DUMMYNOTTHESECRET /var/log/nginx/ata-postback.log   # expect 0
grep -c DUMMYNOTTHESECRET /var/log/nginx/api.access.log     # expect 0
grep -c '/api/postbacks/pocket' /var/log/nginx/ata-postback.log  # expect 1
```

The last line matters as much as the first two: it proves the sanitised format
did not become a silent hole instead of a fix.

Pocket sends its shared secret as the `ow` **query parameter**, and nginx's
default `combined` format logs the full request line. Without the dedicated
location block, the first authentic callback writes a live credential to disk in
plaintext. Rotating a secret that has already been logged costs more than not
logging it.

---

## Security posture

### Mitigated here, at nginx

`GHSA-2xp9-vwfh-vxw4` — unauthenticated RCE in the Next.js Image Optimization
API (AVIF path), unfixed in the pinned versions. `/_next/image` returns 404 on
all three sites.

This is safe because **`next/image` is imported in zero source files** across
all three apps — the only matches for the string are middleware matcher
exclusions and one comment. Nothing renders through it.

`X-Powered-By` is stripped via `proxy_hide_header` rather than by editing
`next.config.ts`, so no application code changes.

The other critical advisory, `GHSA-p293-qw3h-jr36`, affects **Windows-hosted**
servers only and does not apply on Linux.

### Not mitigated — real, and outstanding

- **`npm audit` on backend: 1 critical + 9 high.** The nginx block closes the
  practically reachable vector; it is a mitigation, not a fix. A Next.js upgrade
  with a regression pass is still required.
- **CSP contains `script-src 'unsafe-inline'`** (`backend/src/middleware.ts`).
  Any HTML injection becomes executable XSS. The fix is a per-request nonce.
  Already tracked as known debt in the code's own comments.
- **CSP is missing `form-action` and `base-uri`.** Neither falls back to
  `default-src`, so forms can post cross-origin. One-line fix, same file.

nginx deliberately adds **no** `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `CSP` or `X-Frame-Options` on normal routes: both backend
and academy already set them. Duplicating a CSP header makes browsers intersect
the two policies, producing something stricter than either app intends and
breaking pages in ways that are hard to trace. The one exception is
`/_next/static/`, where the apps' matchers exclude themselves and so set nothing.

---

## Known divergences from the vendored tooling

**`tools/` assumes a different repository topology** — three separate git
repositories at `/home/ubuntu/learner-ops-v1/<component>`. This project is one
monorepo with the apps as subdirectories.

- `build-release.sh` asserts `[ -d "$SRC/.git" ]` and dies immediately.
- `publish-release.sh` verifies against `git ls-tree -r $COMMIT`, which here
  enumerates all three apps plus `tools/` and `_phase/` — it cannot match one
  component's release directory.

So `deploy/aws/build.sh` replaces that pipeline, and `deploy/aws/cutover.sh` is
a derivative of `tools/cutover.sh` (which is topology-independent) with the unit
prefix parameterised. `tools/` is left byte-identical to upstream so the
checksums in `ATA_TOOLING_INSTALLED.json` stay true.

**What is given up:** the artifact→source provenance record that
`build-release.sh` writes into `.next`. `build.sh` keeps the clean-tree check,
so a release still corresponds to exactly one commit — but it cannot prove after
the fact that a given `.next` came from it. Restoring that means either
splitting the repository or reworking the publisher's tree verification.

**`partner` is missing.** Both `tools/*.sh` and `_phase/FINAL-VERDICT.md`
reference a fourth component (affiliate portal, deployed release `68ade762…`)
whose sources are not in this repository. If it is needed in production, find
them separately.

**The backup script is ours, not the repo's.** `backend/scripts/backup/
backupSqlite.ts` does `fs.copyFile` on a live database and verifies only the
16-byte header — which a torn copy still has — so it can report success over a
corrupt backup. It also runs through `tsx` and imports `dotenv/config`, and
`tsx`, `prisma` and `dotenv` (not even a declared dependency) are all removed by
`npm prune --omit=dev`. `ata-db-backup.sh` uses `sqlite3 .backup`, SQLite's
online backup API, then `PRAGMA integrity_check` on the result.

---

## Operations

```bash
journalctl -u ata-prod-backend -f
systemctl restart ata-prod-academy
sudo bash deploy/aws/cutover.sh backend <prev-commit> <prev-build-id>   # rollback
cat /srv/ata-data/access-control/.cutover-rollback-backend              # rollback point
```

**Set a CloudWatch alarm on free disk space.** SQLite on a full disk is
database corruption, not a tidy write error.
