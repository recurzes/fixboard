import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import sentry_sdk
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from app.audit.models import HistoryEntity, HistoryEvent, HistoryEventType
from app.audit.service import record_event
from app.db import engine, get_db
from app.intake.models import Property, Unit
from app.intake.routes import limiter
from app.log import JsonFormatter
from app.main import create_app
from app.middleware import MAX_BODY_BYTES
from app.photos import storage
from app.photos.models import Photo
from app.requests import service
from app.requests.models import MaintenanceRequest, RequestStatus
from app.residents.models import Resident
from app.sentry import init_sentry
from app.settings import Settings, settings
from app.staff import auth
from app.staff.auth import require_staff
from tests.test_app import CaptureTransport
from tests.test_photos import FakeBucket, image_bytes, submit
from tests.test_staff_requests import add_request, add_unit

SUBMIT = "/api/public/requests"
APP_ORIGIN = settings.app_origin
OTHER_ORIGIN = "https://evil.example.com"
REAL_CLIENT = storage._client

# Everything a logged-out caller may reach. Adding to this list needs a privacy decision.
PUBLIC_ROUTES = {
    ("GET", "/health"),
    ("GET", "/api/public/config"),
    ("GET", "/api/public/properties"),
    ("GET", "/api/public/properties/{property_id}/units"),
    ("POST", "/api/public/requests"),
}


@pytest.fixture(autouse=True)
def bucket(monkeypatch):
    limiter.reset()
    fake = FakeBucket()
    monkeypatch.setattr(storage, "_client", lambda: fake)
    return fake


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def unit(db) -> Unit:
    unit = add_unit(db, "Oak", "1A")
    # Committed to the fixture's outer transaction, so a failed submit's rollback keeps the unit.
    db.commit()
    return unit


def routes() -> list[tuple[str, str]]:
    # FastAPI's own walker, because app.routes holds included routers and not their routes. A mount
    # has no methods, so it shows up as ANY and fails the allowlist.
    return [
        (method, context.path)
        for context in iter_route_contexts(create_app().routes)
        for method in context.methods or {"ANY"}
    ]


# T72


def test_only_the_allowed_routes_are_public():
    public = {route for route in routes() if not route[1].startswith("/api/staff/")}
    assert public == PUBLIC_ROUTES


def test_every_staff_route_rejects_missing_and_non_staff_tokens(db, client, monkeypatch):
    staff_routes = [route for route in routes() if route not in PUBLIC_ROUTES]
    assert staff_routes

    for method, path in staff_routes:
        url = re.sub(r"{\w+}", "1", path)
        assert client.request(method, url).status_code == 401, (method, path)
        garbage = {"Authorization": "Bearer not-a-jwt"}
        assert client.request(method, url, headers=garbage).status_code == 401, (method, path)

    # A valid sign-in with no staff row. Real token checks are covered in test_staff_auth.py.
    monkeypatch.setattr(auth, "verify_token", lambda token: uuid4())
    valid = {"Authorization": "Bearer signed-in-but-not-staff"}
    for method, path in staff_routes:
        url = re.sub(r"{\w+}", "1", path)
        assert client.request(method, url, headers=valid).status_code == 403, (method, path)


def test_a_photo_is_reachable_only_through_a_staff_signed_url(db, client, unit, monkeypatch):
    response = submit(client, unit, [image_bytes()])

    assert response.status_code == 201
    assert response.json().keys() == {"reference_number"}
    photo = db.scalar(select(Photo))
    assert photo.storage_path not in response.text
    url = f"/api/staff/requests/{photo.request_id}/photos/{photo.id}"

    assert client.get(url).status_code == 401
    assert client.get(f"/{photo.storage_path}").status_code == 404
    assert client.get(f"/api/public/{photo.storage_path}").status_code == 404
    monkeypatch.setattr(auth, "verify_token", lambda token: uuid4())
    headers = {"Authorization": "Bearer signed-in-but-not-staff"}
    assert client.get(url, headers=headers).status_code == 403

    client.app.dependency_overrides[require_staff] = lambda: None
    # Signing happens offline, so the real client needs no storage server.
    monkeypatch.setattr(storage, "_client", REAL_CLIENT)
    signed = client.get(url)
    assert signed.status_code == 200
    assert "X-Amz-Signature=" in signed.json()["url"]


# T73


def test_every_table_denies_by_default_and_the_backend_role_owns_it(db):
    tables = db.execute(
        text(
            """
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   pg_get_userbyid(c.relowner) = current_user
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
            """
        )
    ).all()

    assert "residents" in {table[0] for table in tables}
    # Owning the table is what lets the backend through, so forcing RLS would lock it out too.
    assert [table for table in tables if table[1:] != (True, False, True)] == []
    assert db.scalar(text("SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")) == 0


def test_a_role_other_than_the_backend_gets_nothing(db):
    oak = add_unit(db, "Oak", "1A")
    db.add(Resident(unit_id=oak.id, name="Pat", email="pat@example.com"))
    request = add_request(db, oak)
    record_event(db, HistoryEntity.request, request.id, None, HistoryEventType.created)
    db.flush()
    with_rows = (Property, Unit, Resident, MaintenanceRequest, HistoryEvent)
    assert all(db.scalar(select(func.count()).select_from(model)) for model in with_rows)
    tables = db.scalars(
        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    ).all()

    # Rolled back with the test. Granted the tables, so what stops it is RLS, not a missing grant.
    db.execute(text("CREATE ROLE rls_probe NOLOGIN"))
    db.execute(text("GRANT rls_probe TO CURRENT_USER"))
    db.execute(text("GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO rls_probe"))
    db.execute(text("SET LOCAL ROLE rls_probe"))

    assert {table: db.scalar(text(f"SELECT count(*) FROM {table}")) for table in tables} == {
        table: 0 for table in tables
    }
    with pytest.raises(ProgrammingError, match="row-level security"):
        # An explicit id, because the role has no grant on the id sequence.
        db.execute(text("INSERT INTO properties (id, name, address) VALUES (1, 'x', 'y')"))


def test_the_backend_role_can_still_use_a_table_with_rls_on(db, client, unit):
    assert submit(client, unit).status_code == 201
    assert db.scalar(select(func.count()).select_from(MaintenanceRequest)) == 1


# T74


def preflight(client, origin: str):
    headers = {"Origin": origin, "Access-Control-Request-Method": "POST"}
    return client.options(SUBMIT, headers=headers)


def test_the_app_origin_passes_cors():
    client = TestClient(create_app())
    assert preflight(client, APP_ORIGIN).status_code == 200
    assert preflight(client, APP_ORIGIN).headers["access-control-allow-origin"] == APP_ORIGIN
    response = client.get("/health", headers={"Origin": APP_ORIGIN})
    assert response.headers["access-control-allow-origin"] == APP_ORIGIN


def test_another_origin_is_refused():
    client = TestClient(create_app())
    assert preflight(client, OTHER_ORIGIN).status_code == 400
    assert "access-control-allow-origin" not in preflight(client, OTHER_ORIGIN).headers
    response = client.get("/health", headers={"Origin": OTHER_ORIGIN})
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize(
    "origin", ["*", "", "https://app.example.com/", "https://a.example.com,https://b.example.com"]
)
def test_app_refuses_to_boot_without_one_exact_origin(monkeypatch, origin):
    monkeypatch.setenv("APP_ORIGIN", origin)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_referrer_policy_is_on_success_and_refusals():
    client = TestClient(create_app())
    responses = (client.get("/health"), client.get("/missing"), preflight(client, OTHER_ORIGIN))
    for response in responses:
        assert response.headers["referrer-policy"] == "no-referrer"


def multipart_of(size: int) -> tuple[bytes, dict]:
    """A form with a `data` part and enough filler to make the whole body exactly `size`."""
    head = (
        b'--x\r\nContent-Disposition: form-data; name="data"\r\n\r\n{}\r\n'
        b'--x\r\nContent-Disposition: form-data; name="photos"; filename="a.jpg"\r\n'
        b"Content-Type: image/jpeg\r\n\r\n"
    )
    tail = b"\r\n--x--\r\n"
    body = head + b"x" * (size - len(head) - len(tail)) + tail
    return body, {
        "Content-Type": "multipart/form-data; boundary=x",
        "Idempotency-Key": uuid4().hex,
    }


def test_an_oversized_body_is_refused():
    client = TestClient(create_app())
    body, headers = multipart_of(MAX_BODY_BYTES + 1)

    response = client.post(SUBMIT, content=body, headers=headers)

    assert response.status_code == 413
    assert response.json()["error"]["message"] == "This request is too large"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_an_oversized_chunked_body_with_no_content_length_is_refused():
    client = TestClient(create_app())
    body, headers = multipart_of(MAX_BODY_BYTES + 1)

    def chunks():
        for start in range(0, len(body), 1024 * 1024):
            yield body[start : start + 1024 * 1024]

    response = client.post(SUBMIT, content=chunks(), headers=headers)

    assert "content-length" not in response.request.headers
    assert response.status_code == 413


def test_the_limit_allows_five_full_size_photos_and_the_form_fields(db, client, unit, bucket):
    # The largest body the form can send. It gets past the limit, then fails as not being images.
    fake = b"x" * (10 * 1024 * 1024)
    response = submit(client, unit, [fake] * 5)

    assert len(response.request.content) < MAX_BODY_BYTES
    assert response.status_code == 422
    assert "JPG, PNG, or HEIC" in response.text


# T75

TENANT_NAME = "Zebulon Quackenbush"
TENANT_EMAIL = "zebulon@example.com"
TENANT_PHONE = "(555) 010-9988"
STORED_PHONE = "+15550109988"
DESCRIPTION = "The spare key is under the blue flowerpot"
ENTRY_NOTES = "Gate code 4417"
RESIDENT_NAME = "Wilhelmina Oyelaran"
RESIDENT_EMAIL = "wilhelmina@example.com"
RESIDENT_PHONE = "+15550107766"
SECRETS = (
    TENANT_NAME,
    TENANT_EMAIL,
    TENANT_PHONE,
    STORED_PHONE,
    "5550109988",
    DESCRIPTION,
    ENTRY_NOTES,
    RESIDENT_NAME,
    RESIDENT_EMAIL,
    RESIDENT_PHONE,
    "5550107766",
)


@pytest.fixture
def capture(db, unit, capsys):
    """Call inside the test, because capsys replaces its stream between setup and the test."""
    db.add(
        Resident(unit_id=unit.id, name=RESIDENT_NAME, email=RESIDENT_EMAIL, phone=RESIDENT_PHONE)
    )
    db.commit()

    def start():
        app = create_app()
        app.dependency_overrides[get_db] = lambda: db
        init_sentry("https://key@example.invalid/1")
        transport = CaptureTransport()
        sentry_sdk.get_client().transport = transport

        def output() -> tuple[str, list[dict]]:
            sentry_sdk.flush()
            return capsys.readouterr().out, transport.events

        return TestClient(app, raise_server_exceptions=False), output

    yield start
    sentry_sdk.init()


def tenant_submit(client, unit, photos=()):
    return submit(
        client,
        unit,
        photos,
        tenant_name=TENANT_NAME,
        email=TENANT_EMAIL,
        phone=TENANT_PHONE,
        description=DESCRIPTION,
        entry_notes=ENTRY_NOTES,
    )


def assert_no_personal_data(logged: str, events: list[dict]) -> None:
    raw = json.dumps(events, default=str)
    for secret in SECRETS:
        assert secret not in logged, secret
        assert secret not in raw, secret


def test_a_successful_submit_leaves_no_personal_data(capture, unit):
    client, output = capture()

    assert tenant_submit(client, unit).status_code == 201

    logged, events = output()
    assert '"path": "/api/public/requests", "status": 201' in logged
    assert_no_personal_data(logged, events)


def test_a_rejected_submit_leaves_no_personal_data(capture, unit):
    client, output = capture()

    response = submit(
        client,
        unit,
        tenant_name=TENANT_NAME,
        email=TENANT_EMAIL,
        phone=TENANT_PHONE,
        description=DESCRIPTION,
        category="not-a-category",
    )

    assert response.status_code == 422
    assert_no_personal_data(*output())


def test_a_failed_photo_upload_leaves_no_personal_data(capture, unit, bucket):
    client, output = capture()
    bucket.fail_uploads_after = 0

    assert tenant_submit(client, unit, [image_bytes()]).status_code == 503

    logged, events = output()
    assert "photo upload failed" in logged
    assert_no_personal_data(logged, events)


def test_a_database_error_leaves_no_personal_data(db, capture, unit):
    """Postgres repeats the whole row in the error for a constraint failure, so this is the trap."""
    client, output = capture()
    db.execute(text("ALTER TABLE requests ADD CONSTRAINT always_fails CHECK (false) NOT VALID"))
    db.commit()

    assert tenant_submit(client, unit).status_code == 500

    logged, events = output()
    assert len(events) == 1
    assert events[0]["exception"]["values"][-1]["type"] == "IntegrityError"
    assert_no_personal_data(logged, events)


def test_a_database_error_stays_out_of_the_server_traceback(db, unit):
    """uvicorn logs what the app raises, which does not happen under TestClient, so format it."""
    db.execute(text("ALTER TABLE requests ADD CONSTRAINT always_fails CHECK (false) NOT VALID"))
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db

    with pytest.raises(IntegrityError) as error:
        tenant_submit(TestClient(app), unit)

    record = logging.LogRecord(
        "uvicorn.error", logging.ERROR, "", 0, "Exception in ASGI application", None, None
    )
    record.exc_info = (error.type, error.value, error.tb)
    line = JsonFormatter().format(record)
    assert "IntegrityError" in line
    for secret in SECRETS:
        assert secret not in line, secret


# T76


@pytest.fixture
def committed_unit(migrated):
    """Real commits on the real engine, removing only this test's rows from the local database."""
    with Session(engine, expire_on_commit=False) as session:
        unit = add_unit(session, f"Race {uuid4().hex}", "1A")
        session.commit()
    yield unit
    with engine.begin() as connection:
        ids = select(MaintenanceRequest.id).where(MaintenanceRequest.unit_id == unit.id)
        # In one transaction, so the append-only trigger can never stay off.
        connection.execute(text("ALTER TABLE history DISABLE TRIGGER history_append_only"))
        connection.execute(delete(HistoryEvent).where(HistoryEvent.entity_id.in_(ids)))
        connection.execute(text("ALTER TABLE history ENABLE TRIGGER history_append_only"))
        connection.execute(delete(Photo).where(Photo.request_id.in_(ids)))
        connection.execute(delete(MaintenanceRequest).where(MaintenanceRequest.unit_id == unit.id))
        connection.execute(delete(Unit).where(Unit.id == unit.id))
        connection.execute(delete(Property).where(Property.id == unit.property_id))


def run_together(*calls):
    """Each call gets its own thread, and so its own database connection from the app's pool."""
    with ThreadPoolExecutor(len(calls)) as pool:
        return [future.result(timeout=30) for future in [pool.submit(call) for call in calls]]


def test_a_double_submit_creates_one_request(committed_unit, bucket, monkeypatch):
    client = TestClient(create_app())
    # Holds both submits until each has seen no original, so both really do try to insert.
    both_checked = threading.Barrier(2, timeout=10)
    real_find = service._find_by_key

    def find_then_wait(db, key):
        found = real_find(db, key)
        if found is None:
            both_checked.wait()
        return found

    monkeypatch.setattr(service, "_find_by_key", find_then_wait)
    key = uuid4().hex

    first, second = run_together(
        lambda: submit(client, committed_unit, [image_bytes()], key=key),
        lambda: submit(client, committed_unit, [image_bytes()], key=key),
    )

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    with Session(engine) as session:
        requests = session.scalars(
            select(MaintenanceRequest).where(MaintenanceRequest.unit_id == committed_unit.id)
        ).all()
        assert len(requests) == 1
        created = session.scalar(
            select(func.count())
            .select_from(HistoryEvent)
            .where(HistoryEvent.entity_id == requests[0].id)
        )
        assert created == 1
    assert len(bucket.files) == 1


def test_two_staff_editing_at_once_the_second_gets_409(committed_unit, monkeypatch):
    with Session(engine, expire_on_commit=False) as session:
        request = add_request(session, committed_unit)
        session.commit()
    last_seen = request.updated_at.isoformat()
    app = create_app()
    app.dependency_overrides[require_staff] = lambda: None
    client = TestClient(app)
    # Holds both edits until each has read the same row, so both pass the first stale check.
    both_read = threading.Barrier(2, timeout=10)
    real_existing = service._existing_request

    def read_then_wait(db, request_id):
        found = real_existing(db, request_id)
        both_read.wait()
        return found

    monkeypatch.setattr(service, "_existing_request", read_then_wait)
    url = f"/api/staff/requests/{request.id}"

    responses = run_together(
        lambda: client.patch(url, json={"updated_at": last_seen, "status": "scheduled"}),
        lambda: client.patch(url, json={"updated_at": last_seen, "status": "done"}),
    )

    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response for response in responses if response.status_code == 200)
    with Session(engine) as session:
        saved = session.get(MaintenanceRequest, request.id)
        assert saved.status == RequestStatus(winner.json()["status"])
        changes = session.scalars(
            select(HistoryEvent).where(
                HistoryEvent.entity_id == request.id,
                HistoryEvent.event == HistoryEventType.changed,
            )
        ).all()
        assert [event.new_value for event in changes] == [saved.status]
