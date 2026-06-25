export function registerHealthRoutes(app) {
  app.get('/health', async () => ({
    ok: true,
    service: 'gdns-profile-api',
  }));
}
