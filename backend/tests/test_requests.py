import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, inspect, select

from app.db import get_db
from app.intake.form_config import FORM_CONFIG_PATH, MAX_TEXT_ANSWER, load_form_config
from app.intake.models import Property, Unit
from app.intake.routes import limiter
from app.main import create_app
from app.phone import normalize_phone
from app.requests import service
from app.requests.models import MaintenanceRequest, RequestSource, RequestStatus
from app.requests.schemas import RequestCreate
from app.requests.service import contact_matches, next_reference
from app.residents.models import Resident
from app.settings import settings

EMAIL = "pat@example.com"
PHONE = "+15551234567"
CATEGORIES = {c.id: c for c in load_form_config(FORM_CONFIG_PATH).categories}
PLUMBING_ANSWERS = {"problem": "leak", "location": "kitchen"}
AC_ANSWERS = {
    "symptom": "not_turning_on",
    "filter_changed": "not_sure",
    "above_90": "no",
    "gas_smell": "no",
}
ELECTRICAL_ANSWERS = {"problem": "flickering", "extent": "one_room"}
OTHER_ANSWERS = {"gas_smell": "no"}


def create_request(db, data: RequestCreate, key: str) -> MaintenanceRequest:
    return service.create_request(db, data, key, CATEGORIES[data.category])


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
        "followup_answers": PLUMBING_ANSWERS,
        "not_an_emergency": True,
        **overrides,
    }


def post(client, body: dict, key: str | None = None, **headers):
    headers["Idempotency-Key"] = key or uuid4().hex
    return client.post("/api/public/requests", data={"data": json.dumps(body)}, headers=headers)


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
    body = {"data": json.dumps(payload(unit))}
    response = client.post("/api/public/requests", data=body, headers=headers)

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
    assert created.followup_answers == PLUMBING_ANSWERS


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
    response = client.get("/api/public/config")
    assert response.status_code == 200
    assert response.json()["form_enabled"] is False


def test_public_config_says_the_form_is_open_by_default(client):
    assert client.get("/api/public/config").json()["form_enabled"] is True


# T34


def boot_with_changed_config(tmp_path, change) -> None:
    config = json.loads(FORM_CONFIG_PATH.read_text(encoding="utf-8"))
    change({c["id"]: c for c in config["categories"]})
    path = tmp_path / "form_config.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    create_app(form_config_path=path)


def test_the_real_config_boots_unchanged(tmp_path):
    boot_with_changed_config(tmp_path, lambda categories: None)


def set_question_count(categories, count: int) -> None:
    pest = categories["pest"]
    pest["questions"] = [
        {**pest["questions"][0], "id": f"question_{i}"} for i in range(count)
    ]


@pytest.mark.parametrize("count", [1, 5])
def test_question_count_outside_2_to_4_stops_the_app_from_booting(tmp_path, count):
    with pytest.raises(ValidationError, match="questions"):
        boot_with_changed_config(tmp_path, lambda c: set_question_count(c, count))


@pytest.mark.parametrize("count", [2, 4])
def test_question_count_of_2_and_4_boots(tmp_path, count):
    boot_with_changed_config(tmp_path, lambda c: set_question_count(c, count))


def duplicate_question_id(categories) -> None:
    questions = categories["pest"]["questions"]
    questions[1]["id"] = questions[0]["id"]


def one_option_only(categories) -> None:
    question = categories["pest"]["questions"][0]
    question["options"] = question["options"][:1]


def duplicate_option_value(categories) -> None:
    options = categories["pest"]["questions"][0]["options"]
    options[1]["value"] = options[0]["value"]


def text_question_with_options(categories) -> None:
    categories["pest"]["questions"][0]["type"] = "text"


def unknown_question_type(categories) -> None:
    categories["pest"]["questions"][0]["type"] = "checkbox"


@pytest.mark.parametrize(
    "change",
    [
        duplicate_question_id,
        one_option_only,
        duplicate_option_value,
        text_question_with_options,
        unknown_question_type,
    ],
)
def test_malformed_questions_stop_the_app_from_booting(tmp_path, change):
    with pytest.raises(ValidationError):
        boot_with_changed_config(tmp_path, change)


# T35, T36


def test_ac_asks_symptom_filter_and_temperature():
    questions = {q.id: q for q in CATEGORIES["ac_heating"].questions}

    assert {"warm_air", "not_turning_on"} <= {o.value for o in questions["symptom"].options}
    assert "filter" in questions["filter_changed"].label
    assert "90°F" in questions["above_90"].label


# T37


@pytest.mark.parametrize(
    "answers, field",
    [
        ({"location": "kitchen"}, "body.followup_answers.problem"),  # missing required
        ({"problem": "  ", "location": "kitchen"}, "body.followup_answers.problem"),  # blank
        ({"problem": "roof", "location": "kitchen"}, "body.followup_answers.problem"),  # option
        ({"problem": "leak\x00", "location": "kitchen"}, "body.followup_answers.problem"),
        ({**PLUMBING_ANSWERS, "pest_type": "ants"}, "body.followup_answers"),  # another category
        ({**PLUMBING_ANSWERS, "made_up": "x"}, "body.followup_answers"),
        ({}, "body.followup_answers.problem"),
    ],
)
def test_bad_answers_return_422(db, client, unit, answers, field):
    response = post(client, payload(unit, followup_answers=answers))

    assert response.status_code == 422
    assert field in [f["field"] for f in response.json()["error"]["fields"]]
    assert request_count(db) == 0


def test_non_text_answer_returns_422(db, client, unit):
    answers = {**PLUMBING_ANSWERS, "problem": 1}
    assert post(client, payload(unit, followup_answers=answers)).status_code == 422
    assert request_count(db) == 0


def test_answer_errors_do_not_echo_the_input(client, unit):
    answers = {"problem": "SECRET", "SECRET": "x", "location": "kitchen"}
    response = post(client, payload(unit, followup_answers=answers))

    assert response.status_code == 422
    assert "SECRET" not in response.text


def other_payload(unit: Unit, location: str | None = None) -> dict:
    answers = OTHER_ANSWERS if location is None else {**OTHER_ANSWERS, "location": location}
    return payload(unit, category="other", followup_answers=answers)


def test_optional_answer_may_be_missing_and_blank_is_not_stored(db, client, unit):
    assert post(client, other_payload(unit)).status_code == 201
    assert post(client, other_payload(unit, "   ")).status_code == 201

    saved = db.scalars(select(MaintenanceRequest)).all()
    assert [request.followup_answers for request in saved] == [OTHER_ANSWERS, OTHER_ANSWERS]


def test_text_answer_is_stored_trimmed(db, client, unit):
    assert post(client, other_payload(unit, " Hallway ")).status_code == 201

    saved = db.scalar(select(MaintenanceRequest))
    assert saved.followup_answers["location"] == "Hallway"


@pytest.mark.parametrize("location", ["x" * (MAX_TEXT_ANSWER + 1), "hall\x00way"])
def test_bad_text_answer_returns_422(db, client, unit, location):
    response = post(client, other_payload(unit, location))

    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "body.followup_answers.location"
    assert request_count(db) == 0


# T38


def self_check_on_pest(categories) -> None:
    categories["pest"]["questions"][0]["options"][0]["self_check"] = {
        "id": "x",
        "text": "Try this",
        "pending_client_approval": True,
    }


def self_check_on_flooding(categories) -> None:
    options = categories["plumbing"]["questions"][0]["options"]
    flooding = next(o for o in options if o["value"] == "active_flooding")
    flooding["self_check"] = {"id": "x", "text": "Try this", "pending_client_approval": True}


@pytest.mark.parametrize("change", [self_check_on_pest, self_check_on_flooding])
def test_self_check_outside_the_allowed_answers_stops_the_app_from_booting(tmp_path, change):
    with pytest.raises(ValidationError, match="self-check"):
        boot_with_changed_config(tmp_path, change)


def test_public_config_returns_self_checks_and_urgent_answers(client):
    categories = {c["id"]: c for c in client.get("/api/public/config").json()["categories"]}

    options = {o["value"]: o for o in categories["plumbing"]["questions"][0]["options"]}
    assert options["clogged_drain"]["self_check"]["id"] == "clogged_drain"
    assert options["active_flooding"]["urgent"] is True
    assert options["leak"]["self_check"] is None
    assert options["leak"]["urgent"] is False


# T39


def self_checks(category_id: str) -> list:
    return [
        (option.value, option.self_check)
        for question in CATEGORIES[category_id].questions
        for option in question.options
        if option.self_check
    ]


def test_electrical_self_check_is_on_its_matching_answer_only():
    assert [value for value, _ in self_checks("electrical")] == ["outlet_or_lights_out"]


def test_all_self_check_wording_is_marked_pending_client_approval():
    found = self_checks("electrical") + self_checks("plumbing")
    assert len(found) == 2
    assert all(check.pending_client_approval for _, check in found)


# T40


def test_self_check_shown_and_tried_are_stored(db, client, unit):
    answers = {"problem": "clogged_drain", "location": "kitchen"}
    post(client, payload(unit, followup_answers=answers, self_check_tried=True))

    saved = db.scalar(select(MaintenanceRequest))
    assert saved.self_check_shown == "clogged_drain"
    assert saved.self_check_tried is True


def test_self_check_shown_but_not_tried(db, client, unit):
    answers = {"problem": "clogged_drain", "location": "kitchen"}
    post(client, payload(unit, followup_answers=answers))

    saved = db.scalar(select(MaintenanceRequest))
    assert saved.self_check_shown == "clogged_drain"
    assert saved.self_check_tried is False


def test_client_cannot_claim_a_self_check_that_did_not_apply(db, client, unit):
    post(client, payload(unit, self_check_tried=True, self_check_shown="clogged_drain"))

    saved = db.scalar(select(MaintenanceRequest))
    assert saved.self_check_shown is None
    assert saved.self_check_tried is False


# T41


@pytest.mark.parametrize(
    "category, answers",
    [
        ("ac_heating", {**AC_ANSWERS, "above_90": "yes"}),
        ("ac_heating", {**AC_ANSWERS, "gas_smell": "yes"}),
        ("appliance", {"appliance": "stove_oven", "working": "partly", "gas_smell": "yes"}),
        ("other", {"gas_smell": "yes"}),
        ("electrical", {**ELECTRICAL_ANSWERS, "problem": "sparks"}),
        ("electrical", {**ELECTRICAL_ANSWERS, "problem": "burning_smell"}),
        ("plumbing", {**PLUMBING_ANSWERS, "problem": "active_flooding"}),
    ],
)
def test_urgent_answers_set_the_flag_and_the_request_is_accepted(
    db, client, unit, category, answers
):
    response = post(client, payload(unit, category=category, followup_answers=answers))

    assert response.status_code == 201
    assert list(response.json()) == ["reference_number"]
    assert db.scalar(select(MaintenanceRequest)).urgent is True


def test_client_cannot_clear_the_urgent_flag(db, client, unit):
    answers = {**AC_ANSWERS, "above_90": "yes"}
    post(client, payload(unit, category="ac_heating", followup_answers=answers, urgent=False))

    assert db.scalar(select(MaintenanceRequest)).urgent is True


def test_ordinary_ac_answers_are_not_urgent(db, client, unit):
    response = post(client, payload(unit, category="ac_heating", followup_answers=AC_ANSWERS))

    assert response.status_code == 201
    assert db.scalar(select(MaintenanceRequest)).urgent is False


# T42


@pytest.mark.parametrize("tick", [{"not_an_emergency": False}, {}])
def test_flag_on_rejects_a_missing_tick(db, client, unit, tick):
    body = {k: v for k, v in payload(unit).items() if k != "not_an_emergency"} | tick

    response = post(client, body)

    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "body.not_an_emergency"
    assert request_count(db) == 0


def test_flag_off_removes_the_requirement(db, client, unit):
    client.app.state.form_config.require_emergency_ack = False

    response = post(client, payload(unit, not_an_emergency=False))

    assert response.status_code == 201
    assert db.scalar(select(MaintenanceRequest)).emergency_ack_at is None


def test_tick_stores_a_server_timestamp(db, client, unit):
    client_time = "2000-01-01T00:00:00+00:00"
    post(client, payload(unit, emergency_ack_at=client_time))

    saved = db.scalar(select(MaintenanceRequest))
    assert saved.emergency_ack_at == db.scalar(select(func.now()))


# T43


def test_public_config_returns_the_emergency_number(client):
    config = client.get("/api/public/config").json()

    assert config["emergency_number"] == "(000) 000-0000"
    assert config["require_emergency_ack"] is True
