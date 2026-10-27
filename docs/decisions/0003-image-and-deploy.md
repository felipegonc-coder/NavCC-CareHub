# 0003: Docker image and single-server deploy

- **Status:** proposed (2026-10-26, revised 2026-10-27 for #10 and #15)
- **Context:** Care Hub runs on one small server. It needs HTTPS (usually a Tailscale `*.ts.net` name), PostgreSQL, uploaded files, nightly backups that are known to restore, and updates that happen only when Felipe decides. CI has to stay within 2,000 free minutes a month (0006). Only `main` may publish images (#10), and the server should be reachable only where it must be (#15).

## Decision

1. **One image** (`Dockerfile`, linux/amd64): the server bundle with its production dependencies, the built web app, migrations, `LICENSE` and `THIRD_PARTY_NOTICES.md`. It runs as `node` on port 3000, with a health check on `/api/health`.
2. **GHCR tags** in `ghcr.io/felipegonc-coder/navcc-carehub`: `latest` and `sha-<commit>` for each build of `main`, and a version such as `0.1.0` when the workflow is run by hand on `main` with that version. An existing version is never overwritten.
3. **`image.yml` runs only** daily at 01:30 UTC on `main` (evening in Denver) (skipped when the commit already has an image), by hand, and on pull requests labelled `image`. A pull request that changes only `deploy/` is validated without a build. There is no push trigger.
4. **Only `main` publishes.** The job that builds and smoke-tests the image has `contents: read` and never logs in to the registry. A separate `publish` job, the only one with `packages: write`, runs only when `github.ref` is `refs/heads/main` and pushes the image that was tested. Pull requests and other branches push nothing.
5. **Deploy** (`deploy/`): Docker Compose with the app, `postgres:17`, `caddy:2` and a backup service. The app image is pinned to a version in `docker-compose.yml`; moving to another version is a pull request and `sudo ./update.sh`. Automatic updates are off (`CAREHUB_AUTO_UPDATE=false`); turned on, the systemd timer pulls newer images in its 03:00 run. `CAREHUB_BIND_ADDRESS` limits Caddy's ports to one address, the tailnet IP for a Tailscale-only server.
6. **Backups:** `pg_dump` and a tar of the files every night, kept 30 days. A backup counts only after it was restored into a scratch database and the archive was read back. Each run writes `backups/runs/<UTC time>.json` and `backups/status.json` for the Status page, which only admins may use and which can ask for a backup through `backups/requests/now`. One backup runs at a time, a request less than 60 minutes after the last run is ignored, and a backup does not start with less free space than twice the last one. The app's user cannot read the backup files. `restore.sh` saves the current data first and swaps the database in by renaming.
7. **Nothing deletes old image versions automatically**, in CI or on the server.

## Consequences

- A merged change reaches the server only after someone publishes a version and moves the pin to it.
- The daily check costs about 30 runner minutes a month, plus a few minutes per new image. The tested image goes to the publish job as a one-day artifact instead of being built twice.
- PostgreSQL and Caddy fixes reach the server only when someone runs `update.sh` or turns on automatic updates.
- Old versions pile up in GHCR and on the server until someone removes them.
- Backups sit on the same server, unencrypted; copying them elsewhere is still a manual step. Encrypting them (for example with age, the key kept offline) comes later.
- With `CAREHUB_BIND_ADDRESS` set, the server needs `net.ipv4.ip_nonlocal_bind = 1` so Docker can bind the tailnet address at boot, before Tailscale is up.
