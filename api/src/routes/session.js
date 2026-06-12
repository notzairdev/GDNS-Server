import { clearSessionCookie, createSessionCookie, isAuthorized, isValidApiToken } from '../auth.js';

export function registerSessionRoutes(app) {
  app.get('/api/session', async (request) => ({
    authenticated: isAuthorized(request),
  }));

  app.post('/api/session', async (request, reply) => {
    const body = request.body || {};
    const token = String(body.token || '').trim();

    if (!isValidApiToken(token)) {
      reply.status(401).send({ error: 'unauthorized' });
      return;
    }

    reply
      .header('set-cookie', createSessionCookie())
      .send({ authenticated: true });
  });

  app.delete('/api/session', async (request, reply) => {
    reply
      .header('set-cookie', clearSessionCookie())
      .send({ authenticated: false });
  });
}
