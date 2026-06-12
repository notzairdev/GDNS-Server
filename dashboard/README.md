# GDNS Dashboard

React/Vite dashboard for managing GDNS profiles, categories, credentials, and
per-profile query logs.

## Commands

```bash
npm ci
npm run dev
npm run lint
npm run build
```

The production build writes static assets to `dashboard/dist`. Caddy serves that
directory directly; no Node.js process is required in production.

## UI

The dashboard uses `shadcn/ui` with the `b0` preset. Add new primitives with:

```bash
npx shadcn@latest add <component>
```
