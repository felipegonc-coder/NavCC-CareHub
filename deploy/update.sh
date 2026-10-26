#!/usr/bin/env bash
# Pull new Care Hub images and restart what changed; carehub-update.timer runs this
# every 15 minutes. It never deletes images (see "Old image versions" in README.md).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
exec 8>.carehub.lock
flock -n 8 || { echo "A restore or another update is running; skipping."; exit 0; }
if [[ -e .restore-incomplete ]]; then
  echo "Skipping: a restore did not finish. Run sudo ./restore.sh again (see README.md)."; exit 0
fi
# The app on every run; PostgreSQL and Caddy only in the 03:00 run.
hm=$(date +%H%M)
if [[ $hm == 030[0-9] || $hm == 031[0-4] ]]; then docker compose pull --quiet; else docker compose pull --quiet app; fi
docker compose up -d --remove-orphans
# If tailscaled's folder was recreated, Caddy can lose sight of the socket until restarted.
if [[ -S /var/run/tailscale/tailscaled.sock ]] && ! docker compose exec -T caddy test -S /var/run/tailscale/tailscaled.sock; then
  echo "Caddy cannot see the Tailscale socket; restarting Caddy."
  docker compose restart caddy
fi
