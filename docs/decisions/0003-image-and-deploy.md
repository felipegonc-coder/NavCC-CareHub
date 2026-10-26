# 0003: Docker image and single-server deploy

- **Status:** proposed (2026-10-26)
- **Context:** Care Hub runs on one small server. It needs HTTPS (usually a Tailscale `*.ts.net` name), PostgreSQL, uploaded files, nightly backups that are known to restore, and updates without anyone logging in. CI has to stay within 2,000 free minutes a month (0006).

## Decision

1. **One image** (`Dockerfile`, linux/amd64): the server bundle with its production dependencies, the built web app, migrations, `LICENSE` and `THIRD_PARTY_NOTICES.md`. It runs as `node` on port 3000, with a health check on `/api/health`.
2. **GHCR tags:** `latest` and `sha-<commit>` in `ghcr.io/felipegonc-coder/navcc-carehub`.
3. **`image.yml` runs only** daily at 04:00 UTC on `main` (skipped when the commit already has an image), by hand, and on pull requests labelled `image` (build and smoke test, never push). A pull request that changes only `deploy/` is validated without a build.
4. **Deploy** (`deploy/`): Docker Compose with the app, `postgres:17`, `caddy:2` and a backup service. A systemd timer pulls `latest` every 15 minutes. A `sha-` tag in `.env` holds or rolls back a version.
5. **Backups:** `pg_dump` and a tar of the files every night, kept 30 days. A backup counts only after it was restored into a scratch database and the archive was read back. `restore.sh` saves the current data first and swaps the database in by renaming.
6. **Nothing deletes old image versions automatically**, in CI or on the server.

## Consequences

- A merged change reaches the server within about a day, or right away after a manual run.
- The daily check costs about 30 runner minutes a month, plus a few minutes per new image.
- Old versions pile up in GHCR and on the server until someone removes them.
- Backups sit on the same server; copying them elsewhere is still a manual step.
