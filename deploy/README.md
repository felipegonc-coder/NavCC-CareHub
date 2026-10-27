# Deploying Care Hub

One server runs Care Hub with Docker Compose: the app, PostgreSQL 17, Caddy for HTTPS and a
backup service. The server builds the app image itself from a checkout of this repository;
nothing is published to a registry. Care Hub is reachable only over Tailscale. Why it looks
like this: [docs/decisions/0003-image-and-deploy.md](../docs/decisions/0003-image-and-deploy.md).

A person or an AI assistant (for example Claude Code, running as a normal user with `sudo`)
can follow these steps. Commands run on the server, in the checkout `/opt/carehub`, unless a
step says otherwise.

> **For AI assistants:** ask the person before anything that needs their decision or access:
> adding the deploy key on GitHub, choosing the version, the firewall, a restore and a
> rollback. Use `--confirmed` only after they agreed. Never show the contents of
> `deploy/.env`; it holds the secrets.

## Before the first deploy

- The first deploy is Felipe's call, on a server prepared as in [Prerequisites](#prerequisites).
- Backups stay on the server until someone copies them off. Encrypting and copying them is a
  manual step for now ([Copying backups off the server](#copying-backups-off-the-server));
  automating it comes later.
- `image.yml` posts its own report comment until `scripts/ci-report.mjs` accepts a report
  name. That doesn't block a deploy.
- The Team tools settings in `.env` (Google Calendar, web push, Claude, transcription) are
  optional. Each missing value turns off only that feature.

## Files

| File                 | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `docker-compose.yml` | The services `app`, `db`, `caddy` and `backup`                                    |
| `.env.example`       | Every setting with a placeholder; `install.sh` turns it into `.env`               |
| `Caddyfile`          | HTTPS for `CAREHUB_DOMAIN`, passed on to the app                                  |
| `install.sh`         | Creates `.env` with this server's values and random secrets, and the data folders |
| `up.sh`              | Builds the image, backs up, starts or updates Care Hub, checks its health         |
| `backup.sh`          | Daily and requested backups; runs inside the `backup` service                     |
| `restore.sh`         | Puts a backup back                                                                |

## Prerequisites

A Linux server (Ubuntu 24.04 LTS is assumed below) with:

1. **Docker Engine and the Compose plugin** from Docker's repository
   ([docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)).
   Check: `docker compose version`. Use `sudo docker ...`; don't add users to the `docker`
   group, which amounts to root.
2. **git and curl:** `sudo apt-get install -y git curl`
3. **Tailscale** ([tailscale.com/kb/1031/install-linux](https://tailscale.com/kb/1031/install-linux)),
   logged in to the tailnet, with MagicDNS and HTTPS certificates turned on in the admin
   console (DNS page). Check: `tailscale ip -4` prints a `100.x.y.z` address.
4. **The service user**, which owns the data and runs every container:

   ```sh
   sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin carehub
   ```

5. **Let Caddy get the HTTPS certificate.** Caddy runs as `carehub`, and tailscaled gives
   certificates only to root and the user in `TS_PERMIT_CERT_UID`. If you're connected over
   Tailscale, the restart may drop the session for a few seconds.

   ```sh
   echo 'TS_PERMIT_CERT_UID=carehub' | sudo tee -a /etc/default/tailscaled
   sudo systemctl restart tailscaled
   ```

6. **Let Docker bind the Tailscale address at boot**, before Tailscale is up:

   ```sh
   echo 'net.ipv4.ip_nonlocal_bind = 1' | sudo tee /etc/sysctl.d/60-carehub.conf
   sudo sysctl --system
   ```

7. **Firewall: deny everything inbound, SSH only over Tailscale.** Connect over Tailscale
   first (`ssh <you>@<server>.<tailnet>.ts.net`), or you lock yourself out. Tailscale needs no
   inbound rule. If the hosting provider has a firewall too, deny all inbound there as well.

   ```sh
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   sudo ufw enable
   sudo ufw status verbose
   ```

   Ports that Docker publishes bypass ufw. That's why Caddy publishes its ports only on the
   Tailscale address (`CAREHUB_TAILSCALE_IP`) and the app and PostgreSQL publish none.

## First start

1. **A read-only deploy key.** The server clones with a key of its own, never with a
   person's or a shared account's token.

   ```sh
   install -d -m 700 ~/.ssh
   ssh-keygen -t ed25519 -N '' -C 'carehub server' -f ~/.ssh/carehub_deploy
   cat ~/.ssh/carehub_deploy.pub
   ```

   A repository admin adds that line on GitHub: the repository > Settings > Deploy keys >
   Add deploy key, with **Allow write access** off.

2. **Trust GitHub's host key.** The fingerprint must be
   `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`, as published in GitHub's docs
   ("GitHub's SSH key fingerprints"). If it isn't, stop.

   ```sh
   ssh-keyscan -t ed25519 github.com > /tmp/github.key && ssh-keygen -lf /tmp/github.key
   cat /tmp/github.key >> ~/.ssh/known_hosts && rm /tmp/github.key
   ```

3. **Clone into `/opt/carehub`**, owned by you:

   ```sh
   sudo install -d -o "$USER" -g "$USER" /opt/carehub
   GIT_SSH_COMMAND="ssh -i $HOME/.ssh/carehub_deploy -o IdentitiesOnly=yes" \
     git clone git@github.com:felipegonc-coder/NavCC-CareHub.git /opt/carehub
   cd /opt/carehub
   git config core.sshCommand "ssh -i $HOME/.ssh/carehub_deploy -o IdentitiesOnly=yes"
   ```

4. **Check out a version that passed CI on `main`**: a tag, or a commit of `main` whose CI
   run is green (and whose Image run is green, if it changed the image or `deploy/`). Which
   version is Felipe's call.

   ```sh
   git checkout <tag or commit>
   ```

5. **Install**, with the server's full Tailscale name (admin console > Machines, or the first
   `DNSName` in `tailscale status --json`, without the final dot):

   ```sh
   sudo ./deploy/install.sh carehub.tail1234.ts.net
   ```

   It creates `deploy/.env` (root only, mode 600) with a random database password and
   `CALENDAR_SECRET_KEY`, and the data folders. It warns if step 5 or 6 of the prerequisites
   is missing. It never overwrites an existing `.env`, so it's safe to run again.

6. **Team tools (optional):** fill in that block of `deploy/.env` (`sudo nano deploy/.env`)
   when those features are wanted. `docs/team/settings.md` has the command for the web push
   keys.

7. **Start:**

   ```sh
   sudo ./deploy/up.sh
   ```

   The first build takes several minutes. It ends with
   `Care Hub is up at https://<name>: {"status":"ok",...}`.

8. **Check** from a device on the tailnet: open `https://<name>`, or
   `curl https://<name>/api/health`, which answers `{"status":"ok","version":"..."}`. On the
   server, `sudo docker compose ps` in `deploy/` shows the four services running, `app` and
   `db` healthy.

After a reboot everything starts by itself (`restart: unless-stopped`).

## Where the data lives

Everything is in `CAREHUB_DATA_DIR` (default `/srv/carehub`). Each folder belongs to
`carehub` and has mode 700.

| Path                 | What                                                       | Used by                                       |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `postgres/`          | The database                                               | `db`                                          |
| `files/`             | Uploaded files                                             | `app`, `backup`                               |
| `backups/`           | The backups and `pre-restore-*`                            | `backup` only                                 |
| `backups/status/`    | `status.json`, `runs/` and `requests/` for the Status page | `backup`; `app` read-only, except `requests/` |
| `caddy/`             | Caddy's certificates and state                             | `caddy`                                       |
| `restore-incomplete` | Only after a restore stopped partway; says what to do      | `up.sh`, `restore.sh`                         |

The settings and secrets are in `deploy/.env` in the checkout (root only). Everything else
in the checkout comes from git.

## Day to day

In `/opt/carehub/deploy`:

```sh
sudo docker compose ps                 # what runs, and whether it is healthy
sudo docker compose logs -f app        # app logs (also db, caddy, backup)
sudo ./restore.sh                      # lists the finished backups
sudo cat /srv/carehub/backups/status/status.json   # the last backup
```

## Updating

Updates happen only when a person runs them (or asks an assistant to); nothing updates by
itself.

1. Pick the version as in [First start](#first-start), step 4, and read what changed.
2. Update:

   ```sh
   cd /opt/carehub
   git fetch --tags origin
   git checkout <tag or commit>
   sudo ./deploy/up.sh
   ```

   `up.sh` builds the new image while the old version keeps running, then backs up the
   database and the files (it stops, changing nothing, if the backup fails), starts the new
   version and waits until it's healthy, and checks `https://<name>/api/health`. The app runs
   its database migrations when it starts. `up.sh` prints the backup's STAMP and, if
   something fails, how to go back.

3. Check that `/api/health` (and the Status page) shows the version you checked out.

### Rolling back

- **Code only**, when the new version didn't change the database:

  ```sh
  git checkout <previous version>
  sudo ./deploy/up.sh
  ```

- **Code and data**, when it did or you aren't sure. This puts back the database and the
  files from just before the update; changes made since are lost.

  ```sh
  git checkout <previous version>
  sudo ./deploy/restore.sh <STAMP that up.sh printed>
  ```

  `restore.sh` restores first and only then builds and starts the checked-out version, so
  the newer version never runs on the restored data.

Every Image run in CI tests this path on a fresh runner: `install.sh`, `up.sh`, a backup and
`restore.sh`. Still, try a rollback once after the first update, before you need one.

### Base images

`Dockerfile` (`node:24`, `node:24-slim`) and `docker-compose.yml` (`postgres:17`, `caddy:2`)
pin their base images by digest (`@sha256:...`). Nothing bumps them automatically. About once
a month, or after a security announcement, bump them in a pull request:

```sh
docker buildx imagetools inspect postgres:17 | sed -n 's/^Digest: *//p'
```

Then update the server as above. Keep the major versions: moving to another PostgreSQL major
version needs a dump and restore, not only a new digest.

### Old images

`up.sh` never deletes images. Each build leaves the previous image and some build cache.
`sudo docker system df` shows the space used; `sudo docker image prune` and
`sudo docker builder prune --filter until=720h` free it by hand.

### A pulled image instead (optional)

Nothing publishes an image today. If one is published later, the server can run it instead
of building: put this in `deploy/docker-compose.override.yml` (it stays on the server), then
each time run `sudo docker compose pull app` in `deploy/` and `sudo ./deploy/up.sh --no-build`.

```yaml
services:
  app:
    image: ghcr.io/<owner>/<name>@sha256:<digest>
```

For a private registry, `sudo docker login` with a read-only token made for this server,
never a person's or a shared account's token.

## Backups

- **When:** daily at `BACKUP_AT` (02:00, in `TZ`), at the start of every `up.sh`, and when an
  admin asks on the Status page.
- **What:** a `pg_dump -Fc` of the database and a tar of `files/`: `carehub-STAMP.db.dump`,
  `carehub-STAMP.files.tar.gz` and `carehub-STAMP.sha256` in `backups/`. STAMP is the UTC
  start time, for example `20261027T080000Z`.
- **Checked:** a backup is finished only once its `.sha256` exists. That file is written after
  the dump was restored into a scratch database (with as many tables as the dump lists, and
  the rows counted) and the archive was read back.
- **Kept** `BACKUP_KEEP_DAYS` (30) days.
- **Limits:** one backup or restore at a time. A request less than 60 minutes after the last
  run is ignored. A backup doesn't start with less free space than twice the last one; that
  run is recorded as `Not run: only N MB are free ...`.

### Copying backups off the server

The backups on the server aren't encrypted and are lost with the server. Copy them off by
hand, encrypted, for example once a week. With [age](https://age-encryption.org)
(`sudo apt-get install -y age`):

1. **Once, on a computer that isn't the server** (offline if you can): `age-keygen -o carehub-backup.key`.
   It prints the public key, `age1...`. Keep `carehub-backup.key` offline and in a second safe
   place: without it the copies can't be read. Only the public key goes to the server.
2. **On the server**, for a STAMP from `sudo ./deploy/restore.sh`:

   ```sh
   sudo tar -C /srv/carehub/backups -cf - carehub-STAMP.db.dump carehub-STAMP.files.tar.gz carehub-STAMP.sha256 \
     | age -r age1... > ~/carehub-STAMP.tar.age
   ```

3. **From the other computer**, over Tailscale, then delete the copy on the server:

   ```sh
   scp <you>@<server>.<tailnet>.ts.net:carehub-STAMP.tar.age .
   ssh <you>@<server>.<tailnet>.ts.net rm carehub-STAMP.tar.age
   age -d -i carehub-backup.key carehub-STAMP.tar.age | tar -tvf -   # lists the three files
   ```

With gpg instead of age: import only the public key on the server, use
`gpg --encrypt --recipient <key>` in step 2 and `gpg --decrypt` in step 3.

To restore such a copy (on a new server, after `install.sh`): decrypt it on the computer
with the key (`age -d -i carehub-backup.key carehub-STAMP.tar.age > carehub-STAMP.tar`), copy
the `.tar` to the server over Tailscale, then:

```sh
sudo tar -C /srv/carehub/backups -xf carehub-STAMP.tar
sudo chown "$(id -u carehub):$(id -g carehub)" /srv/carehub/backups/carehub-STAMP.*
rm carehub-STAMP.tar
sudo ./deploy/restore.sh STAMP
```

## Status page

Rules for the app's Status page:

- **Admins only**, checked on the server.
- **Results:** `/data/backups/status.json` (the last run) and `/data/backups/runs/STAMP.json`
  (one per run): `{startedAt, finishedAt, ok, dbBytes, filesBytes, restoreTest: {ok, checkedAt, details}}`.
  Times are UTC ISO 8601. After a failure the sizes are `null` and `details` gives the reason.
- **Asking for a backup:** create `/data/backups/requests/now`. The backup service looks every
  30 seconds. A request less than 60 minutes after the last run's `finishedAt` is dropped, so
  show when the next one is possible instead of the button.
- The app sees only `backups/status/`, never the backup files.
- **Version and build date:** the `CAREHUB_VERSION` and `CAREHUB_BUILD_DATE` environment
  variables, which `up.sh` sets when it builds the image.

## Restore

`sudo ./deploy/restore.sh` lists the finished backups. `sudo ./deploy/restore.sh latest` (or
a STAMP) asks you to type `RESTORE`, then:

1. stops the app and the backup service;
2. saves the current data as `backups/pre-restore-<UTC time>.*`;
3. checks the backup's checksums, restores the database into a temporary database and swaps
   it in by renaming, in one transaction, then replaces the files;
4. builds and starts the version checked out now with `up.sh` (`--no-build` skips the build).

If it fails before changing anything, Care Hub runs on as before (exit 2). If it stops
partway, Care Hub stays stopped and `up.sh` refuses to start until
`sudo ./deploy/restore.sh STAMP` succeeds; `restore-incomplete` in the data folder says so.
`--confirmed` skips the question, for scripts and assistants, only once the person in charge
agreed.

## Security summary

- **Tailnet only:** Caddy publishes ports 80 and 443 only on `CAREHUB_TAILSCALE_IP`. The app
  (3000) and PostgreSQL (5432) only `expose` their ports to the compose network. The firewall
  denies all inbound traffic, and SSH is allowed only on `tailscale0`.
- **HTTPS:** the `*.ts.net` certificate comes from tailscaled through the read-only
  `/var/run/tailscale` mount.
- **PostgreSQL** wants a password (`scram-sha-256`) on every connection, local ones too; never
  `trust`.
- **Containers** run as `carehub` (`CAREHUB_UID:CAREHUB_GID`), never root, with
  `no-new-privileges`. None gets the Docker socket.
- **Secrets** are only in `deploy/.env` (root only, mode 600), which git ignores.
- **Base images** are pinned by digest and bumped by hand.
