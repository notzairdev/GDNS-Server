import cors from '@fastify/cors';
import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';

import { initDb } from './db/client.js';
import { isAuthorized } from './auth.js';
import { registerApkRoutes } from './routes/apk.js';
import { registerBlocklistRoutes } from './routes/blocklists.js';
import { registerEventRoutes } from './routes/events.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerStatusRoutes } from './routes/status.js';

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

export async function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  await app.register(cors, {
    origin: false,
  });

  initDb();

  app.addHook('preHandler', async (request, reply) => {
    const isPublicSessionRoute = request.url.startsWith('/api/session');
    if (request.url.startsWith('/api/') && !isPublicSessionRoute && !isAuthorized(request)) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    return undefined;
  });

  registerHealthRoutes(app);
  registerApkRoutes(app);
  registerSessionRoutes(app);
  registerBlocklistRoutes(app);
  registerProfileRoutes(app);
  registerStatusRoutes(app);
  registerEventRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'bad_request',
      message: error.message,
    });
  });

  return app;
}

export async function startServer() {
  const app = await buildApp();
  await app.listen({ host, port });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
