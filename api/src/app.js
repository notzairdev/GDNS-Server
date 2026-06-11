import cors from '@fastify/cors';
import Fastify from 'fastify';

import { initDb } from './db/client.js';
import { isAuthorized } from './auth.js';
import { registerBlocklistRoutes } from './routes/blocklists.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProfileRoutes } from './routes/profiles.js';

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

await app.register(cors, {
  origin: false,
});

initDb();

app.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/api/') && !isAuthorized(request)) {
    return reply.status(401).send({ error: 'unauthorized' });
  }

  return undefined;
});

registerHealthRoutes(app);
registerBlocklistRoutes(app);
registerProfileRoutes(app);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode || 500;
  reply.status(statusCode).send({
    error: statusCode >= 500 ? 'internal_error' : 'bad_request',
    message: error.message,
  });
});

await app.listen({ host, port });
