# Deploying Care Hub

One server runs everything with Docker Compose: the app image from GHCR, PostgreSQL 17,
Caddy for HTTPS and a backup service. Why it looks like this:
[docs/decisions/0003-image-and-deploy.md](../docs/decisions/0003-image-and-deploy.md).

| File                            | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `docker-compose.yml`            | The services `app`, `db`, `caddy` and `backup`, with their volumes       |
| `.env.example`                  | Settings; `install.sh` turns it into `.env` with random secrets          |
| `Caddyfile`                     | HTTPS for `CAREHUB_DOMAIN`, passed on to the app                         |
| `install.sh`                    | Copies this folder to `/opt/carehub`, creates `.env`, turns on the timer |
| `update.sh`, `carehub-update.*` | Every 15 minutes: pull new images, restart what changed                  |
| `backup.sh`                     | Nightly backups; runs inside the `backup` service                        |
| `restore.sh`                    | Puts a backup back                                                       |

## Install

You need a Linux amd64 server with Docker Engine and the compose plugin. For a
`*.ts.net` name, Tailscale runs on the host with HTTPS certificates turned on for the
tailnet. For a public domain, point its DNS at the server and open ports 80 and 443.

```sh
sudo bash install.sh carehub.your-tailnet.ts.net   # in this deploy/ folder
sudo docker login ghcr.io -u YOUR_GITHUB_USER   # password: a token with read:packages
cd /opt/carehub && sudo docker compose up -d
```

`install.sh` can run again at any time, for example to install newer deploy files. It
never overwrites `.env`, `backups/` or data. Keep `.env` on the server only.

## Day to day

Run these in `/opt/carehub`:

```sh
sudo docker compose ps                  # what runs, and whether it is healthy
sudo docker compose logs -f app         # app logs (also db, caddy, backup)
systemctl list-timers carehub-update.timer
journalctl -u carehub-update            # what the updates did
```

## Updates, holding and rolling back

Every commit on `main` gets an image within a day, tagged `latest` and `sha-<commit>`.
The timer pulls `latest` every 15 minutes and restarts the app when it changed.
PostgreSQL (17.x) and Caddy (2.x) are pulled only in the 03:00 run.

To hold a version or go back to one, set
`CAREHUB_IMAGE=ghcr.io/felipegonc-coder/navcc-carehub:sha-<commit>` in `.env` and run
`sudo ./update.sh`. Set it back to `:latest` to follow `main` again. If the newer
version changed the database, going back also needs a restore from before the update.

## Tailscale

Caddy gets `*.ts.net` certificates from the host's tailscaled through its socket.
The compose file mounts the folder `/var/run/tailscale`, not the socket file, so Caddy
still finds the socket after tailscaled restarts. If Caddy loses it anyway, `update.sh`
restarts Caddy.

## Backups

Every night at `BACKUP_AT` (in `TZ`) the `backup` service writes three files to
`backups/`: `carehub-STAMP.db.dump` (pg_dump), `carehub-STAMP.files.tar.gz` (uploaded
files) and `carehub-STAMP.sha256`. The checksum file is written last, only after the dump
was restored into a scratch database (same number of tables as the dump, rows counted)
and the archive was read back. Backups older than `BACKUP_KEEP_DAYS` days are deleted.

`backups/status.json` describes the last run: `result` (`ok` or `failed`), `message`,
`lastSuccessAt`, sizes and counts. To back up right now:
`sudo docker compose exec backup bash /opt/carehub/backup.sh now`.

The backups are on the same disk as the data. Copy `backups/` somewhere else too.

## Restore

```sh
sudo ./restore.sh          # lists the finished backups
sudo ./restore.sh latest   # or a STAMP from the list; asks you to type RESTORE
```

It stops the app, saves the current data as `backups/pre-restore-*` (kept until you
delete them), then replaces the database and the uploaded files. If it fails before
changing anything, the app starts again unchanged. If it stops partway, the app stays
stopped and updates pause until a restore succeeds.

On a new server: run `install.sh`, copy the old `backups/` folder into `/opt/carehub`,
start Care Hub, then restore.

## Old image versions

Nothing deletes old images automatically. Each build adds a version to the GHCR
package; delete old ones by hand in the package settings on GitHub. On the server,
free space by hand with `sudo docker image prune`.
