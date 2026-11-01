from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select

from app.db import get_db
from app.intake.models import Property, Unit
from app.intake.routes import limiter
from app.main import create_app
from app.phone import normalize_phone
from app.requests import service
from app.requests.models import MaintenanceRequest, RequestSource, RequestStatus
from app.requests.schemas import RequestCreate
from app.requests.service import contact_matches, create_request, next_reference
from app.residents.models import Resident
from app.settings import settings

EMAIL = "pat@example.com"
PHONE = "+15551234567"


@pytest.fixture(autouse=True)
def reset_ip_counters():
    limiter.reset()


@pytest.fixture
def unit(db) -> Unit:
    property_ = Property(name="Oak", address="1 Main St")
    db.add(property_)
    db.flush()
    unit = Unit(property_id=property_.id, label="1A")
    db.add(unit)
    db.flush()
    return unit


@pytest.fixture
def resident(db, unit) -> Resident:
    resident = Resident(unit_id=unit.id, name="Pat", email=EMAIL, phone=PHONE)
    db.add(resident)
    db.flush()
    return resident


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def payload(unit: Unit, **overrides) -> dict:
    return {
        "unit_id": unit.id,
        "tenant_name": "Pat Lee",
        "email": EMAIL,
        "category": "plumbing",
        "description": "The sink is clogged",
        "entry_permission": "notify_first",
        **overrides,
    }


def post(client, body: dict, key: str | None = None, **headers):
    headers["Idempotency-Key"] = key or uuid4().hex
    return client.post("/api/public/requests", json=body, headers=headers)


def request_count(db) -> int:
    return db.scalar(select(func.count()).select_from(MaintenanceRequest))


def contact(active: bool = True, email: str | None = EMAIL, phone: str | None = PHONE):
    return SimpleNamespace(active=active, email=email, phone=phone)


# T25


def test_migration_creates_filter_and_unique_indexes(db):
    inspector = inspect(db.connection())
    indexed = {i["column_names"][0] for i in inspector.get_indexes("requests")}
    assert {"status", "property_id", "category", "unit_id", "created_at"} <= indexed
    unique = {u["column_names"][0] for u in inspector.get_unique_constraints("requests")}
    assert {"reference_number", "idempotency_key"} <= unique


# T26


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"tenant_name": "  "}, "body.tenant_name"),
        ({"tenant_name": "x" * 201}, "body.tenant_name"),
        ({"email": None}, "body"),
        ({"email": "", "phone": " "}, "body"),
        ({"phone": "123-4567"}, "body.phone"),
        ({"email": "not-an-email"}, "body.email"),
        ({"entry_permission": "whenever"}, "body.entry_permission"),
        ({"description": ""}, "body.description"),
        ({"description": "a\x00b"}, "body.description"),
        ({"unit_id": 2**31}, "body.unit_id"),
        ({"category": "roofing"}, "body.category"),
    ],
)
def test_invalid_payload_returns_422_with_field_errors(db, client, unit, overrides, field):
    response = post(client, payload(unit, **overrides))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert field in [f["field"] for f in error["fields"]]
    assert request_count(db) == 0


def test_invalid_phone_is_not_echoed(client, unit):
    response = post(client, payload(unit, phone="555-SECRET"))
    assert response.status_code == 422
    assert "SECRET" not in response.text


def test_missing_required_fields_are_all_reported(client):
    response = post(client, {})
    fields = {f["field"] for f in response.json()["error"]["fields"]}
    assert {"body.unit_id", "body.tenant_name", "body.description"} <= fields


@pytest.mark.parametrize("key", [None, "too-short"])
def test_missing_or_short_idempotency_key_returns_422(db, client, unit, key):
    headers = {"Idempotency-Key": key} if key else {}
    response = client.post("/api/public/requests", json=payload(unit), headers=headers)

    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "header.idempotency-key"
    assert request_count(db) == 0


# T27


def test_reference_numbers_are_unique_and_survive_a_rollback(db):
    first = next_reference(db)
    db.rollback()
    second = next_reference(db)

    assert first.startswith("MR-")
    assert int(second.removeprefix("MR-")) > int(first.removeprefix("MR-"))


# T28


@pytest.mark.parametrize(
    "email, phone, expected",
    [
        (EMAIL, None, True),  # email only
        (None, PHONE, True),  # phone only
        (EMAIL, PHONE, True),  # both
        (EMAIL, "+15559999999", True),  # either one is enough
        ("other@example.com", PHONE, True),
        ("other@example.com", "+15559999999", False),  # neither
        (None, None, False),
    ],
)
def test_contact_matching(email, phone, expected):
    assert contact_matches(email, phone, [contact()]) is expected


def test_empty_unit_is_a_mismatch():
    assert contact_matches(EMAIL, PHONE, []) is False


def test_inactive_resident_does_not_match():
    assert contact_matches(EMAIL, PHONE, [contact(active=False)]) is False


def test_blank_contact_on_both_sides_does_not_match():
    assert contact_matches(None, None, [contact(email=None, phone=None)]) is False


def test_any_resident_of_the_unit_can_match():
    others = contact(email="other@example.com", phone=None)
    assert contact_matches(EMAIL, None, [others, contact()]) is True


@pytest.mark.parametrize("raw", ["(555) 123-4567", "555-123-4567", "+15551234567"])
def test_phone_format_variants_match(raw):
    assert contact_matches(None, normalize_phone(raw), [contact()]) is True


# T29


def create_data(unit: Unit, **overrides) -> RequestCreate:
    return RequestCreate(**payload(unit, **overrides))


def test_matched_request_is_saved_as_new_and_not_flagged(db, unit, resident):
    created = create_request(db, create_data(unit, email="PAT@example.com"), uuid4().hex)

    db.refresh(created)
    assert created.status == RequestStatus.new
    assert created.source == RequestSource.tenant_form
    assert created.unit_id == unit.id
    assert created.property_id == unit.property_id
    assert created.email == EMAIL
    assert created.contact_matched is True
    assert created.needs_review is False
    assert created.urgent is False
    assert created.followup_answers == {}


def test_mismatched_request_is_saved_and_flagged(db, unit, resident):
    created = create_request(db, create_data(unit, email="stranger@example.com"), uuid4().hex)

    db.refresh(created)
    assert created.contact_matched is False
    assert created.needs_review is True


def test_unit_with_no_residents_is_saved_and_flagged(db, unit):
    created = create_request(db, create_data(unit), uuid4().hex)
    assert created.needs_review is True


def test_resident_of_another_unit_does_not_match(db, unit):
    other = Unit(property_id=unit.property_id, label="1B")
    db.add(other)
    db.flush()
    db.add(Resident(unit_id=other.id, name="Pat", email=EMAIL))
    db.flush()

    assert create_request(db, create_data(unit), uuid4().hex).needs_review is True


def test_same_key_twice_returns_the_original(db, unit):
    key = uuid4().hex
    first = create_request(db, create_data(unit), key)
    second = create_request(db, create_data(unit, description="Different"), key)

    assert second.id == first.id
    assert second.description == "The sink is clogged"
    assert request_count(db) == 1


def test_losing_a_simultaneous_submit_returns_the_winner(db, unit, monkeypatch):
    key = uuid4().hex
    winner = create_request(db, create_data(unit), key)

    # The other submit has not committed when this one looks, so its first lookup misses.
    real_find = service._find_by_key
    lookups = iter([None])
    monkeypatch.setattr(
        service, "_find_by_key", lambda *args: next(lookups, "real") and real_find(*args)
    )

    assert create_request(db, create_data(unit), key).id == winner.id
    assert request_count(db) == 1


# T30


def test_valid_request_is_stored_and_only_the_reference_is_returned(db, client, unit):
    response = post(client, payload(unit, phone="(555) 123-4567", urgent=True))

    assert response.status_code == 201
    saved = db.scalar(select(MaintenanceRequest))
    assert response.json() == {"reference_number": saved.reference_number}
    assert saved.phone == PHONE
    assert saved.tenant_name == "Pat Lee"
    assert saved.entry_permission == "notify_first"
    assert saved.urgent is False  # a client-sent flag is never trusted


def test_repeat_submit_returns_the_same_response(db, client, unit):
    key = uuid4().hex
    first = post(client, payload(unit), key)
    second = post(client, payload(unit), key)

    assert second.status_code == first.status_code == 201
    assert second.json() == first.json()
    assert request_count(db) == 1


def test_mismatched_contact_is_accepted_and_flagged(db, client, unit, resident):
    response = post(client, payload(unit, email="stranger@example.com"))

    assert response.status_code == 201
    assert list(response.json()) == ["reference_number"]
    assert db.scalar(select(MaintenanceRequest)).needs_review is True


def test_phone_variant_matches_the_roster_through_the_api(db, client, unit, resident):
    post(client, payload(unit, email=None, phone="555-123-4567"))
    assert db.scalar(select(MaintenanceRequest)).needs_review is False


def test_unknown_or_inactive_unit_returns_422(db, client, unit):
    db.add(Unit(property_id=unit.property_id, label="closed", active=False))
    db.flush()
    closed = db.scalar(select(Unit).where(Unit.label == "closed"))

    for unit_id in (closed.id, closed.id + 1):
        response = post(client, {**payload(unit), "unit_id": unit_id})
        assert response.status_code == 422
        assert response.json()["error"]["fields"][0]["field"] == "body.unit_id"


def test_unit_of_inactive_property_returns_422(db, client, unit):
    db.get(Property, unit.property_id).active = False
    db.flush()

    assert post(client, payload(unit)).status_code == 422


# T31


def test_nth_request_from_one_ip_gets_429(db, caplog, client, unit, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_ip", "2/minute")
    ip = {"cf-connecting-ip": "203.0.113.7"}

    assert post(client, payload(unit), **ip).status_code == 201
    assert post(client, payload(unit), **ip).status_code == 201
    response = post(client, payload(unit), **ip)

    assert response.status_code == 429
    assert response.json() == {
        "error": {
            "code": "too_many_requests",
            "message": "Too many requests, please call the office",
        }
    }
    assert request_count(db) == 2
    assert "ratelimit" in caplog.text


def test_ip_limit_uses_the_cloudflare_header(client, unit, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_ip", "1/minute")

    assert post(client, payload(unit), **{"cf-connecting-ip": "203.0.113.7"}).status_code == 201
    assert post(client, payload(unit), **{"cf-connecting-ip": "203.0.113.8"}).status_code == 201
    assert post(client, payload(unit), **{"cf-connecting-ip": "203.0.113.7"}).status_code == 429


# T32


def test_too_many_requests_for_one_unit_get_429(db, caplog, client, unit, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_unit_per_hour", 2)
    other = Unit(property_id=unit.property_id, label="1B")
    db.add(other)
    db.flush()

    assert post(client, payload(unit)).status_code == 201
    assert post(client, payload(unit)).status_code == 201
    response = post(client, payload(unit))

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_requests"
    assert request_count(db) == 2
    assert "rate limit exceeded for unit" in caplog.text
    assert post(client, payload(other)).status_code == 201


def test_retry_at_the_unit_limit_still_returns_the_original(client, unit, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_unit_per_hour", 1)
    key = uuid4().hex
    first = post(client, payload(unit), key)

    second = post(client, payload(unit), key)

    assert second.status_code == 201
    assert second.json() == first.json()


def stored_request(unit: Unit, source=RequestSource.tenant_form, **fields) -> MaintenanceRequest:
    return MaintenanceRequest(
        reference_number=f"MR-TEST-{uuid4().hex}",
        unit_id=unit.id,
        property_id=unit.property_id,
        tenant_name="Pat",
        category="other",
        description="Old",
        entry_permission="anytime",
        source=source,
        contact_matched=True,
        **fields,
    )


def test_unit_limit_ignores_old_and_staff_logged_requests(db, client, unit, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_unit_per_hour", 1)
    two_hours_ago = datetime.now(UTC) - timedelta(hours=2)
    db.add(stored_request(unit, created_at=two_hours_ago))
    db.add(stored_request(unit, source=RequestSource.phone))
    db.flush()

    assert post(client, payload(unit)).status_code == 201


# T33


def test_filled_honeypot_looks_like_success_and_saves_nothing(db, client, unit):
    response = post(client, payload(unit, website="https://spam.example"))

    assert response.status_code == 201
    assert list(response.json()) == ["reference_number"]
    assert response.json()["reference_number"].startswith("MR-")
    assert request_count(db) == 0


def test_blank_honeypot_is_treated_as_empty(db, client, unit):
    assert post(client, payload(unit, website="  ")).status_code == 201
    assert request_count(db) == 1


def test_kill_switch_closes_the_form_with_a_distinct_code(db, client, unit, monkeypatch):
    monkeypatch.setattr(settings, "public_form_enabled", False)

    response = post(client, payload(unit))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "form_closed"
    assert "call" in response.json()["error"]["message"]
    assert request_count(db) == 0


def test_kill_switch_reports_closed_before_validating(client, monkeypatch):
    monkeypatch.setattr(settings, "public_form_enabled", False)
    assert post(client, {}).json()["error"]["code"] == "form_closed"


def test_kill_switch_leaves_the_read_routes_open(client, monkeypatch):
    monkeypatch.setattr(settings, "public_form_enabled", False)
    assert client.get("/api/public/config").status_code == 200
