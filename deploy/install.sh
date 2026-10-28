#!/usr/bin/env bash
# Prepares this server for Care Hub. Run it in the checkout:
#   sudo bash deploy/install.sh carehub.tail1234.ts.net    (the server's Tailscale name)
# It creates deploy/.env from .env.example with this server's values and random secrets
# (root only, mode 600), unless .env exists: then it keeps it. It creates the data folders
# in CAREHUB_DATA_DIR (default /srv/carehub), owned by the service user CAREHUB_USER
# (default carehub), mode 700. Safe to run again. Then start Care Hub: sudo bash deploy/up.sh
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
die() { echo "$*" >&2; exit 1; }
warn() { echo "Warning: $*" >&2; }
setting() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -E "s/^([\"'])(.*)\\1\$/\\2/"; }
[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo bash deploy/install.sh <domain>"
docker compose version >/dev/null 2>&1 || die "Docker Engine with the Compose plugin is needed first (see deploy/README.md)."
command -v flock >/dev/null || die "flock is missing (package util-linux)."

if [[ -f .env ]]; then
  data=$(setting CAREHUB_DATA_DIR) uid=$(setting CAREHUB_UID) gid=$(setting CAREHUB_GID)
  domain=$(setting CAREHUB_DOMAIN)
  data=${data:-/srv/carehub}
  [[ $uid =~ ^[1-9][0-9]*$ && $gid =~ ^[0-9]+$ ]] \
    || die "CAREHUB_UID and CAREHUB_GID in deploy/.env must be the service user's numbers (not root)."
  echo "Keeping the existing deploy/.env (CAREHUB_DOMAIN=$domain). Edit it to change a setting."
else
  domain=${1:-}
  [[ $domain =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
    || die "Usage: sudo bash deploy/install.sh <the server's Tailscale name, e.g. carehub.tail1234.ts.net>"
  user=${CAREHUB_USER:-carehub}
  uid=$(id -u "$user" 2>/dev/null) && gid=$(id -g "$user") \
    || die "There is no user $user. Create it: sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin $user"
  ((uid != 0)) || die "The service user must not be root."
  data=${CAREHUB_DATA_DIR:-/srv/carehub}
  ip=${CAREHUB_TAILSCALE_IP:-$(tailscale ip -4 2>/dev/null | head -n 1 || true)}
  [[ $ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] \
    || die "Could not find this server's Tailscale address (tailscale ip -4). Is Tailscale up? See deploy/README.md."
fi
[[ $data == /* && $data != *[!A-Za-z0-9._/-]* ]] \
  || die "CAREHUB_DATA_DIR must be an absolute path of letters, digits and . _ - /, not '$data'."

if [[ ! -f .env ]]; then
  random() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; } # 48 hex digits
  pw=$(random) app_pw=$(random) key=$(head -c 32 /dev/urandom | base64)
  [[ ${#pw} == 48 && ${#app_pw} == 48 && ${#key} == 44 ]] || die "Could not make random secrets."
  (
    umask 077
    sed -e "s|^CAREHUB_DOMAIN=.*|CAREHUB_DOMAIN=$domain|" \
      -e "s|^CAREHUB_PUBLIC_URL=.*|CAREHUB_PUBLIC_URL=https://$domain|" \
      -e "s|^CAREHUB_TAILSCALE_IP=.*|CAREHUB_TAILSCALE_IP=$ip|" \
      -e "s|^CAREHUB_DATA_DIR=.*|CAREHUB_DATA_DIR=$data|" \
      -e "s|^CAREHUB_UID=.*|CAREHUB_UID=$uid|" \
      -e "s|^CAREHUB_GID=.*|CAREHUB_GID=$gid|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" \
      -e "s|^CAREHUB_DB_PASSWORD=.*|CAREHUB_DB_PASSWORD=$app_pw|" \
      -e "s|^CALENDAR_SECRET_KEY=.*|CALENDAR_SECRET_KEY=$key|" \
      .env.example > .env.new
  )
  ! grep -q change-me .env.new || { rm -f .env.new; die "Could not replace every change-me in .env.example."; }
  mv .env.new .env
  echo "Created deploy/.env (root only, mode 600) for https://$domain on $ip."
fi

# The data folders, all owned by the service user and closed to everyone else.
for dir in "" postgres files backups backups/status backups/status/runs backups/status/requests \
  caddy caddy/data caddy/config; do
  install -d -m 700 -o "$uid" -g "$gid" "$data/$dir"
done
echo "The data folders are in $data (owner $uid:$gid, mode 700)."

# Steps from deploy/README.md that this script doesn't do itself.
if [[ $(sysctl -n net.ipv4.ip_nonlocal_bind 2>/dev/null) != 1 ]]; then
  warn "net.ipv4.ip_nonlocal_bind is not 1, so Care Hub may not start at boot before Tailscale is up. See \"Before the first deploy\" in deploy/README.md."
fi
name=$(id -un "$uid" 2>/dev/null || echo "$uid")
if [[ $domain == *.ts.net ]] && ! grep -Eqs "^TS_PERMIT_CERT_UID=\"?($uid|$name)\"?\$" /etc/default/tailscaled; then
  warn "/etc/default/tailscaled has no TS_PERMIT_CERT_UID=$name, so Caddy can't get the HTTPS certificate. See \"Before the first deploy\" in deploy/README.md."
fi
echo "Next: carehub-firewall.service (deploy/README.md, First start), then sudo bash deploy/up.sh"
