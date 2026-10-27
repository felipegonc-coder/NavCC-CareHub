// @ts-check
// A throwaway PostgreSQL for the browser tests in CI, from the npm package embedded-postgres
// (decision 0006): no Docker, no system install, no sudo, and everything stays in <folder>.
// The user, port and database come from DATABASE_URL; anyone on 127.0.0.1 may connect without a
// password, so use it for fictional data only.
// Usage: node tests/e2e/ci/postgres.mjs start|stop <folder>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The settings in a postgres:// URL.
 *
 * @param {string} url
 * @returns {{ user: string, port: number, database: string }}
 */
export function settingsFrom(url) {
  const { username, port, pathname } = new URL(url);
  const user = decodeURIComponent(username) || 'postgres';
  return {
    user,
    port: Number(port || 5432),
    database: decodeURIComponent(pathname.slice(1)) || user,
  };
}

/**
 * The lines added to postgresql.conf: only 127.0.0.1, the socket in <folder>, and no fsync,
 * because the data is thrown away.
 *
 * @param {number} port
 * @param {string} socketFolder
 */
export function configLines(port, socketFolder) {
  const quoted = `'${socketFolder.replace(/'/g, "''")}'`;
  return [
    "listen_addresses = '127.0.0.1'",
    `port = ${port}`,
    `unix_socket_directories = ${quoted}`,
    'fsync = off',
    'synchronous_commit = off',
    'full_page_writes = off',
  ];
}

/** The paths of initdb, pg_ctl and postgres in the package for this platform. */
async function binaries() {
  const name = `@embedded-postgres/${process.platform}-${process.arch}`;
  /** @type {{ initdb: string, pg_ctl: string, postgres: string }} */
  const bin = await import(name);
  // npm install --ignore-scripts skips the package's postinstall, which restores the symbolic
  // links of its libraries; it only writes inside the package.
  const folder = path.resolve(path.dirname(bin.initdb), '../..');
  if (fs.existsSync(path.join(folder, 'scripts/hydrate-symlinks.js'))) {
    execFileSync(process.execPath, ['scripts/hydrate-symlinks.js'], {
      cwd: folder,
      stdio: 'inherit',
    });
  }
  return bin;
}

/** @param {string} folder */
async function start(folder) {
  const { user, port, database } = settingsFrom(
    process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres',
  );
  const data = path.join(folder, 'data');
  const bin = await binaries();
  const run = (/** @type {string} */ file, /** @type {string[]} */ args, input = '') =>
    execFileSync(file, args, { input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
    fs.mkdirSync(folder, { recursive: true });
    run(bin.initdb, [
      '--pgdata',
      data,
      '--username',
      user,
      '--auth',
      'trust',
      '--encoding',
      'UTF8',
      '--no-locale',
    ]);
    fs.appendFileSync(
      path.join(data, 'postgresql.conf'),
      `\n${configLines(port, folder).join('\n')}\n`,
    );
    if (database !== 'postgres') {
      const name = `"${database.replace(/"/g, '""')}"`;
      // Single-user mode, before the server runs: no client program is needed.
      run(
        bin.postgres,
        ['--single', '-D', data, '-c', 'exit_on_error=on', 'postgres'],
        `CREATE DATABASE ${name};\n`,
      );
    }
  }
  run(bin.pg_ctl, [
    'start',
    '--pgdata',
    data,
    '--wait',
    '--timeout',
    '60',
    '--log',
    path.join(folder, 'postgres.log'),
  ]);
  console.log(`PostgreSQL is running on 127.0.0.1:${port}, database ${database}, user ${user}.`);
}

/** @param {string} folder */
async function stop(folder) {
  const data = path.join(folder, 'data');
  if (!fs.existsSync(path.join(data, 'postmaster.pid'))) {
    console.log('PostgreSQL is not running.');
    return;
  }
  const bin = await binaries();
  execFileSync(bin.pg_ctl, ['stop', '--pgdata', data, '--mode', 'fast', '--wait'], {
    stdio: 'inherit',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, folder] = process.argv.slice(2);
  if ((command !== 'start' && command !== 'stop') || !folder) {
    console.error('Usage: node tests/e2e/ci/postgres.mjs start|stop <folder>');
    process.exitCode = 2;
  } else {
    await (command === 'start' ? start : stop)(path.resolve(folder));
  }
}
