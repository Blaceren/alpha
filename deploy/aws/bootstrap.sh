#!/usr/bin/env bash
#
# ATA production bootstrap — prepares a fresh Ubuntu 24.04 EC2 instance.
#
# Run as root on the instance (reach it with SSM Session Manager, not SSH):
#   sudo bash deploy/aws/bootstrap.sh --domain example.com --timezone Europe/Kyiv
#
# IDEMPOTENT. Safe to re-run: every step checks its own postcondition first.
#
# It deliberately does NOT: format a disk that already has a filesystem, write
# any secret, obtain certificates, build the apps, or start the services. Those
# are separate, explicit steps — see deploy/aws/README.md.

set -euo pipefail

die() { printf '\nREFUSING: %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }

NODE_VERSION="22.14.0"   # pinned exactly — see the engine-strict note below
REPO_DIR="/home/ubuntu/learner-ops-v1"
DOMAIN=""
TIMEZONE=""
DATA_DEVICE=""
FORMAT_DATA_VOLUME="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN="${2:?}"; shift 2 ;;
    --timezone) TIMEZONE="${2:?}"; shift 2 ;;
    --data-device) DATA_DEVICE="${2:?}"; shift 2 ;;
    --format-data-volume) FORMAT_DATA_VOLUME="yes"; shift ;;
    *) die "unknown argument '$1'" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ -n "$DOMAIN" ] || die "--domain is required (e.g. --domain example.com)"
[ -n "$TIMEZONE" ] || die "--timezone is required (e.g. --timezone Europe/Kyiv)"
grep -q 'VERSION_ID="24.04"' /etc/os-release || note "WARNING: not Ubuntu 24.04 — continuing, but untested"

# ---------------------------------------------------------------------------
step "1/9  System packages"
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# openssl: Prisma's query engine links against it.
# build-essential + python3: better-sqlite3 is a native module and may need to
#   compile if no prebuilt binary matches this platform.
# xz-utils: to unpack the Node tarball.
apt-get install -y -qq --no-install-recommends \
  nginx certbot python3-certbot-nginx \
  git curl ca-certificates openssl xz-utils \
  build-essential python3 \
  unzip jq \
  sqlite3
note "installed"

timedatectl set-timezone "$TIMEZONE"
note "timezone: $TIMEZONE"

# ---------------------------------------------------------------------------
step "2/9  Node ${NODE_VERSION} (exact pin)"
# ---------------------------------------------------------------------------
# NOT NodeSource, and not "latest 22.x", ON PURPOSE.
#
# All three apps set `engine-strict=true` in .npmrc AND `engines.node: "22.14.x"`
# in package.json. Together those make npm REFUSE to install on any other
# version — including 22.20. A NodeSource install would therefore produce a box
# where `npm ci` fails with EBADENGINE and the cause is non-obvious.
if [ "$(/usr/local/bin/node --version 2>/dev/null || echo none)" = "v${NODE_VERSION}" ]; then
  note "already installed"
else
  TMP="$(mktemp -d)"
  ARCH="$(dpkg --print-architecture)"
  case "$ARCH" in
    amd64) NODE_ARCH="x64" ;;
    arm64) NODE_ARCH="arm64" ;;
    *) die "unsupported architecture '$ARCH'" ;;
  esac
  TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"

  curl -fsSL -o "$TMP/$TARBALL" "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"
  curl -fsSL -o "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  # Verify before unpacking anything into /usr/local.
  ( cd "$TMP" && grep " ${TARBALL}\$" SHASUMS256.txt | sha256sum -c - ) \
    || die "Node tarball checksum mismatch — refusing to install"

  tar -xJf "$TMP/$TARBALL" -C /usr/local --strip-components=1 \
      --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
  rm -rf "$TMP"
  note "installed $(/usr/local/bin/node --version)"
fi

# ---------------------------------------------------------------------------
step "3/9  Service account"
# ---------------------------------------------------------------------------
if id ata >/dev/null 2>&1; then
  note "user 'ata' exists"
else
  # No login shell, no home directory to speak of: this account exists only to
  # own the running processes and the data.
  useradd --system --no-create-home --shell /usr/sbin/nologin ata
  note "created system user 'ata'"
fi

# ---------------------------------------------------------------------------
step "4/9  Data volume  ->  /srv/ata-data"
# ---------------------------------------------------------------------------
# This is the only destructive step in the script, so it is the most defensive.
mkdir -p /srv/ata-data

if mountpoint -q /srv/ata-data; then
  note "already mounted: $(findmnt -n -o SOURCE /srv/ata-data)"
else
  if [ -z "$DATA_DEVICE" ]; then
    # On Nitro instances the root volume is nvme0n1; a single extra volume is
    # typically nvme1n1. Detect rather than assume, and refuse if ambiguous.
    CANDIDATES="$(lsblk -dpno NAME,TYPE | awk '$2=="disk"{print $1}' | grep -v 'nvme0n1' || true)"
    COUNT="$(printf '%s\n' "$CANDIDATES" | grep -c . || true)"
    [ "$COUNT" -eq 1 ] || die "found $COUNT candidate data disks; pass --data-device explicitly. Candidates: ${CANDIDATES:-none}"
    DATA_DEVICE="$(printf '%s\n' "$CANDIDATES" | head -1)"
  fi
  [ -b "$DATA_DEVICE" ] || die "$DATA_DEVICE is not a block device"

  EXISTING_FS="$(blkid -o value -s TYPE "$DATA_DEVICE" 2>/dev/null || true)"
  if [ -n "$EXISTING_FS" ]; then
    note "$DATA_DEVICE already carries a $EXISTING_FS filesystem — mounting, NOT formatting"
  else
    # An empty device on a re-run is far more likely to be "someone attached the
    # wrong volume" than "please erase this". Require the operator to say so.
    [ "$FORMAT_DATA_VOLUME" = "yes" ] \
      || die "$DATA_DEVICE has no filesystem. Re-run with --format-data-volume if you are certain this disk is empty and may be erased."
    mkfs.ext4 -L ata-data "$DATA_DEVICE"
    note "formatted $DATA_DEVICE as ext4"
  fi

  UUID="$(blkid -o value -s UUID "$DATA_DEVICE")"
  [ -n "$UUID" ] || die "could not read UUID of $DATA_DEVICE"
  # By UUID, never by device name: Nitro can enumerate devices in a different
  # order across reboots, and a wrong /dev/nvmeXn1 in fstab means the database
  # comes back on the wrong disk, or not at all.
  if ! grep -q "UUID=$UUID" /etc/fstab; then
    printf 'UUID=%s /srv/ata-data ext4 defaults,noatime,nofail 0 2\n' "$UUID" >> /etc/fstab
    note "added to /etc/fstab by UUID"
  fi
  mount /srv/ata-data
  note "mounted $DATA_DEVICE -> /srv/ata-data"
fi

# ---------------------------------------------------------------------------
step "5/9  Directory layout"
# ---------------------------------------------------------------------------
# These paths match what tools/cutover.sh expects. Do not rename them without
# also changing that script — it refuses to operate on anything else.
mkdir -p /srv/ata/{current,releases,config}
mkdir -p /srv/ata/releases/{backend,academy,crm}
mkdir -p /srv/ata-data/{db,uploads,access-control,backups}
mkdir -p /var/www/certbot

chown -R ata:ata /srv/ata-data/db /srv/ata-data/uploads /srv/ata-data/backups
chmod 0750 /srv/ata-data/db /srv/ata-data/uploads

# cutover.sh writes its rollback receipt here at mode 0600 as root.
chown root:root /srv/ata-data/access-control
chmod 0700 /srv/ata-data/access-control

# Config holds secrets: root-owned, readable by the service group only.
chown root:ata /srv/ata/config
chmod 0750 /srv/ata/config
note "layout created"

# ---------------------------------------------------------------------------
step "6/9  Swap"
# ---------------------------------------------------------------------------
# Not for steady-state — three Next servers idle well under 1 GB combined. This
# is purely so a `next build` spike cannot OOM-kill the box on a 4 GB instance.
if swapon --show | grep -q '/swapfile'; then
  note "swap already active"
else
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap -q /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  note "4G swapfile active"
fi

# ---------------------------------------------------------------------------
step "7/9  Source checkout"
# ---------------------------------------------------------------------------
# The path is NOT arbitrary: tools/build-release.sh hardcodes
# /home/ubuntu/learner-ops-v1/{backend,academy,crm} as its source root.
if [ -d "$REPO_DIR/.git" ]; then
  note "$REPO_DIR already a git checkout — leaving it alone"
else
  note "NOT cloning automatically."
  note "Clone your repository to exactly: $REPO_DIR"
  note "  git clone <url> $REPO_DIR && chown -R ubuntu:ubuntu $REPO_DIR"
fi

# ---------------------------------------------------------------------------
step "8/9  nginx configuration"
# ---------------------------------------------------------------------------
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p /etc/nginx/snippets
install -m 0644 "$SRC/nginx/_common-proxy.conf" /etc/nginx/snippets/ata-proxy.conf
install -m 0644 "$SRC/nginx/_http-scope.conf"   /etc/nginx/conf.d/ata-http-scope.conf

for site in api academy crm; do
  sed "s/__DOMAIN__/${DOMAIN}/g" "$SRC/nginx/${site}.conf.template" \
    > "/etc/nginx/sites-available/ata-${site}.conf"
done
note "site configs written for *.${DOMAIN}"

# Ubuntu's default site answers on :80 for any unmatched Host and would shadow
# nothing here, but it serves a "Welcome to nginx" page on the bare IP. Remove.
rm -f /etc/nginx/sites-enabled/default

# The TLS server blocks reference certificates that do not exist yet, so nginx
# cannot load them. Enable only after certbot has issued — see README step 5.
note "sites NOT enabled yet (certificates do not exist); see README step 5"

# ---------------------------------------------------------------------------
step "9/9  systemd units"
# ---------------------------------------------------------------------------
for unit in ata-prod-backend ata-prod-academy ata-prod-crm; do
  install -m 0644 "$SRC/systemd/${unit}.service" "/etc/systemd/system/${unit}.service"
done
install -m 0644 "$SRC/backup/ata-db-backup.service" /etc/systemd/system/ata-db-backup.service
install -m 0644 "$SRC/backup/ata-db-backup.timer"   /etc/systemd/system/ata-db-backup.timer
install -m 0755 "$SRC/backup/ata-db-backup.sh"      /usr/local/sbin/ata-db-backup.sh
systemctl daemon-reload
note "units installed (not enabled — nothing is built yet)"

cat <<EOF

------------------------------------------------------------------
Bootstrap complete. NOTHING IS RUNNING YET — by design.

Next, in order (deploy/aws/README.md has the detail):
  1. Clone the repo to $REPO_DIR
  2. Write the three env files into /srv/ata/config/  (chmod 0640, root:ata)
  3. Initialise the database   (prisma:migrate — NOT prisma migrate deploy)
  4. Build and publish         (deploy/aws/build.sh)
  5. Issue certificates, enable the sites, start the services
------------------------------------------------------------------
EOF
