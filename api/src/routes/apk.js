import { getDb } from '../db/client.js';
import { credentialsFor, profileIdPattern } from './profiles.js';
import { apkRuntimeContract } from '../services/apk-contract.js';

export function registerApkRoutes(app) {
  app.get('/apk/heartbeat/:id', async (request, reply) => {
    const profileId = String(request.params.id || '').trim().toLowerCase();

    reply.header('cache-control', 'no-store');

    if (!profileIdPattern.test(profileId)) {
      return reply.status(400).send({
        ok: false,
        error: 'invalid_profile_id',
      });
    }

    const profile = getDb()
      .prepare('SELECT id, active, updated_at FROM profiles WHERE id = ?')
      .get(profileId);

    if (!profile) {
      return reply.status(404).send({
        ok: false,
        error: 'profile_not_found',
      });
    }

    const credentials = credentialsFor(profile.id);

    const contract = apkRuntimeContract({
      profile,
      credentials,
      request,
    });

    return {
      ok: true,
      service: 'gdns-profile-api',
      ...contract,
    };
  });
}
