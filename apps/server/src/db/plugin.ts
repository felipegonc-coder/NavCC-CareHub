import fp from 'fastify-plugin';
import { createDatabase, type Db } from './client';
import { runMigrations } from './migrate';

declare module 'fastify' {
  interface FastifyInstance {
    /** The Drizzle database (PostgreSQL). */
    db: Db;
  }
}

export interface DatabasePluginOptions {
  databaseUrl: string;
  migrationsDir?: string | undefined;
}

/** Decorates `app.db`, applies pending migrations at start-up and closes the pool on `app.close()`. */
export const databasePlugin = fp<DatabasePluginOptions>(
  async (app, options) => {
    const connection = createDatabase(options.databaseUrl, (error) =>
      app.log.error({ err: error }, 'database connection error'),
    );
    try {
      await runMigrations(connection.pool, {
        dir: options.migrationsDir,
        log: (message) => app.log.info(message),
      });
    } catch (error) {
      await connection.close();
      throw error;
    }
    app.decorate('db', connection.db);
    app.addHook('onClose', () => connection.close());
  },
  { name: 'carehub-database', fastify: '5.x' },
);
