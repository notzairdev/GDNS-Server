import {
  clearLoginFailures,
  clearSessionCookie,
  createSessionCookie,
  isAuthorized,
  isLoginLocked,
  isValidApiToken,
  recordLoginFailure,
} from '../auth.js';

export function registerSessionRoutes(app) {
  app.get('/api/session', async (request) => ({
    authenticated: isAuthorized(request),
  }));

  app.post('/api/session', async (request, reply) => {
    const body = request.body || {};
    const token = String(body.token || '').trim();

    if (isLoginLocked(request)) {
      reply.status(429).send({ error: 'too_many_attempts' });
      return;
    }

    if (!isValidApiToken(token)) {
      recordLoginFailure(request);
      reply.status(401).send({ error: 'unauthorized' });
      return;
    }

    clearLoginFailures(request);
    reply
      .header('set-cookie', createSessionCookie(request))
      .send({ authenticated: true });
  });

  app.delete('/api/session', async (request, reply) => {
    reply
      .header('set-cookie', clearSessionCookie())
      .send({ authenticated: false });
  });
}
