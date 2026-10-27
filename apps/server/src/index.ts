import { buildApp } from './app';
import { loadConfig } from './config';
import { serializeRequest } from './core/request-log';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
// Request lines leave out link codes and query values (core/request-log.ts).
const app = await buildApp({ config, logger: { serializers: { req: serializeRequest } } });

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  // Let open requests finish, but never hang forever.
  setTimeout(() => {
    app.log.error('shutdown timed out');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'error while shutting down');
    process.exitCode = 1;
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
