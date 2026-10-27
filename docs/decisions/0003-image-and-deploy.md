# 0003: Docker image and single-server deploy

- **Status:** proposed (2026-10-26; revised 2026-10-27 for #10 and #15, then for the deploy plan: build on the server, tailnet only)
- **Context:** Care Hub runs on one small server, reachable only over Tailscale. It needs HTTPS (a `*.ts.net` name), PostgreSQL, uploaded files, backups that are known to restore, and updates that happen only when a person decides. CI has to stay within 2,000 free minutes a month (0006). No credentials of the shared GitHub account may end up on the server, and nothing should be exposed that doesn't have to be (#10, #15).

## Decision

1. **The server builds its own image.** It clones the repository with a read-only deploy key, checks out a version that passed CI on `main`, and `deploy/up.sh` runs `docker compose up --build`. No registry login, nothing is published: CI has no `packages: write`. A pulled image stays a documented option for later.
2. **One image** (`Dockerfile`): the server bundle with its production dependencies, the built web app, migrations, `LICENSE` and `THIRD_PARTY_NOTICES.md`, on port 3000, with a health check on `/api/health`. `up.sh` passes `CAREHUB_VERSION` (`git describe`) and `CAREHUB_BUILD_DATE` for the Status page.
3. **`image.yml` runs only on request:** by hand and on pull requests labelled `image`. It checks the deploy rules below in `docker-compose.yml` and the `Dockerfile`, builds the image and tests the deploy as a server runs it: `install.sh`, `up.sh`, HTTPS through Caddy, a backup asked for like the Status page does, and `restore.sh`.
4. **Data in `CAREHUB_DATA_DIR`** (default `/srv/carehub`): `postgres/`, `files/`, `backups/` and `caddy/` as bind mounts, owned by one service user (`carehub`), mode 700. The secrets are in `deploy/.env` (root only, mode 600), which `install.sh` creates.
5. **Tailnet only:** Caddy publishes ports 80 and 443 only on the server's Tailscale address and gets the `*.ts.net` certificate from tailscaled. The app and PostgreSQL publish no ports. PostgreSQL uses `scram-sha-256` for every connection, never `trust`. The firewall denies all inbound traffic; SSH only over Tailscale.
6. **Containers** run as the service user, never root, with `no-new-privileges` and without the Docker socket. Base images (`node`, `postgres`, `caddy`) are pinned by digest and bumped by hand in a pull request.
7. **Updates and rollbacks are manual:** `up.sh` builds while the old version runs, backs up, starts the new version (the app runs its migrations at start) and checks its health. A rollback checks out the previous version and runs `up.sh`, or `restore.sh` with the backup from before the update when the database changed.
8. **Backups:** `pg_dump` and a tar of the files daily, before each update and on request, kept 30 days. A backup counts only after it was restored into a scratch database and the archive was read back. The app sees only the results (`backups/status/`), never the backup files. One backup runs at a time, a request less than 60 minutes after the last run is ignored, and a backup doesn't start with less free space than twice the last one.

## Consequences

- A merged change reaches the server only when a person checks it out and runs `up.sh`. Building takes a few minutes and some disk space on the server; old images and build cache are removed by hand.
- Node, PostgreSQL and Caddy fixes arrive only when someone bumps the digests.
- `image.yml` costs runner minutes only when someone asks for a run.
- The deploy needs a few host steps that scripts only check: the service user, `TS_PERMIT_CERT_UID`, `net.ipv4.ip_nonlocal_bind = 1` (so Docker can bind the Tailscale address at boot) and the firewall.
- Backups sit on the same server, unencrypted, until someone copies them off encrypted (age or gpg, by hand). Automating that comes later.
