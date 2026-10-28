# Performance: the load test

Care Hub handles the whole team, about 30 people at once, with pages opening in about a second
([feature list](../../docs/plan/feature-list.md); the specs' speed targets assume the ThinkCentre
with about 30 people at once). The load test checks that: [`run.mjs`](run.mjs), which uses only
Node's built-in modules.

## What it does

Each simulated person, one every half second over the first 15 seconds:

1. **First visit:** the HTML and every file it loads, with nothing cached.
2. **Sign-in** with a fictional test account. The people take turns with the seeded accounts
   (30 people on 4 accounts), or with the ones in `--accounts`; every account must end in
   `@example.test`.
3. **App start:** the HTML, who's signed in, and the sidebar (`GET /api/spaces` and each space's
   tree).
4. Until the run ends, with a pause of 1 to 3 seconds between actions, like someone reading:
   **page open** (a page from the sidebar, `GET /api/pages/:id`), **search** (a word from a page
   title; half the time it opens a result), the **sidebar** again, or a reload (**app start**).

First it signs in once to find out what the build has. A step whose route answers 404 isn't built
yet: it is skipped and listed in the report. With fewer than 10 pages to open, it adds fictional
ones, such as "Shift notes (load test 4)", to the first space.

## Budget

- **Page open:** p95 at most 1 second (`--budget <ms>`).
- **No errors:** no step refused (4xx) and no server error (5xx, a dropped connection, or no answer
  within 10 seconds).

The report has p50, p95 and the slowest time for each step, what was skipped, each problem with
its route (never an ID), and what the first visit downloaded. Exit code 0: within the budget; 1:
over it or with errors; 2: the test couldn't run (an option, no server, or sign-in refused).

## Running it

Only against a test copy with its own empty database, never the Care Hub people use. On the
ThinkCentre, in a checkout of the version to test, with Node 24 (or in
`docker run --rm -it --network host -v "$PWD:/app" -w /app node:24 bash`):

```sh
npm ci --ignore-scripts && npm run build
db_password=$(openssl rand -hex 24)
docker run -d --rm --name carehub-load-db -p 127.0.0.1:55433:5432 -e POSTGRES_USER=carehub \
  -e POSTGRES_PASSWORD="$db_password" -e POSTGRES_DB=carehub postgres:17
export DATABASE_URL="postgres://carehub:$db_password@127.0.0.1:55433/carehub"
export CAREHUB_SEED_PASSWORD=$(openssl rand -hex 24)
node apps/server/dist/cli.js seed
NODE_ENV=production CAREHUB_PUBLIC_URL=http://127.0.0.1:38080 PORT=38080 HOST=127.0.0.1 \
  COOKIE_SECURE=false node apps/server/dist/index.js > server.log 2>&1 &
node scripts/load/run.mjs --url http://127.0.0.1:38080 --report load-report
kill %1 && docker stop carehub-load-db
```

`node scripts/load/run.mjs --help` lists the options (people, seconds, ramp, pause, budget,
accounts, report folder).

## Results

| Date | Where | Build | People | Page open p50 / p95 | Errors | Notes |
| ---- | ----- | ----- | ------ | ------------------- | ------ | ----- |
