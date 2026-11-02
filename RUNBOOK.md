# Runbook

How to deploy, roll back, refresh the roster, and find out what broke. Setup and settings are in the [README](README.md).

| What | Where |
| --- | --- |
| Backend container and logs | Dokploy, on the Oracle server |
| Errors | Sentry |
| Database and staff sign-in | Neon console |
| Photos | The S3-compatible provider's console |
| DNS and tunnel | Cloudflare dashboard |

## First deploy

1. **Neon:** use the direct host in `DATABASE_URL`, not `-pooler`. The role must own the tables, because row-level security hides every row from any other role. Turn public sign-up off:

   ```sh
   neon neon-auth config email-password update --disable-sign-up
   ```

   Add the frontend's origin to Neon Auth's trusted domains, or sign-in and password emails are refused. Safari blocks the session cookie while the frontend and Neon Auth are on different sites, so staff on iPhones can't stay signed in until the auth URL is served from the frontend's own site (F111).

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
