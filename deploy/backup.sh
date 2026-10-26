#!/usr/bin/env bash
# Care Hub backups. Runs in the "backup" service of docker-compose.yml (postgres:17
# image), which sets PGHOST, PGUSER, PGPASSWORD, PGDATABASE, TZ and BACKUP_*.
#   backup.sh schedule                   back up once a day at BACKUP_AT (local time)
#   backup.sh now                        back up the database and the uploaded files now
#   backup.sh restore STAMP --confirmed  replace both with a backup (use restore.sh)
# A backup is finished only once carehub-STAMP.sha256 exists. That file is written after
# the dump was restored into a scratch database and the files archive was read back.
set -euo pipefail
umask 077

BACKUPS=${BACKUPS:-/backups}
FILES=${FILES:-/data/files}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
BACKUP_AT=${BACKUP_AT:-02:00}
DB=${PGDATABASE:?PGDATABASE is not set}
STAMP="" STARTED="" FINISHED="" BASE="" ERROR="" LOCKED=0 CHANGED=0
TABLES="" ROWS="" COUNT="" DB_BYTES="" FILE_BYTES=""
NAME_RE='^carehub-([0-9]{8})-[0-9]{6}\.(db\.dump|files\.tar\.gz|sha256)(\.partial)?$'
# Tables and their exact row counts, leaving out tables that extensions create.
TABLES_SQL="SELECT count(*), coalesce(sum(CASE WHEN c.relkind = 'r' THEN (xpath('/row/n/text()',
    query_to_xml(format('SELECT count(*) AS n FROM %I.%I', s.nspname, c.relname), false, true, '')))[1]::text::bigint END), 0)
  FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND s.nspname NOT IN ('pg_catalog', 'information_schema')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() { ERROR=$*; log "ERROR: $*" >&2; exit 1; }
lock() { exec 9>"$BACKUPS/.lock"; flock -n 9 || die "another backup or restore is running"; LOCKED=1; }
str() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '"%s"' "${s//[$'\t\n\r']/ }"; }
num() { if [[ $1 =~ ^[0-9]+$ ]]; then printf '%s' "$1"; else printf null; fi; }
# tar exits 1 when a file changed while it was read; the archive is still usable.
archive() { local rc=0; tar -C "$FILES" --numeric-owner -czf "$1" . || rc=$?; (( rc <= 1 )); }

check_config() {
  [[ $BACKUP_AT =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "BACKUP_AT must be a time like 02:00, not '$BACKUP_AT'"
  [[ $KEEP_DAYS =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP_DAYS must be a whole number of days, not '$KEEP_DAYS'"
}

write_status() { # result message
  local f="$BACKUPS/status.json" last=null
  if [[ $1 == ok ]]; then last=$(str "$FINISHED")
  elif [[ -f $f ]]; then last=$(sed -n 's/^  "lastSuccessAt": \(.*\),$/\1/p' "$f"); fi
  [[ $last =~ ^(null|\"[0-9T:+-]+\")$ ]] || last=null
  cat > "$f.tmp" <<JSON
{
  "result": $(str "$1"),
  "message": $(str "$2"),
  "stamp": $(str "$STAMP"),
  "startedAt": $(str "$STARTED"),
  "finishedAt": $(str "$FINISHED"),
  "lastSuccessAt": $last,
  "databaseBytes": $(num "$DB_BYTES"),
  "filesBytes": $(num "$FILE_BYTES"),
  "fileCount": $(num "$COUNT"),
  "tables": $(num "$TABLES"),
  "rows": $(num "$ROWS"),
  "keepDays": $(num "$KEEP_DAYS")
}
JSON
  chmod 644 "$f.tmp" && mv "$f.tmp" "$f"
}

schedule() {
  check_config
  local done_day="" now
  # Recreated after today's backup (by an update, say): the next one is tomorrow.
  if compgen -G "$BACKUPS/carehub-$(date +%Y%m%d)-*.sha256" >/dev/null; then done_day=$(date +%F); fi
  log "backing up daily at $BACKUP_AT (${TZ:-UTC}) into $BACKUPS, keeping $KEEP_DAYS days"
  trap 'exit 0' TERM INT
  while :; do
    now=$(date '+%F %H:%M')
    if [[ ${now% *} != "$done_day" && ! ${now#* } < "$BACKUP_AT" ]]; then
      done_day=${now% *}
      bash "$0" now || log "the backup failed, see $BACKUPS/status.json" >&2
    fi
    sleep 30 & wait $!
  done
}

backup_now() {
  check_config
  lock
  STARTED=$(date -Iseconds) STAMP=$(date +%Y%m%d-%H%M%S)
  BASE="$BACKUPS/carehub-$STAMP"
  trap backup_exit EXIT
  log "backup $STAMP: dumping database $DB"
  pg_dump -Fc -f "$BASE.db.dump.partial" "$DB" || die "pg_dump failed"
  mv "$BASE.db.dump.partial" "$BASE.db.dump"
  log "backup $STAMP: archiving $FILES"
  archive "$BASE.files.tar.gz.partial" || die "could not archive $FILES"
  mv "$BASE.files.tar.gz.partial" "$BASE.files.tar.gz"
  prove
  (cd "$BACKUPS" && sha256sum "carehub-$STAMP.db.dump" "carehub-$STAMP.files.tar.gz" > "carehub-$STAMP.sha256.partial")
  mv "$BASE.sha256.partial" "$BASE.sha256"
  prune
  FINISHED=$(date -Iseconds)
  write_status ok "backed up and checked $TABLES tables, $ROWS rows and $COUNT files"
  log "backup $STAMP: done ($TABLES tables, $ROWS rows, $COUNT files)"
}

prove() {
  local check="${DB}_backup_check" toc out
  log "backup $STAMP: restoring the dump into a scratch database"
  toc=$(pg_restore --list "$BASE.db.dump" | awk '$4 == "TABLE" && $5 != "DATA" && $5 != "ATTACH" {n++} END {print n+0}') \
    || die "the dump cannot be read"
  dropdb --if-exists "$check"
  createdb -T template0 "$check"
  pg_restore --exit-on-error -d "$check" "$BASE.db.dump" || die "the dump does not restore"
  out=$(psql -X -A -t -F ' ' -v ON_ERROR_STOP=1 -d "$check" -c "$TABLES_SQL") || die "could not count the restored rows"
  read -r TABLES ROWS <<<"$out"
  [[ $TABLES == "$toc" ]] || die "the scratch database has $TABLES tables, the dump lists $toc"
  COUNT=$(tar -tzf "$BASE.files.tar.gz" | awk '!/\/$/ {n++} END {print n+0}') || die "the files archive cannot be read back"
  DB_BYTES=$(stat -c %s "$BASE.db.dump") FILE_BYTES=$(stat -c %s "$BASE.files.tar.gz")
}

prune() {
  local cutoff f
  cutoff=$(date -d "-$((KEEP_DAYS - 1)) days" +%Y%m%d)
  for f in "$BACKUPS"/carehub-*; do
    [[ ${f##*/} =~ $NAME_RE ]] || continue
    if [[ ${BASH_REMATCH[1]} < "$cutoff" ]]; then rm -f -- "$f"; log "removed the old backup file ${f##*/}"; fi
  done
}

backup_exit() {
  local rc=$?
  dropdb --if-exists "${DB}_backup_check" 2>/dev/null || true
  (( rc == 0 )) && return
  rm -f -- "$BASE".db.dump{,.partial} "$BASE".files.tar.gz{,.partial} "$BASE".sha256{,.partial}
  TABLES="" ROWS="" COUNT="" DB_BYTES="" FILE_BYTES="" FINISHED=$(date -Iseconds)
  write_status failed "${ERROR:-the backup failed (exit $rc)}; see: docker compose logs backup"
}

restore() { # STAMP --confirmed
  local stamp=${1:-} tmp="${DB}_restore_tmp" old="${DB}_before_restore" now
  trap restore_exit EXIT
  [[ $stamp =~ ^[0-9]{8}-[0-9]{6}$ && ${2:-} == --confirmed ]] || die "usage: backup.sh restore STAMP --confirmed (or use restore.sh)"
  BASE="$BACKUPS/carehub-$stamp"
  [[ -f $BASE.sha256 ]] || die "there is no finished backup $stamp in $BACKUPS"
  lock
  (cd "$BACKUPS" && sha256sum --quiet --check "carehub-$stamp.sha256") || die "backup $stamp is damaged: its checksums do not match"
  now=$(date +%Y%m%d-%H%M%S)
  log "saving the current data as $BACKUPS/pre-restore-$now.*"
  pg_dump -Fc -f "$BACKUPS/pre-restore-$now.db.dump" "$DB" || die "could not save the current database"
  archive "$BACKUPS/pre-restore-$now.files.tar.gz" || die "could not save the current files"
  log "restoring the database from $stamp"
  dropdb --if-exists "$tmp"
  createdb -T template0 "$tmp"
  pg_restore --exit-on-error -d "$tmp" "$BASE.db.dump" || die "the backup does not restore"
  psql -X -q -o /dev/null -v ON_ERROR_STOP=1 -d postgres <<SQL || die "could not swap in the restored database"
DROP DATABASE IF EXISTS "$old";
SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE "$DB" RENAME TO "$old";
ALTER DATABASE "$tmp" RENAME TO "$DB";
COMMIT;
SQL
  CHANGED=1
  dropdb "$old" || log "could not drop $old; drop it by hand later"
  log "restoring the files from $stamp"
  find "$FILES" -mindepth 1 -delete
  tar -C "$FILES" --numeric-owner -xzf "$BASE.files.tar.gz"
  log "restore of $stamp done"
}

restore_exit() { # exit 2: nothing was changed; exit 1: the database was replaced, the files maybe not
  local rc=$?
  (( rc == 0 )) && return
  if (( LOCKED )); then dropdb --if-exists "${DB}_restore_tmp" 2>/dev/null || true; fi
  if (( CHANGED )); then log "the database was restored but the files may not be; run the restore again" >&2; exit 1; fi
  log "the restore failed; nothing was changed" >&2
  exit 2
}

case ${1:-} in
  schedule) schedule ;;
  now) backup_now ;;
  restore) shift; restore "$@" ;;
  *) echo "usage: backup.sh schedule | now | restore STAMP --confirmed" >&2; exit 64 ;;
esac
