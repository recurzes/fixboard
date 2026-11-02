# Runbook

How to deploy, roll back, refresh the roster, and find out what broke. Setup and settings are in the [README](README.md). The frontend has its own section, [Frontend](#frontend).

| What | Where |
| --- | --- |
| Backend and frontend containers and logs | Dokploy, on the Oracle server |
| Errors | Sentry |
| Database and staff sign-in | Neon console |
| Photos | The S3-compatible provider's console |
| DNS and tunnel | Cloudflare dashboard |

## First deploy

1. **Neon:** use the direct host in `DATABASE_URL`, not `-pooler`. The role must own the tables, because row-level security hides every row from any other role. Turn public sign-up off:

   ```sh
   neon neon-auth config email-password update --disable-sign-up
   ```

   Add the frontend's origin to Neon Auth's trusted domains, or sign-in and password emails are refused. Safari blocks a session cookie set by another site, so the frontend's nginx serves Neon Auth from its own origin at `/neon-auth`.

2. **Bucket:** create it and set it private on the provider. Afterwards, opening a file's plain URL must be refused.
3. **Dokploy:** create an application from this repo, built from `backend/Dockerfile` with `backend` as the build context. Set a restart policy, and publish no ports.
4. **Environment:** set these in Dokploy. The README's configuration table explains each one.

   ```sh
   ENVIRONMENT=production
   DATABASE_URL=
   APP_ORIGIN=
   NEON_AUTH_URL=
   STORAGE_ENDPOINT_URL=
   STORAGE_BUCKET=
   STORAGE_ACCESS_KEY_ID=
   STORAGE_SECRET_ACCESS_KEY=
   SENTRY_DSN=
   ```

   If `ENVIRONMENT` is missing, the app treats itself as local and does not require `SENTRY_DSN`, so check it is set.
5. **Cloudflare:** add a public hostname to the tunnel and point it at the backend on port 8000.
6. **Deploy,** then check all of these:

   ```sh
   curl https://<api domain>/health
   curl https://<api domain>/health/ready
   ```

   - Both return `{"status":"ok"}`.
   - Dokploy's logs show no `EMERGENCY NUMBER` warning before real tenants use the form.
   - The server's public IP does **not** answer. The per-IP rate limit trusts the `CF-Connecting-IP` header, so anyone who can reach the server directly can fake it. These must both fail:

   ```sh
   curl -m 5 http://<server ip>:8000/health
   curl -m 5 -H "Host: <api domain>" http://<server ip>/health
   ```

7. **Uptime monitor:** add one on `https://<api domain>/health` with an alert to a person. This is the only thing that notices the backend being down. A second monitor on `/health/ready` also catches database and storage outages, but each check wakes the database, so a frequent one stops Neon's compute from scaling to zero.
8. **Data:** run the first four seed commands in the README's "Load data" section, from your own machine with `DATABASE_URL` set to production. The roster and properties files are not in the image.
9. **Smoke test:** see below. Run it before real tenants arrive.

## Smoke test

Walks both journeys through the real API and stops at the first failure. It needs a property with a unit, an outside vendor on the vendor list, and a staff account with a password. From `backend/`:

```sh
export NEON_AUTH_URL=...
export APP_ORIGIN=...
export SMOKE_STAFF_EMAIL=...
export SMOKE_STAFF_PASSWORD=...
uv run python tests/smoke.py https://<api domain>
```

It creates one real request named `SMOKE TEST - please ignore` on the first unit it finds, and leaves it as Done. Its history events cannot be deleted.

## Routine deploy

1. Confirm CI passed on the commit.
2. Deploy it in Dokploy. **The container runs `alembic upgrade head` when it starts,** then starts the server.
3. Check `/health/ready` and watch Sentry for a few minutes.

A change to `form_config.json`, including the emergency number, needs a deploy. Restarting clears the in-memory per-IP rate limit counters, which is harmless.

## Rollback

First work out which case you are in. `alembic current` in the running container shows the database's revision, and `backend/alembic/versions/` shows what each commit includes.

| Case | What to do |
| --- | --- |
| The release has no new migration | Redeploy the previous commit in Dokploy |
| A migration failed, so the new container will not start | Each migration runs in a transaction and rolls back on failure. Read the error in the logs, then redeploy the previous commit |
| A migration succeeded, and the new code is the problem | Prefer a fix forward. Otherwise, follow the steps below |

**A code rollback does not undo a migration.** The old image also will not start on a newer database, because its `alembic upgrade head` stops with `Can't locate revision`. To go back:

1. Read the migration's `downgrade()`. It may drop data for good. For example, `0007`'s drops the whole history table.
2. If it drops data you need, restore instead: take a Neon point-in-time restore from before the deploy.
3. In the **new** container, the only one that knows the migration, run:

   ```sh
   alembic downgrade <previous revision>
   ```

4. Redeploy the previous commit, and check `/health/ready`.

## Refresh the roster

From `backend/`, with `DATABASE_URL` set to production:

```sh
uv run python -m app.residents.seed roster.csv
```

**The file is the whole roster.** Anyone missing from it becomes inactive, so a partial file makes those tenants' requests get flagged for review. Check the printed counts: a large `deactivated` number means the file was wrong, so fix it and re-run. Any bad row stops the script with nothing saved. No request is ever lost to a mismatch, only flagged. Keep the file out of git.

## Demo data

```sh
python -m app.demo_seed
```

This adds two `Demo - ...` properties, made-up residents, the vendor list, and seven sample requests. It stops if they are already loaded. It adds back any starting vendor name that was renamed.

**Remove it before real tenants arrive,** because tenants see these properties in the form's dropdown. Run this in the Neon SQL editor. Check the counts before `COMMIT`:

```sql
BEGIN;
DELETE FROM requests WHERE property_id IN (SELECT id FROM properties WHERE name LIKE 'Demo - %');
DELETE FROM residents WHERE unit_id IN (
  SELECT id FROM units WHERE property_id IN (SELECT id FROM properties WHERE name LIKE 'Demo - %')
);
DELETE FROM units WHERE property_id IN (SELECT id FROM properties WHERE name LIKE 'Demo - %');
DELETE FROM properties WHERE name LIKE 'Demo - %';
COMMIT;
```

History events for these requests stay, because the database refuses to delete them. They are harmless, and nothing shows them once the request is gone. Photos stay in the bucket too, so run the orphan report afterwards.

## Where each failure shows up

| Failure | Where you see it | What to do |
| --- | --- | --- |
| A request sits unnoticed | The dashboard's New count. V1 sends no notifications | The client names who checks it and how often |
| Backend is down | Uptime monitor on `/health` | Check Dokploy's logs and restart. Tenants see an error and the phone number |
| Container will not start | Dokploy's logs. A settings error names the setting, and a migration error names the revision | Fix the setting, or see Rollback |
| Database is down | `/health/ready` returns 503 while `/health` passes, and API calls fail after about 10 seconds with 500s in Sentry | Check the Neon console |
| Photo storage is down | `/health/ready` returns 503. Submits with photos get a 503, and `photo upload failed` appears in the logs and Sentry. No request is created | Check the provider |
| Staff cannot sign in | API returns 503 `Sign-in service unavailable` | Check Neon Auth in the Neon console |
| A valid staff user gets 403 | No active row in `staff_users` for that account | Check the row, or create it with `app.staff.seed` |
| Spam floods the form | `ratelimit` and `rate limit exceeded for unit` lines in the logs, and many New requests | Set `PUBLIC_FORM_ENABLED=false` and redeploy. The form then tells tenants to call |
| A public route appears by accident | `test_only_the_allowed_routes_are_public` fails in CI | Do not deploy. Adding a public route is a privacy decision |
| Files left in the bucket | The orphan report, `python -m app.photos.report`. Run it weekly | Check each path. A submit in progress looks the same, so nothing is deleted automatically |
| Emergency number is still the placeholder | `EMERGENCY NUMBER IS STILL THE PLACEHOLDER` at every start | Replace it in `form_config.json` and deploy |
| DNS or tunnel problem | The domain fails while the container's logs look healthy | Check the Cloudflare dashboard |

## Frontend

One nginx container serves the built app. It holds no data and runs no migrations, so a deploy or a rollback is only a rebuild.

### First deploy

Deploy the backend first. The form needs the API, and the frontend's settings name the API's domain.

1. **Dokploy:** create a second application from this repo, built from `frontend/Dockerfile` with the **repo root** as the build context. The build reads `backend/app/intake/form_config.json`, and the root `.dockerignore` lets in only that file and `frontend/`. Set a restart policy, and publish no ports.
2. **Build arguments:** set these as build arguments in Dokploy, not runtime environment variables. The build bakes them in, so the container needs no environment.

   ```sh
   VITE_API_URL=https://<api domain>
   NEON_AUTH_URL=          # the backend's NEON_AUTH_URL
   VITE_SENTRY_DSN=        # the frontend's Sentry project, optional
   PHOTO_ORIGIN=           # the origin of a signed photo link, such as https://<bucket host>
   ```

   The build fails if `VITE_API_URL` or `NEON_AUTH_URL` is missing. It also writes the Content Security Policy, which allows only the API, Sentry, and `PHOTO_ORIGIN` besides the site itself. If `PHOTO_ORIGIN` is wrong, staff see broken photos, and the browser console names the blocked host. Set it to that origin and rebuild.
3. **Cloudflare:** add a public hostname to the tunnel and point it at the frontend container on port 80.
4. **Backend:** set `APP_ORIGIN` to `https://<frontend domain>` exactly, with no trailing slash, and redeploy the backend. Add the same origin to Neon Auth's trusted domains.
5. **Deploy,** then check all of these:
   - `https://<frontend domain>/` shows the form, and the Property dropdown lists properties. That proves it talks to the API.
   - Refreshing on `/staff/login` and on a request's page loads the page, not a 404.
   - `curl -sI https://<frontend domain>/` shows `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-cache`.
   - The browser console shows no `Content-Security-Policy` errors while you add a photo on the form, and while you open a request with photos on the dashboard.
   - On an iPhone, sign in, then refresh. You are still signed in. If not, check the `Set-Cookie` on the `/neon-auth/sign-in/email` response: the proxy can't keep a cookie that names Neon's domain.
   - The build log shows no `EMERGENCY NUMBER` warning before real tenants use the form.

### Routine deploy and rollback

1. Confirm CI passed on the commit.
2. Deploy it in Dokploy, then load the form and the dashboard.

To roll back, redeploy the previous commit. Phones pick up a deploy on their next page load, because `index.html` is never cached. The script and style files have a content hash in their names, so they are cached for a year.

### Changing the emergency number, time zone, or notice text

Each one is built into the page, so restarting the container changes nothing. Rebuild.

| Change | File | Rebuild |
| --- | --- | --- |
| Emergency number | `backend/app/intake/form_config.json` | **Both containers.** The banner and error screen are built into the frontend, and the form's call-us messages come from the API, so a frontend-only rebuild leaves them disagreeing |
| Company time zone, entry notice, privacy notice | `frontend/src/shared/lib/siteConfig.ts` | The frontend |
| A build argument, such as the API domain | Dokploy | The frontend |

### End-to-end smoke test

One Playwright test walks the whole journey on the real site. The tenant part runs on a phone-sized screen and submits with a photo. The staff part signs in, checks the New count, opens the request, assigns Plumber, and moves it to Waiting on vendor and then to Done. It needs the demo seed, because it uses `Demo - Palm Court` unit 101 and the Plumber vendor. From `frontend/`:

```sh
npx playwright install chromium
E2E_BASE_URL=https://<frontend domain> \
E2E_STAFF_EMAIL=... \
E2E_STAFF_PASSWORD=... \
npm run e2e
```

It creates one real request named `SMOKE TEST - please ignore` and leaves it as Done. The demo data removal deletes it, but its history events stay. The unit limit allows 10 submits an hour. A failed run keeps a trace in `test-results/`, which `npx playwright show-trace` opens.

### Where frontend failures show up

| Failure | Where you see it | What to do |
| --- | --- | --- |
| A page crashes | Sentry's frontend project, with personal data scrubbed. The tenant sees the error screen with the phone number | Fix forward, or roll back |
| The page says "This site is not set up correctly" | The page names the missing build argument | Set it in Dokploy and rebuild |
| A photo, script, or API call is blocked | The browser console only, as a `Content-Security-Policy` error. Sentry does not see it | Fix the build argument the blocked origin came from, and rebuild |
| The form can't reach the API | Tenants see an error and the phone number. API calls fail in the browser's network tab | Check the backend. If it is up, check that `APP_ORIGIN` matches the frontend's origin exactly |
| Sign-in fails for everyone | "Sign-in isn't available right now" | Check Neon Auth, the `NEON_AUTH_URL` build argument, and Neon's trusted domains |
| Container won't start, or the site is down | Dokploy's logs. nginx logs each request there too | Check the logs, or redeploy the previous commit |

## Client demo

Run it on the real domain with the demo seed loaded: the form on a phone, the dashboard on a laptop. Rehearse it once on both devices before the client sees it. Write down every rough edge you hit, with the device and the step, and fix the worst three first.

**Tenant, on the phone (about 2 minutes)**

1. Open the form. Point out the emergency banner, and that the number is a call link.
2. Pick `Demo - Palm Court`, unit 101, and enter a name and a phone number.
3. Choose Plumbing, then "A clogged drain", and show the self-check card. Then choose "Water is flooding and will not stop", and show the call-us message.
4. Switch to a leak, describe it, add a photo from the library, pick entry permission, and tick "This is not an emergency".
5. Submit, and show the reference number and Copy.

**Staff, on the laptop (about 3 minutes)**

1. Sign in. Show the New count in the tab title and on the chips, and the highlighted New rows.
2. Open the urgent flooding request from Avery Stone, then the contact mismatch from Blake Rivera, and mark it as reviewed.
3. Open the request just submitted from the phone, and its photo.
4. Assign an outside vendor, set a scheduled time, add a note, and move it to Waiting on vendor, then to Done. Show the history.
5. Log a phone request for a tenant, and add a vendor on the vendor page.

Afterwards, go through the README's open assumptions with the client in the same sitting, and remove the demo data before real tenants arrive.
