#!/usr/bin/env bash
# Puts a backup back:  sudo bash deploy/restore.sh                lists the finished backups
#                      sudo bash deploy/restore.sh latest|STAMP
# It stops the app, saves the current data first (backups/pre-restore-*), replaces the
# database and the uploaded files, then starts the version checked out now with up.sh.
# --confirmed skips the question; use it only when the person in charge has agreed.
# --no-build is passed on to up.sh. Exit 2: the restore failed and nothing was changed.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
die() { echo "$*" >&2; exit 1; }
setting() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -E "s/^([\"'])(.*)\\1\$/\\2/"; }
stamp="" confirmed=0 up=(--no-backup)
for arg in "$@"; do
  case $arg in
    --confirmed) confirmed=1 ;;
    --no-build) up+=(--no-build) ;;
    -*) die "Usage: sudo bash deploy/restore.sh [latest|STAMP] [--confirmed] [--no-build]" ;;
    *) stamp=$arg ;;
  esac
done
[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo bash deploy/restore.sh"
[[ -f .env ]] || die "deploy/.env is missing: Care Hub isn't installed here."
data=$(setting CAREHUB_DATA_DIR)
data=${data:-/srv/carehub}
mapfile -t stamps < <(find "$data/backups" -maxdepth 1 -name 'carehub-*.sha256' -printf '%f\n' | sed 's/^carehub-//; s/\.sha256$//' | sort)
if [[ -z $stamp ]]; then
  echo "Finished backups in $data/backups, oldest first:"
  printf '  %s\n' "${stamps[@]:-(none)}"
  echo "Usage: sudo bash deploy/restore.sh latest   or   sudo bash deploy/restore.sh STAMP"
  exit 0
fi
((${#stamps[@]})) || die "There are no finished backups in $data/backups."
if [[ $stamp == latest ]]; then stamp=${stamps[-1]}; fi
[[ " ${stamps[*]} " == *" $stamp "* ]] || die "There is no finished backup $stamp; sudo bash deploy/restore.sh lists them."

top=$(readlink -f ..) # git runs as the owner of the checkout, not as root
version=$(sudo -u "$(stat -c %U "$top")" git -C "$top" describe --tags --always --dirty 2>/dev/null || echo unknown)
if ((!confirmed)); then
  echo "This replaces ALL Care Hub data (database and uploaded files) with the backup $stamp,"
  echo "then starts the version checked out now ($version). Care Hub is offline meanwhile."
  echo "The current data is saved first in $data/backups/pre-restore-*."
  { exec 3</dev/tty; } 2>/dev/null \
    || die "There is no terminal to ask on. Nothing was changed. Add --confirmed only if the person in charge agreed."
  read -r -p "Type RESTORE to continue: " answer <&3 || answer=""
  [[ $answer == RESTORE ]] || die "Nothing was changed."
fi

exec 8>"$data/.carehub.lock"
flock -n 8 || die "up.sh or another restore is running. Try again when it has finished."
docker compose stop app backup
rc=0
docker compose run --rm -T backup restore "$stamp" --confirmed || rc=$?
if ((rc == 0)); then
  rm -f "$data/restore-incomplete"
  echo "The data from $stamp is back."
  exec 8>&-
  exec bash ./up.sh "${up[@]}"
fi
if ((rc == 2)) && [[ ! -e $data/restore-incomplete ]]; then
  docker compose up -d --no-build app backup
  echo "The restore failed before changing anything. Care Hub runs again with its data unchanged." >&2
  exit 2
fi
printf '%s\n' "The restore of $stamp stopped partway (exit $rc) at $(date -u +%Y-%m-%dT%H:%M:%SZ)." \
  "Care Hub stays stopped until this succeeds: sudo bash deploy/restore.sh $stamp" \
  "The data from before the restore is in $data/backups/pre-restore-*." > "$data/restore-incomplete"
cat "$data/restore-incomplete" >&2
exit 1
