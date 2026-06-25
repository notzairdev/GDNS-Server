import { listProfileSummaries, profileLogs } from './profiles.js';
import { buildStatus } from './status.js';

function writeEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerEventRoutes(app) {
  app.get('/api/events', (request, reply) => {
    const profileId = String(request.query?.profile_id || '').trim();
    const limit = Math.max(20, Math.min(Number(request.query?.limit || 80), 160));

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    let closed = false;

    const sendSnapshot = async () => {
      if (closed) {
        return;
      }

      try {
        const [status, logs] = await Promise.all([
          buildStatus(),
          profileId ? profileLogs(profileId, limit) : Promise.resolve([]),
        ]);

        writeEvent(reply.raw, 'snapshot', {
          profile_id: profileId || null,
          profiles: listProfileSummaries(),
          status,
          logs,
          emitted_at: Date.now(),
        });
      } catch (error) {
        writeEvent(reply.raw, 'error', {
          message: error.message,
          emitted_at: Date.now(),
        });
      }
    };

    const interval = setInterval(() => {
      void sendSnapshot();
    }, 5000);

    request.raw.on('close', () => {
      closed = true;
      clearInterval(interval);
    });

    void sendSnapshot();
  });
}
