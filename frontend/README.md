# Fixboard frontend

One React app serves both halves of Fixboard: the public request form at `/`, which tenants open on their phones, and the staff dashboard under `/staff`. The backend, the API, and the client's open assumptions are in the [root README](../README.md). Deploying and fixing it in production is in the [runbook](../RUNBOOK.md#frontend).

React 19, TypeScript, Vite, Tailwind, React Router, and TanStack Query.

## Run it locally

You need Node 24, and the backend running on <http://localhost:8000>. The [root README](../README.md#run-it-locally) shows how. From `frontend/`:

```sh
cp .env.example .env
npm install
npm run dev
```

Set `VITE_NEON_AUTH_URL` in `.env` first. Then open:

- <http://localhost:3000> for the tenant form. Its dropdowns stay empty until the backend has properties, so load some or run the demo seed.
- <http://localhost:3000/staff> for the dashboard. Sign-in needs a staff account from `app.staff.seed`.
- <http://localhost:3000/dev/ui> for every shared control in every state. This page exists only in development.

The dev server always uses port 3000, because the backend's `APP_ORIGIN` allows that one origin only.

| Command                                                     | What it does                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                               | Dev server on port 3000                                                                                   |
| `npm test`                                                  | Vitest unit and screen tests, with the API faked                                                          |
| `npm run lint`, `npm run format:check`, `npm run typecheck` | The rest of what CI runs                                                                                  |
| `npm run build`                                             | Type-checks, then builds into `dist/`                                                                     |
| `npm run e2e`                                               | The Playwright smoke test against a deployed site. See the [runbook](../RUNBOOK.md#end-to-end-smoke-test) |

## Environment variables

Vite builds them into the JavaScript, so anyone can read them, and a change needs a rebuild. Never put a secret here.

| Variable             | Required | Purpose                                                                                                                           |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`       | Yes      | The backend's base URL                                                                                                            |
| `VITE_NEON_AUTH_URL` | Yes      | Neon Auth's base URL, the same value as the backend's `NEON_AUTH_URL`. The production image sets this one itself, to `/neon-auth` |
| `VITE_SENTRY_DSN`    | No       | Error reporting. Leave it empty to turn Sentry off                                                                                |

If a required one is missing, the app shows a page that names it instead of starting.

The production image takes these as build arguments, plus two more for nginx. The [runbook](../RUNBOOK.md#frontend) lists them.

## The shared config file

`backend/app/intake/form_config.json` holds everything the form asks: categories, follow-up questions, self-checks, urgent answers, and the emergency number. The backend reads it at startup, and the frontend gets it from `GET /api/public/config`. That way a new question needs no frontend change.

The emergency number is the exception. `src/shared/lib/siteConfig.ts` builds it into the page, so the banner and the error screen still show it while the API is down. Until the placeholder `(000) 000-0000` is replaced, `npm run dev` and `npm run build` print a loud warning, and the build still succeeds.

`siteConfig.ts` also holds the company time zone, the entry and privacy notices, and the photo limits. The time zone and notices are placeholders until the client confirms their state (A7). The photo limits are copied from `backend/app/photos/images.py`, so change both files together.

## A two-minute tour

```text
src/
  main.tsx            starts Sentry, then shows the app or the missing-settings page
  app/                the route table, the providers, and the dev-only /dev/ui page
  shared/
    api/              apiFetch(): the only code that calls the backend
    lib/              settings, sign-in tokens, Sentry scrubbing, dates, phone numbers, tab titles
    ui/               buttons, fields, alerts, the modal, toasts, and the error screen
    form/             the request fields that the tenant form and the staff log form share
  features/
    tenant-form/      the three-step public form, photos, submit, and the confirmation page
    staff/
      auth/           sign-in, password pages, and the guard on every staff route
      requests/       the list with its counts, the detail page, changes, notes, history, the log form
      vendors/        the vendor list page
e2e/                  the one Playwright smoke test
Dockerfile            builds the app, then serves it with nginx
nginx.conf.template   security headers, caching, the fallback to index.html, and the Neon Auth proxy
```

Tests sit next to the code they cover, as `*.test.ts` or `*.test.tsx`.

## Not in V1

- Notifications of any kind
- Tenant accounts, a status page for tenants, or editing and cancelling a request
- Admin screens beyond the vendor list. Staff, properties, units, and residents load from scripts
- Other languages, video uploads, and a native app
- A priority field, a "Waiting on parts" status, and vendor logins
- Reports, and automatic removal of old requests and photos

## Next steps: notifications

V1 sends no notifications, so staff find new requests only by opening the dashboard. This is the first thing to add. The plan is in the [root README](../README.md#next-steps-notifications).
