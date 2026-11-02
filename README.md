# Fixboard

A maintenance request tool for a rental company of about 75 units. Tenants submit requests through a public form with no login, and staff work through them on one dashboard, so nothing gets lost.

## Status

Backend only, and still in progress:

- **Built:** properties, units, the resident roster, the vendor list, staff sign-in, public request intake with photos, follow-up questions, self-checks, urgent answers, the staff API for listing, searching, opening, changing, and logging requests, adding notes, and editing the vendor list, and an append-only history of who changed what.
- **Not built yet:** the frontend.

## Stack

Python 3.13, FastAPI, SQLAlchemy 2, Alembic, and Postgres. Production uses Neon for the database and staff sign-in. Local development and CI use Postgres in Docker. Photos go to a private S3-compatible bucket.

## Run it locally

You need [uv](https://docs.astral.sh/uv/) and Docker.

```sh
docker compose up -d db
cd backend
cp .env.example .env
```

Set these values in `backend/.env`:

```sh
DATABASE_URL=postgresql+psycopg://fixboard:fixboard@localhost:5432/fixboard
NEON_AUTH_URL=https://test.neon.invalid/neondb/auth
STORAGE_ENDPOINT_URL=http://127.0.0.1:9100
STORAGE_BUCKET=photos
STORAGE_ACCESS_KEY_ID=test
STORAGE_SECRET_ACCESS_KEY=test
```

The placeholder auth URL lets the app start, but staff sign-in needs the real URL from the Neon console.

The storage values point at a throwaway S3 server, which keeps its files in memory until you stop it. Requests without photos work without it. To submit photos locally, start it and create the bucket:

```sh
uvx --from 'moto[server]' moto_server -H 127.0.0.1 -p 9100
curl -X PUT http://127.0.0.1:9100/photos
```

Then create the tables and start the server:

```sh
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Check it at <http://localhost:8000/health>.

**Check `DATABASE_URL` before running migrations or seed scripts.** They change whichever database it points to, so if `backend/.env` holds your Neon URL, they run against Neon.

To run the backend in Docker instead, set `NEON_AUTH_URL` and the `STORAGE_*` values in your shell, because the container does not read `backend/.env`. Compose does not run migrations, so run them yourself:

```sh
docker compose up -d --build
docker compose exec backend alembic upgrade head
```

## Load data

Run these from `backend/`. Load properties before residents, because each resident row refers to a property and unit that must already exist.

```sh
uv run python -m app.assignees.seed
uv run python -m app.intake.seed properties.csv
uv run python -m app.residents.seed roster.csv
uv run python -m app.staff.seed --name "Sam Lee" --email sam@example.com
```

| Script | What it does | Re-running it |
| --- | --- | --- |
| `app.assignees.seed` | Adds the five starting vendor-list entries | Adds back any starting name that is missing, including one staff have renamed, so run it only during setup |
| `app.intake.seed` | Loads properties and units | Updates addresses and adds new rows, and leaves anything missing from the file as it is |
| `app.residents.seed` | Loads the resident roster | Treats the file as the whole roster, so residents missing from it become inactive |
| `app.staff.seed` | Creates a staff account | Stops with an error if the email already exists |

CSV columns:

| File | Columns | Notes |
| --- | --- | --- |
| Properties | `property_name`, `property_address`, `unit_label` | One row per unit, all required |
| Roster | `property_name`, `unit_label`, `name`, `email`, `phone` | Email and phone may be blank |

The roster is personal data. Git and Docker builds ignore `*.csv` files, so keep it that way.

The staff script also needs `NEON_API_KEY`, `NEON_PROJECT_ID`, and `NEON_BRANCH_ID`. Neon's API takes no password, so new staff set theirs through the forgot-password flow.

## Check for orphan photos

This lists files in the bucket with no database row. Run it weekly. It only reports and deletes nothing, because a submit still in progress can look like an orphan.

```sh
uv run python -m app.photos.report
```

## Configuration

Settings come from environment variables or `backend/.env`. See `backend/.env.example`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | | Postgres URL using the psycopg driver. On Neon, use the direct host, not `-pooler` |
| `NEON_AUTH_URL` | Yes | | Base URL of Neon Auth |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` | Staff script only | | Creates staff accounts. The key gives admin access, so never commit it |
| `STORAGE_ENDPOINT_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | Yes | | The S3-compatible photo bucket. It must be private, and the secret key stays on the server |
| `STORAGE_REGION` | No | `auto` | Region of the photo bucket |
| `SIGNED_URL_SECONDS` | No | `300` | How long a staff photo link works |
| `SENTRY_DSN` | No | off | Error reporting |
| `PUBLIC_FORM_ENABLED` | No | `true` | `false` closes the public form |
| `RATE_LIMIT_IP` | No | `10/minute` | Limit per IP on the public form |
| `RATE_LIMIT_UNIT_PER_HOUR` | No | `10` | Limit per unit on the public form |

Everything the form asks lives in `backend/app/intake/form_config.json`, and the app refuses to start if that file is invalid. Changing it needs a redeploy. It holds:

- **Categories and questions:** 2 to 4 questions per category.
- **Option flags:** `urgent`, and `self_check` on the answers allowed to have one. Self-check wording is a draft until the client approves it, marked `pending_client_approval`.
- **`emergency_number`:** still the placeholder `(000) 000-0000`. Replace it before real tenants use the form.
- **`require_emergency_ack`:** `false` removes the "not an emergency" requirement.

## API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Liveness check |
| GET | `/api/public/config` | Public | Categories, follow-up questions, self-checks, urgent answers, emergency number |
| GET | `/api/public/properties` | Public | Active properties |
| GET | `/api/public/properties/{id}/units` | Public | Active units of a property |
| POST | `/api/public/requests` | Public, rate limited | Submit a request with up to 5 photos, returns only the reference number |
| GET | `/api/staff/me` | Staff | The signed-in staff user |
| GET | `/api/staff/requests` | Staff | List requests, 25 per page, newest first |
| GET | `/api/staff/requests/summary` | Staff | Counts by status, plus open urgent and needs-review counts |
| POST | `/api/staff/requests` | Staff | Log a phone, text, or in-person request |
| GET | `/api/staff/requests/{id}` | Staff | Full request, with photo ids, notes, and history |
| PATCH | `/api/staff/requests/{id}` | Staff | Change status, assignee, or scheduled time, or clear the review flag |
| POST | `/api/staff/requests/{id}/notes` | Staff | Add an internal note |
| GET | `/api/staff/requests/{id}/photos/{photo_id}` | Staff | A short-lived signed link to one photo |
| GET | `/api/staff/assignees` | Staff | Active vendor-list entries with their kind |
| POST | `/api/staff/assignees` | Staff | Add an outside vendor |
| PATCH | `/api/staff/assignees/{id}` | Staff | Rename or deactivate an entry |

Submit a request as multipart, using a `unit_id` from your own data. Plain JSON bodies are not accepted:

```sh
curl -X POST http://localhost:8000/api/public/requests \
  -H "Idempotency-Key: 3f2b8c1e-7a4d-4e9b-8f60-1c2d3e4f5a6b" \
  -F 'data={
    "unit_id": 1,
    "tenant_name": "Pat Lee",
    "phone": "(555) 123-4567",
    "category": "plumbing",
    "description": "The sink is clogged",
    "entry_permission": "notify_first",
    "followup_answers": { "problem": "clogged_drain", "location": "kitchen" },
    "self_check_tried": true,
    "not_an_emergency": true
  }' \
  -F photos=@sink.jpg \
  -F photos=@drain.png
```

- **`data`:** the request fields, as a JSON string.
- **`photos`:** optional and repeated, up to 5 JPG, PNG, or HEIC files of 10 MB each. The server checks the real file type, removes EXIF data including GPS, and stores HEIC as JPEG. If any photo is rejected or the upload fails, no request is created.
- **Contact details:** send a phone number, an email address, or both.
- **`entry_permission`:** one of `anytime`, `notify_first`, or `only_when_home`.
- **`followup_answers`:** question id to answer, checked against the chosen category in `backend/app/intake/form_config.json`. For a choice question, send the option's `value`.
- **`self_check_tried`:** whether the tenant ticked "I tried it". Ignored unless the answers lead to a self-check.
- **`not_an_emergency`:** must be `true` while `require_emergency_ack` is on in the form config.
- **Urgent requests:** the server sets the flag from the answers, and the request is still accepted.
- **`Idempotency-Key`:** required, 16 to 255 characters. Use a new UUID for each request, and the same one for a retry, which returns the original reference number.

The staff list takes these query parameters, and all of them can be combined:

- **`property`, `status`, `category`:** repeat one to match any of its values, for example `?status=new&status=scheduled`.
- **`needs_review`, `urgent`:** `true` or `false`.
- **`q`:** partial, case-insensitive search on reference number, unit label, and tenant name. An exact reference number returns only that request.
- **`include_done`:** Done requests are hidden unless this is `true` or `status` names `done`. This also applies to `q`, so searching for a Done request's reference number needs one of them.
- **`cursor`:** the `next_cursor` from the previous page. It is `null` on the last page. Keep the same filters while paging.

To change a request, send the `updated_at` you last read, plus only the fields to change:

```sh
curl -X PATCH http://localhost:8000/api/staff/requests/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "updated_at": "2026-11-02T01:00:00.123456Z", "status": "waiting_on_vendor", "assignee_id": 2 }'
```

- **`updated_at`:** required. If someone else changed the request since, the response is a 409 and nothing changes, so reload it. Adding a note does not count as a change.
- **`status`:** `new`, `scheduled`, `waiting_on_vendor`, or `done`. Any status can move to any other. `waiting_on_vendor` needs an outside vendor as the assignee, or the response is a 422.
- **`assignee_id`:** must be an active entry, unless it is already on the request. `null` unassigns. A request on Waiting on vendor that loses its vendor moves to Scheduled, unless the same call names another status.
- **`scheduled_at`:** a time with a UTC offset, or `null` to clear it.
- **`needs_review`:** only `false` is accepted.

To log a request for a tenant, send `POST /api/staff/requests` as JSON with the same fields as the public form, plus `source`: `phone`, `text`, or `in_person`. It skips the honeypot, rate limits, and acknowledgement, never flags for review, and takes no photos or `Idempotency-Key`, so a repeated call creates a second request.

Vendor-list names must be unique, and a duplicate returns 409. In-house maintenance can be renamed but not deactivated. A deactivated entry stays on the requests that already have it.

The request detail includes `history`, newest first. Each event has `event` (`created`, `changed`, or `note_added`), `field`, `old_value`, `new_value`, `actor_name`, and `created_at`. A null `actor_name` means the tenant. Staff actors always come from the sign-in token. Note text and tenant details are never copied into history, and assignees are stored by name, so a later rename does not change past events.

The database refuses `UPDATE` and `DELETE` on the history table, so events written to any database are permanent, including test ones.

Errors look like `{ "error": { "code", "message" } }`, and a 422 also lists `fields`. When the form is closed, the response is a 503 with the code `form_closed`. When photo storage is down, it is a 503 with the code `service_unavailable`.

## Tests

The tests need the local database running:

```sh
docker compose up -d db
cd backend
uv run ruff check .
uv run pytest
```

They use the local database even if `backend/.env` points at Neon, and a fake bucket in place of real storage. A `DATABASE_URL` set in your shell takes priority, though, so unset it first: the tests run migrations on that database.
