#!/usr/bin/env bash
# Put a backup back:  sudo ./restore.sh                  lists the finished backups
#                     sudo ./restore.sh latest|STAMP
# The app is stopped meanwhile and the current data is saved first (backups/pre-restore-*).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
[[ $EUID -eq 0 ]] || { echo "Run this with sudo." >&2; exit 1; }

mapfile -t stamps < <(find backups -maxdepth 1 -name 'carehub-*.sha256' -printf '%f\n' | sed 's/^carehub-//; s/\.sha256$//' | sort)
if (( $# == 0 )); then
  echo "Finished backups, oldest first:"; printf '  %s\n' "${stamps[@]:-(none)}"
  echo "Usage: sudo ./restore.sh latest   or   sudo ./restore.sh STAMP"; exit 0
fi
(( ${#stamps[@]} )) || { echo "There are no finished backups in $PWD/backups." >&2; exit 1; }
stamp=$1
if [[ $stamp == latest ]]; then stamp=${stamps[-1]}; fi
[[ " ${stamps[*]} " == *" $stamp "* ]] || { echo "No finished backup $stamp; run sudo ./restore.sh to list them." >&2; exit 1; }

echo "This replaces ALL Care Hub data (database and uploaded files) with the backup $stamp."
echo "Care Hub is offline meanwhile; the current data is saved first in backups/pre-restore-*."
read -r -p "Type RESTORE to continue: " answer </dev/tty
[[ $answer == RESTORE ]] || { echo "Nothing was changed."; exit 1; }

exec 8>.carehub.lock
flock 8 # waits for a running update to finish
docker compose stop app backup
rc=0
docker compose run --rm -T backup restore "$stamp" --confirmed || rc=$?
case $rc in
  0) rm -f .restore-incomplete; docker compose up -d app backup; echo "Done: Care Hub has the data from $stamp."; exit 0 ;;
  2) echo "The restore failed before changing anything." >&2 ;;
  *) touch .restore-incomplete; echo "The restore stopped partway (exit $rc)." >&2 ;;
esac
if [[ -e .restore-incomplete ]]; then
  echo "Care Hub stays stopped and updates are paused until sudo ./restore.sh $stamp succeeds." >&2
  echo "The data from before the restore is in backups/pre-restore-*." >&2
  exit 1
fi
docker compose up -d app backup
echo "Care Hub is running again with its data unchanged." >&2
exit 2
