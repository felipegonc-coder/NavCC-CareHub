#!/usr/bin/env bash
# Starts or updates Care Hub from the version checked out now:  sudo ./deploy/up.sh
# 1. builds the app image from this checkout (Care Hub keeps running meanwhile);
# 2. backs up the database and the files, if Care Hub is running;
# 3. starts the new version and waits until it is healthy; the app runs its database
#    migrations when it starts;
# 4. checks https://CAREHUB_DOMAIN/api/health through Caddy.
# --no-build starts the image as it is (built before, or pulled: see README.md).
# --no-backup skips step 2; restore.sh uses it right after a restore.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
die() { echo "$*" >&2; exit 1; }
setting() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -E "s/^([\"'])(.*)\\1\$/\\2/"; }
build=1 backup=1
for arg in "$@"; do
  case $arg in
    --no-build) build=0 ;;
    --no-backup) backup=0 ;;
    *) die "Usage: sudo ./deploy/up.sh [--no-build] [--no-backup]" ;;
  esac
done
[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo ./deploy/up.sh"
command -v curl >/dev/null || die "curl is missing; install it first."
[[ -f .env ]] || die "deploy/.env is missing: run sudo ./deploy/install.sh <domain> first."
data=$(setting CAREHUB_DATA_DIR) domain=$(setting CAREHUB_DOMAIN) ip=$(setting CAREHUB_TAILSCALE_IP)
data=${data:-/srv/carehub}
for dir in postgres files backups/status/requests caddy/data caddy/config; do
  [[ -d $data/$dir ]] || die "$data/$dir is missing: run sudo ./deploy/install.sh again."
done
if [[ -e $data/restore-incomplete ]]; then cat "$data/restore-incomplete" >&2; exit 1; fi
exec 8>"$data/.carehub.lock"
flock -n 8 || die "A restore or another up.sh is running. Try again when it has finished."

env_version() { sed -n 's/^CAREHUB_VERSION=//p'; }
image_version() { docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' carehub-app:local 2>/dev/null | env_version; }
running=$(docker compose ps -q app 2>/dev/null | head -n 1 || true)
previous=""
if [[ -n $running ]]; then
  previous=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$running" | env_version || true)
fi
stamp=""
# What to do if the new version doesn't come up ("Rolling back" in deploy/README.md).
rollback() {
  echo "Logs: sudo docker compose -f $PWD/docker-compose.yml logs --tail 100 app caddy" >&2
  if [[ -n $previous && $previous != unknown && $previous != "$(image_version)" ]]; then
    echo "To go back to $previous: git checkout ${previous%-dirty}, then sudo ./deploy/up.sh" >&2
    if [[ -n $stamp ]]; then
      echo "If the new version changed the database, put back the backup from just before instead:" >&2
      echo "git checkout ${previous%-dirty}, then sudo ./deploy/restore.sh $stamp" >&2
    fi
  fi
  exit 1
}

if ((build)); then
  top=$(readlink -f ..) # git runs as the owner of the checkout, not as root
  CAREHUB_VERSION=$(sudo -u "$(stat -c %U "$top")" git -C "$top" describe --tags --always --dirty 2>/dev/null || echo unknown)
  CAREHUB_BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  export CAREHUB_VERSION CAREHUB_BUILD_DATE
  echo "Building Care Hub $CAREHUB_VERSION..."
  docker compose build || die "The build failed; nothing was changed."
fi

if ((backup)) && [[ -n $(docker compose ps -q --status running backup 2>/dev/null) ]]; then
  echo "Backing up first..."
  docker compose exec -T backup bash /opt/carehub/backup.sh now \
    || die "The backup failed, so nothing was changed. The reason is above and in $data/backups/status/status.json."
  stamp=$(find "$data/backups" -maxdepth 1 -name 'carehub-*.sha256' -printf '%f\n' | sort | tail -n 1 | sed 's/^carehub-//; s/\.sha256$//')
  echo "Backed up as $stamp."
elif ((backup)); then
  echo "Care Hub isn't running, so there is nothing to back up first."
fi

echo "Starting Care Hub $(image_version)..."
docker compose up -d --no-build --remove-orphans --wait --wait-timeout 300 \
  || { echo "Care Hub did not become healthy." >&2; rollback; }

# Through Caddy on the Tailscale address, as a browser would. *.localhost names (CI) get
# Caddy's own certificate, which curl doesn't trust.
insecure=()
if [[ $domain == *.localhost ]]; then insecure=(--insecure); fi
for _ in $(seq 30); do
  if health=$(curl -fsS --max-time 5 --resolve "$domain:443:$ip" "${insecure[@]}" "https://$domain/api/health" 2>/dev/null); then
    echo "Care Hub is up at https://$domain: $health"
    exit 0
  fi
  sleep 2
done
echo "The containers run, but https://$domain/api/health doesn't answer." >&2
rollback
