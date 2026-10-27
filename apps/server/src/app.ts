import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthResponse } from '@carehub/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import { DEFAULT_ERROR_MESSAGES, errorBody, errorHandler } from './core/errors';
import { registerEvents } from './core/events';
import { databasePlugin } from './db';
import { authPlugin } from './features/auth/plugin';

export interface BuildAppOptions {
  config: Config;
  /** Fastify logger settings. Off unless given. */
  logger?: FastifyServerOptions['logger'];
}

const API_PATH = /^\/api(?:[/?#]|$)/;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({ logger: options.logger ?? false });
  registerEvents(app);

  // Errors are { error: { code, message } } (decision 0007, section 2.2).
  app.setErrorHandler(errorHandler);
  await app.register(databasePlugin, { databaseUrl: config.DATABASE_URL });
  // Every /api route after this needs a signed-in user unless it sets config: { public: true }.
  await app.register(authPlugin, {
    cookieSecure: config.COOKIE_SECURE,
    publicUrl: config.CAREHUB_PUBLIC_URL,
  });

  app.get('/api/health', { config: { public: true } }, async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: config.CAREHUB_VERSION,
  }));

  // Each feature replaces only its own line below with one lazy registration, for example
  // `await app.register(import('./features/auth/routes'), { prefix: '/api/auth' });`,
  // so parallel pull requests never edit the same lines.

  await app.register(import('./features/auth/routes'), { prefix: '/api/auth' });

  // feature: admin

  // feature: workspaces

  // feature: pages

  // feature: collab

  // feature: comments

  // feature: mentions

  // feature: files

  // feature: search

  // feature: history

  // feature: templates

  // feature: import-export

  // feature: sharing

  // feature: roles

  // feature: learning

  // feature: databases

  // feature: forms

  // feature: messages

  // feature: notices

  // feature: live

  // feature: push

  // feature: jobs

  // feature: reminders

  // feature: home

  // feature: calendar

  // feature: meetings

  // feature: automations

  // feature: analytics

  await app.register(import('./features/status/routes'), { prefix: '/api/status' });

  // feature: claude

  // The web app: files from the built SPA, with index.html for every other page route.
  await app.register(fastifyStatic, { root: config.WEB_DIST_DIR });
  const indexHtml = join(config.WEB_DIST_DIR, 'index.html');

  app.setNotFoundHandler((request, reply) => {
    if (isPageRoute(request.method, request.url) && existsSync(indexHtml)) {
      reply.sendFile('index.html');
      return;
    }
    reply.code(404).send(errorBody('not_found', DEFAULT_ERROR_MESSAGES.not_found));
  });

  // Added last so it runs first on close: running event handlers finish before features and the
  // database shut down.
  app.addHook('onClose', () => app.events.settled());

  return app;
}

/** A GET or HEAD outside /api whose last path segment has no file extension. */
function isPageRoute(method: string, url: string): boolean {
  if ((method !== 'GET' && method !== 'HEAD') || API_PATH.test(url)) return false;
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return !path.slice(path.lastIndexOf('/') + 1).includes('.');
}
