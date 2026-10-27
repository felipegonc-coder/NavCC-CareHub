import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthResponse } from '@carehub/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';

export interface BuildAppOptions {
  config: Config;
  /** Fastify logger settings. Off unless given. */
  logger?: FastifyServerOptions['logger'];
}

const API_PATH = /^\/api(?:[/?#]|$)/;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: config.CAREHUB_VERSION,
  }));

  // Each feature replaces only its own line below with one lazy registration, for example
  // `await app.register(import('./features/auth/routes'), { prefix: '/api/auth' });`,
  // so parallel pull requests never edit the same lines.

  // feature: auth

  // feature: admin

  // feature: workspaces

  // feature: pages

  // feature: collab

  // feature: comments

  // feature: files

  // feature: search

  await app.register(import('./features/learning/routes'), { prefix: '/api/learning' });

  // feature: databases

  // feature: messages

  // feature: calendar

  // The web app: files from the built SPA, with index.html for every other page route.
  await app.register(fastifyStatic, { root: config.WEB_DIST_DIR });
  const indexHtml = join(config.WEB_DIST_DIR, 'index.html');

  app.setNotFoundHandler((request, reply) => {
    if (isPageRoute(request.method, request.url) && existsSync(indexHtml)) {
      reply.sendFile('index.html');
      return;
    }
    reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
    });
  });

  return app;
}

/** A GET or HEAD outside /api whose last path segment has no file extension. */
function isPageRoute(method: string, url: string): boolean {
  if ((method !== 'GET' && method !== 'HEAD') || API_PATH.test(url)) return false;
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return !path.slice(path.lastIndexOf('/') + 1).includes('.');
}
