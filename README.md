# Fixboard

A maintenance request tool for a rental company of about 75 units. Tenants submit requests through a public form with no login, and staff work through them on one dashboard, so nothing gets lost.

## Status

Backend only, and still in progress:

- **Built:** properties, units, the resident roster, the vendor list, staff sign-in, and public request intake as JSON.
- **Not built yet:** follow-up questions, photos, the staff request screens, history, and the frontend.

## Stack

Python 3.13, FastAPI, SQLAlchemy 2, Alembic, and Postgres. Production uses Neon for the database and staff sign-in. Local development and CI use Postgres in Docker.

## Run it locally

You need [uv](https://docs.astral.sh/uv/) and Docker.

```sh
docker compose up -d db
cd backend
cp .env.example .env
```

Set these two values in `backend/.env`:

```sh
DATABASE_URL=postgresql+psycopg://fixboard:fixboard@localhost:5432/fixboard
NEON_AUTH_URL=https://test.neon.invalid/neondb/auth
```

The placeholder auth URL lets the app start, but staff sign-in needs the real URL from the Neon console.

Then create the tables and start the server:

```sh
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Check it at <http://localhost:8000/health>.

**Check `DATABASE_URL` before running migrations or seed scripts.** They change whichever database it points to, so if `backend/.env` holds your Neon URL, they run against Neon.

To run the backend in Docker instead, set `NEON_AUTH_URL` in your shell, because the container does not read `backend/.env`. Compose does not run migrations, so run them yourself:

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

## Configuration

Settings come from environment variables or `backend/.env`. See `backend/.env.example`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | | Postgres URL using the psycopg driver. On Neon, use the direct host, not `-pooler` |
| `NEON_AUTH_URL` | Yes | | Base URL of Neon Auth |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` | Staff script only | | Creates staff accounts. The key gives admin access, so never commit it |
| `SENTRY_DSN` | No | off | Error reporting |
| `PUBLIC_FORM_ENABLED` | No | `true` | `false` closes the public form |
| `RATE_LIMIT_IP` | No | `10/minute` | Limit per IP on the public form |
| `RATE_LIMIT_UNIT_PER_HOUR` | No | `10` | Limit per unit on the public form |

## API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Liveness check |
| GET | `/api/public/config` | Public | Request categories |
| GET | `/api/public/properties` | Public | Active properties |
| GET | `/api/public/properties/{id}/units` | Public | Active units of a property |
| POST | `/api/public/requests` | Public, rate limited | Submit a request, returns only the reference number |
| GET | `/api/staff/me` | Staff | The signed-in staff user |

Submit a request, using a `unit_id` from your own data:

```sh
curl -X POST http://localhost:8000/api/public/requests \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3f2b8c1e-7a4d-4e9b-8f60-1c2d3e4f5a6b" \
  -d '{
    "unit_id": 1,
    "tenant_name": "Pat Lee",
    "phone": "(555) 123-4567",
    "category": "plumbing",
    "description": "The sink is clogged",
    "entry_permission": "notify_first"
  }'
```

- **Contact details:** send a phone number, an email address, or both.
- **`entry_permission`:** one of `anytime`, `notify_first`, or `only_when_home`.
- **`Idempotency-Key`:** required, 16 to 255 characters. Use a new UUID for each request, and the same one for a retry, which returns the original reference number.

Errors look like `{ "error": { "code", "message" } }`, and a 422 also lists `fields`. When the form is closed, the response is a 503 with the code `form_closed`.

## Tests

The tests need the local database running:

```sh
docker compose up -d db
cd backend
uv run ruff check .
uv run pytest
```

They use the local database even if `backend/.env` points at Neon. A `DATABASE_URL` set in your shell takes priority, though, so unset it first: the tests run migrations on that database.
