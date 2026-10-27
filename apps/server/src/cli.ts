// Server commands: `node apps/server/dist/cli.js seed` (decision 0007, section 2.5).
import Fastify from 'fastify';
import { loadConfig } from './config';
import { loggableError } from './core/errors';
import { createDatabase, runMigrations } from './db';
import { SeedRefusal, runSeed, seedSettingsFrom } from './seed';

const USAGE = 'Usage: node apps/server/dist/cli.js seed';
const { log } = Fastify({ logger: true });

/** Applies the migrations, then loads the fictional seed into an empty database. */
async function seed(): Promise<void> {
  const settings = seedSettingsFrom(process.env);
  const config = loadConfig();
  const database = createDatabase(config.DATABASE_URL, (error) =>
    log.error({ err: loggableError(error) }, 'database connection error'),
  );
  try {
    await runMigrations(database.pool, { log: (message) => log.info(message) });
    await runSeed(database.db, { ...settings, log });
    log.info('Seed done');
  } finally {
    await database.close();
  }
}

const commands: Readonly<Record<string, () => Promise<void>>> = { seed };

const [name, ...extra] = process.argv.slice(2);
const command = name !== undefined && Object.hasOwn(commands, name) ? commands[name] : undefined;
if (!command || extra.length > 0) {
  console.error(USAGE);
  process.exitCode = 2;
} else {
  try {
    await command();
  } catch (error) {
    // A refusal says what to do. Anything else is logged without query parameters (loggableError).
    if (error instanceof SeedRefusal) log.error(error.message);
    else log.error({ err: loggableError(error) }, `${name} failed`);
    process.exitCode = 1;
  }
  // Done, even if a feature's seed left a timer running. The logs are written synchronously.
  process.exit();
}
