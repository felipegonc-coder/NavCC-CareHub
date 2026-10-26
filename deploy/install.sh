#!/usr/bin/env bash
# Install Care Hub on this server:  sudo bash install.sh carehub.your-tailnet.ts.net
# Safe to run again (also to update these files): it never overwrites .env, backups or data.
set -euo pipefail
src=$(dirname "$(readlink -f "$0")")
dir=${CAREHUB_DIR:-/opt/carehub}
domain=${1:-}
domain_re='^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
[[ $EUID -eq 0 ]] || { echo "Run this with sudo." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Install Docker Engine with the compose plugin first." >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is missing (package util-linux)." >&2; exit 1; }

install -d -m 755 "$dir" "$dir/backups" "$dir/backups/runs"
# The app (user node, uid 1000) asks for backups here; see "Status page" in README.md.
install -d -m 755 -o 1000 -g 1000 "$dir/backups/requests"
if [[ $src != "$(readlink -f "$dir")" ]]; then
  for f in docker-compose.yml Caddyfile .env.example README.md carehub-update.service carehub-update.timer; do
    install -m 644 "$src/$f" "$dir/$f"
  done
  for f in backup.sh restore.sh update.sh install.sh; do install -m 755 "$src/$f" "$dir/$f"; done
fi
cd "$dir"

if [[ -f .env ]]; then
  echo "Keeping the existing $dir/.env."
else
  [[ $domain =~ $domain_re ]] || { echo "Usage: sudo bash install.sh DOMAIN  (for example carehub.your-tailnet.ts.net)" >&2; exit 1; }
  password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  (umask 077; sed -e "s|^CAREHUB_DOMAIN=.*|CAREHUB_DOMAIN=$domain|" \
    -e "s|^CAREHUB_PUBLIC_URL=.*|CAREHUB_PUBLIC_URL=https://$domain|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$password|" \
    -e "/^DATABASE_URL=/s|:change-me@|:$password@|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|" .env.example > .env)
  echo "Created $dir/.env with new random secrets. It stays on this server."
fi

sed "s|/opt/carehub|$dir|g" carehub-update.service > /etc/systemd/system/carehub-update.service
install -m 644 carehub-update.timer /etc/systemd/system/carehub-update.timer
systemctl daemon-reload
systemctl enable --now carehub-update.timer

if grep -qs '"ghcr.io"' /root/.docker/config.json; then
  docker compose up -d
  echo "Care Hub is starting at https://$(sed -n 's/^CAREHUB_DOMAIN=//p' .env)"
else
  echo "Next, sign in to GitHub's registry once and start Care Hub:"
  echo "  sudo docker login ghcr.io -u YOUR_GITHUB_USER   (password: a token with read:packages)"
  echo "  cd $dir && sudo docker compose up -d"
fi
