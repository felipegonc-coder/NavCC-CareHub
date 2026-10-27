#!/usr/bin/env bash
# Update Care Hub. "sudo ./update.sh" pulls the images named in docker-compose.yml (the
# app's is pinned to a version) and restarts what changed. carehub-update.timer runs
# "update.sh --timer" every 15 minutes: that pulls only when .env has
# CAREHUB_AUTO_UPDATE=true, and then only in the 03:00 run. It never deletes images
# (see "Old image versions" in README.md).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
exec 8>.carehub.lock
flock -n 8 || { echo "A restore or another update is running; skipping."; exit 0; }
if [[ -e .restore-incomplete ]]; then
  echo "Skipping: a restore did not finish. Run sudo ./restore.sh again (see README.md)."; exit 0
fi
update=true
if [[ ${1:-} == --timer ]]; then
  auto=$(sed -n 's/^CAREHUB_AUTO_UPDATE=//p' .env 2>/dev/null || true)
  hm=$(date +%H%M)
  [[ $auto == true && ($hm == 030[0-9] || $hm == 031[0-4]) ]] || update=false
fi
if [[ $update == true ]]; then
  docker compose pull --quiet
  docker compose up -d --remove-orphans
fi
# If tailscaled's folder was recreated, Caddy can lose sight of the socket until restarted.
if [[ -S /var/run/tailscale/tailscaled.sock ]] && ! docker compose exec -T caddy test -S /var/run/tailscale/tailscaled.sock; then
  echo "Caddy cannot see the Tailscale socket; restarting Caddy."
  docker compose restart caddy
fi
