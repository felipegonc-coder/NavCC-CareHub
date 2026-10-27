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
| `update.sh`, `carehub-update.*` | Updates when you run it; the timer only with `CAREHUB_AUTO_UPDATE=true`  |
| `backup.sh`                     | Nightly backups; runs inside the `backup` service                        |
| `restore.sh`                    | Puts a backup back                                                       |

## Install

You need a Linux amd64 server with Docker Engine and the compose plugin. For a
`*.ts.net` name, Tailscale runs on the host with HTTPS certificates turned on for the
tailnet; see [Tailscale](#tailscale) to keep Care Hub off every other network. For a
public domain, point its DNS at the server and open ports 80 and 443.

The app version that `docker-compose.yml` names must be published first, see
[Versions and updates](#versions-and-updates).

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

## Versions and updates

`docker-compose.yml` pins the app to a version, `ghcr.io/felipegonc-coder/navcc-carehub:0.1.0`,
so the server changes only when someone decides it should.

- **Publish a version:** on GitHub, Actions > Image > Run workflow, branch `main`, with a
  version such as `0.1.0`. The workflow builds and tests `main` and pushes the image as
  `0.1.0`, `sha-<commit>` and `latest`. An existing version is never overwritten.
- **Move the server to it:** change the version in `deploy/docker-compose.yml` in a pull
  request. After the merge, run `sudo bash install.sh` in the new `deploy/` folder (or edit
  `/opt/carehub/docker-compose.yml`), then `sudo ./update.sh` in `/opt/carehub`.
- **`sudo ./update.sh`** pulls the pinned app version, the newest PostgreSQL 17.x and
  Caddy 2.x, and restarts what changed.
- **Go back:** put the old version back in `docker-compose.yml` and run `sudo ./update.sh`.
  If the newer version changed the database, going back also needs a restore from before
  the update.

`main` is also built every night at 01:30 UTC if it changed, as `latest` and
`sha-<commit>`; the server uses neither unless you put one in `docker-compose.yml`. Pull
requests build and test the image but push nothing.

Automatic updates are off: `CAREHUB_AUTO_UPDATE=false` in `.env`. The timer still runs
every 15 minutes, but only for the Tailscale check below. With `CAREHUB_AUTO_UPDATE=true`
its 03:00 run does what `sudo ./update.sh` does, which in practice brings newer PostgreSQL
17.x and Caddy 2.x images (the app stays at its pinned version).

## Tailscale

Caddy gets `*.ts.net` certificates from the host's tailscaled through its socket.
The compose file mounts the folder `/var/run/tailscale`, not the socket file, so Caddy
still finds the socket after tailscaled restarts. If Caddy loses it anyway, `update.sh`
restarts Caddy.

To make Care Hub reachable only over Tailscale, set `CAREHUB_BIND_ADDRESS` in `.env` to
the server's tailnet address (`tailscale ip -4`, for example `100.101.102.103`) and run
`sudo docker compose up -d`. Caddy then listens on ports 80 and 443 of that address only.
Empty, the default, means every address of the server. A firewall such as ufw cannot do
this job: ports published by Docker bypass ufw's rules.

Docker starts Caddy at boot, possibly before Tailscale has its address. Let the kernel
accept listening on an address the server does not have yet:

```sh
echo 'net.ipv4.ip_nonlocal_bind = 1' | sudo tee /etc/sysctl.d/60-carehub.conf
sudo sysctl --system
```

With a public domain, leave `CAREHUB_BIND_ADDRESS` empty: the certificate authority must
reach ports 80 and 443 from the internet.

## Backups

Every night at `BACKUP_AT` (in `TZ`) the `backup` service writes three files to
`backups/`: `carehub-STAMP.db.dump` (pg_dump), `carehub-STAMP.files.tar.gz` (uploaded
files) and `carehub-STAMP.sha256`. STAMP is the UTC start time, for example
`20261027T080000Z`. The checksum file is written last, only after the dump was restored
into a scratch database (same number of tables as the dump, rows counted) and the archive
was read back. Backups and run records older than `BACKUP_KEEP_DAYS` days are deleted.
The backup files are readable by root only.

To back up right now: `sudo docker compose exec backup bash /opt/carehub/backup.sh now`.

Limits:

- One backup or restore at a time (a lock file in `backups/`).
- A backup does not start when the disk has less free space than twice the size of the
  last finished backup. The run is recorded as failed: `Not run: only N MB are free ...`.
- A request from the app (see [Status page](#status-page)) less than 60 minutes after
  the last run finished is ignored. Backups started by hand or by the schedule are not.

The backups are on the same disk as the data, and they are not encrypted. Copy `backups/`
somewhere else too. Encrypting them (for example with age, with the key kept off the
server) is planned for later.

## Status page

Every backup run, good or failed, writes `backups/runs/STAMP.json` and the same content
to `backups/status.json` (the latest run):

```json
{
  "startedAt": "2026-10-27T08:00:00Z",
  "finishedAt": "2026-10-27T08:00:09Z",
  "ok": true,
  "dbBytes": 1048576,
  "filesBytes": 52428800,
  "restoreTest": {
    "ok": true,
    "checkedAt": "2026-10-27T08:00:08Z",
    "details": "Restored into a scratch database: 12 tables (as listed in the dump), 3456 rows. Read back the files archive: 78 files."
  }
}
```

Times are UTC. On a failure `ok` is false, the sizes are `null`, and `restoreTest.details`
says what went wrong (`Not run: ...` when it failed before the restore test).

The app container mounts `backups/` read-only at `/data/backups`, so it can read
`status.json` and `runs/` but not the backup files. It also mounts `backups/requests`
read-write at `/data/backups/requests`. To ask for a backup, the app creates a file
named `now` there. The backup service checks for it every 30 seconds, deletes it and
runs a backup; the result shows up in `status.json`. `install.sh` makes `requests/`
writable for the app's `node` user (uid 1000). The image workflow checks that this user
cannot read the backup files.

Rules for the app:

- Only admins may see the Status page and ask for a backup. Check this on the server, not
  only in the page.
- A request less than 60 minutes after the last run's `finishedAt` is deleted without a
  backup. Show when the next one is possible instead of offering the button.
- Requests run one at a time. A backup that would leave too little disk space fails at
  once with `ok: false` and the reason in `restoreTest.details`.

## Restore

```sh
sudo ./restore.sh          # lists the finished backups
sudo ./restore.sh latest   # or a STAMP (UTC) from the list; asks you to type RESTORE
```

It stops the app, saves the current data as `backups/pre-restore-*` (kept until you
delete them), then replaces the database and the uploaded files. If it fails before
changing anything, the app starts again unchanged. If it stops partway, the app stays
stopped and updates pause until a restore succeeds.

On a new server: run `install.sh`, copy the old `backups/` folder into `/opt/carehub`,
start Care Hub, then restore.

## Old image versions

Nothing deletes old images automatically. Each build of `main` adds a version to the
GHCR package; delete old ones by hand in the package settings on GitHub (keep the
published version numbers). On the server, free space by hand with
`sudo docker image prune`.
