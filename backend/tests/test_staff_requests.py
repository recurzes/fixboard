from datetime import UTC, datetime, timedelta, timezone
from itertools import count as counter
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.assignees.models import Assignee, AssigneeKind
from app.db import MAX_ID, get_db
from app.intake.models import Property, Unit
from app.main import create_app
from app.photos.models import Photo
from app.requests.models import (
    EntryPermission,
    MaintenanceRequest,
    Note,
    RequestSource,
    RequestStatus,
)
from app.requests.queries import PAGE_SIZE
from app.requests.rules import can_transition, resolve_status
from app.requests.schemas import RequestPatch
from app.requests.service import update_request
from app.settings import settings
from app.staff.auth import require_staff
from app.staff.models import StaffUser

REQUESTS = "/api/staff/requests"
ASSIGNEES = "/api/staff/assignees"
NOW = datetime(2026, 11, 1, 12, tzinfo=UTC)
_references = counter(1001)


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_staff] = lambda: None
    return TestClient(app)


@pytest.fixture
def oak(db) -> Unit:
    return add_unit(db, "Oak", "1A")


def add_unit(db, property_name: str, label: str) -> Unit:
    property_ = Property(name=property_name, address="1 Main St")
    db.add(property_)
    db.flush()
    unit = Unit(property_id=property_.id, label=label)
    db.add(unit)
    db.flush()
    return unit


def add_request(db, unit: Unit, **fields) -> MaintenanceRequest:
    request = MaintenanceRequest(
        **{
            "reference_number": f"MR-{next(_references)}",
            "unit_id": unit.id,
            "property_id": unit.property_id,
            "tenant_name": "Pat Lee",
            "phone": "+15551234567",
            "email": "pat@example.com",
            "category": "plumbing",
            "description": "The sink is clogged",
            "entry_permission": EntryPermission.notify_first,
            "source": RequestSource.tenant_form,
            "contact_matched": True,
            **fields,
        }
    )
    db.add(request)
    db.flush()
    return request


def references(response) -> list[str]:
    assert response.status_code == 200
    return [item["reference_number"] for item in response.json()["items"]]


def test_every_route_requires_staff(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    for path in (
        REQUESTS,
        f"{REQUESTS}/summary",
        f"{REQUESTS}/1",
        f"{REQUESTS}/1/photos/1",
        ASSIGNEES,
    ):
        assert client.get(path).status_code == 401
    assert client.post(REQUESTS, json={}).status_code == 401
    assert client.patch(f"{REQUESTS}/1", json={}).status_code == 401
    assert client.post(f"{REQUESTS}/1/notes", json={}).status_code == 401
    assert client.post(ASSIGNEES, json={}).status_code == 401
    assert client.patch(f"{ASSIGNEES}/1", json={}).status_code == 401


# T52


def test_each_filter_and_their_combination(db, client, oak):
    elm = add_unit(db, "Elm", "2B")
    plain = add_request(db, oak)
    on_elm = add_request(db, elm)
    scheduled = add_request(db, oak, status=RequestStatus.scheduled)
    pest = add_request(db, oak, category="pest")
    review = add_request(db, oak, needs_review=True)
    urgent = add_request(db, oak, urgent=True)
    both = add_request(db, elm, category="pest", urgent=True, needs_review=True)

    def found(**params) -> set[str]:
        return set(references(client.get(REQUESTS, params=params)))

    def refs(*requests) -> set[str]:
        return {request.reference_number for request in requests}

    assert found(property=elm.property_id) == refs(on_elm, both)
    assert found(property=[oak.property_id, elm.property_id]) == refs(
        plain, on_elm, scheduled, pest, review, urgent, both
    )
    assert found(status="scheduled") == refs(scheduled)
    assert found(status=["scheduled", "new"], property=elm.property_id) == refs(on_elm, both)
    assert found(category="pest") == refs(pest, both)
    assert found(category=["pest", "plumbing"], status="scheduled") == refs(scheduled)
    assert found(needs_review=True) == refs(review, both)
    assert both.reference_number not in found(needs_review=False)
    assert found(urgent=True) == refs(urgent, both)
    assert urgent.reference_number not in found(urgent=False)
    assert found(property=elm.property_id, category="pest", urgent=True, needs_review=True) == refs(
        both
    )
    assert found(property=oak.property_id, category="pest", urgent=True) == set()


@pytest.mark.parametrize(
    "params",
    [
        {"status": "cancelled"},
        {"property": "abc"},
        {"property": MAX_ID + 1},
        {"property": -(MAX_ID + 2)},
        {"category": "a\x00b"},
        {"q": "a\x00b"},
        {"q": "x" * 201},
        {"needs_review": "maybe"},
    ],
    ids=[
        "status",
        "property",
        "huge-property",
        "negative-property",
        "nul-category",
        "nul-q",
        "long-q",
        "bool",
    ],
)
def test_bad_filters_return_422_without_echoing_them(client, params):
    response = client.get(REQUESTS, params=params)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert str(next(iter(params.values()))) not in response.text


# T53


@pytest.mark.parametrize(
    "q",
    ["MR-5001", "mr-5001", " MR-5001 ", "5001", "12c", "12C", "jordan", "JORDAN", "rdan bl"],
)
def test_search_is_partial_and_case_insensitive(db, client, q):
    unit = add_unit(db, "Oak", "12C")
    match = add_request(db, unit, reference_number="MR-5001", tenant_name="Jordan Blake")
    add_request(db, add_unit(db, "Elm", "7D"), reference_number="MR-6002", tenant_name="Sam Hill")

    assert references(client.get(REQUESTS, params={"q": q})) == [match.reference_number]


def test_a_reference_number_finds_exactly_one_request(db, client, oak):
    add_request(db, oak, reference_number="MR-1042")
    add_request(db, oak, reference_number="MR-10420")
    add_request(db, oak, reference_number="MR-10421")

    assert references(client.get(REQUESTS, params={"q": "mr-1042"})) == ["MR-1042"]
    assert len(references(client.get(REQUESTS, params={"q": "MR-1042 "}))) == 1
    assert len(references(client.get(REQUESTS, params={"q": "MR-104"}))) == 3


@pytest.mark.parametrize("q", ["%", "_", "/", "a%b", "a_b"])
def test_search_wildcards_are_literal(db, client, oak, q):
    add_request(db, oak, tenant_name="Plain Name")
    literal = add_request(db, oak, tenant_name=f"Odd {q} Name")

    assert references(client.get(REQUESTS, params={"q": q})) == [literal.reference_number]


def test_blank_search_is_ignored(db, client, oak):
    add_request(db, oak)
    assert len(references(client.get(REQUESTS, params={"q": "   "}))) == 1


def test_search_text_stays_out_of_the_logs(db, client, oak, caplog):
    with caplog.at_level("DEBUG"):
        client.get(REQUESTS, params={"q": "Jordan Blake"})
    # httpx2 is the test client, so its line is not one the server would write.
    server_lines = [r.getMessage() for r in caplog.records if r.name != "httpx2"]
    assert server_lines
    assert not any("Jordan" in line for line in server_lines)


# T54


def test_paging_through_60_rows_has_no_duplicates_or_gaps(db, client, oak):
    # Half share one timestamp, the case a sort on created time alone would get wrong.
    created = [
        add_request(db, oak, created_at=NOW - timedelta(minutes=0 if i < 30 else i))
        for i in range(60)
    ]
    expected = sorted(created, key=lambda r: (r.created_at, r.id), reverse=True)

    seen, sizes, cursor = [], [], None
    while True:
        params = {"cursor": cursor} if cursor else {}
        body = client.get(REQUESTS, params=params).json()
        seen += [item["reference_number"] for item in body["items"]]
        sizes.append(len(body["items"]))
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert seen == [request.reference_number for request in expected]
    assert sizes == [PAGE_SIZE, PAGE_SIZE, 10]


def test_exactly_one_full_page_has_no_next_cursor(db, client, oak):
    for _ in range(PAGE_SIZE):
        add_request(db, oak)
    assert client.get(REQUESTS).json()["next_cursor"] is None


def test_paging_keeps_the_filters(db, client, oak):
    for i in range(60):
        add_request(db, oak, urgent=i % 2 == 0, created_at=NOW - timedelta(minutes=i))
    first = client.get(REQUESTS, params={"urgent": True}).json()
    params = {"urgent": True, "cursor": first["next_cursor"]}
    second = client.get(REQUESTS, params=params).json()

    assert len(first["items"]) == PAGE_SIZE
    assert len(second["items"]) == 5
    assert all(item["urgent"] for item in first["items"] + second["items"])
    assert second["next_cursor"] is None


@pytest.mark.parametrize(
    "cursor",
    [
        "garbage",
        "1_2_3",
        "20261301000000000000_1",
        "20261101000000000000_abc",
        f"20261101000000000000_{MAX_ID + 1}",
        "20261101000000000000_0",
    ],
)
def test_bad_cursor_returns_422(client, cursor):
    response = client.get(REQUESTS, params={"cursor": cursor})
    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "query.cursor"


# T55


def test_done_requests_appear_only_when_asked_for(db, client, oak):
    open_ = add_request(db, oak)
    done = add_request(db, oak, status=RequestStatus.done)

    assert references(client.get(REQUESTS)) == [open_.reference_number]
    both = set(references(client.get(REQUESTS, params={"include_done": True})))
    assert both == {open_.reference_number, done.reference_number}
    named = client.get(REQUESTS, params={"status": "done"})
    assert references(named) == [done.reference_number]
    # A status filter stays exact, so this does not add Done to the New rows it asked for.
    narrowed = client.get(REQUESTS, params={"status": "new", "include_done": True})
    assert references(narrowed) == [open_.reference_number]


def test_each_row_says_new_urgent_and_needs_review_without_contact_details(db, client, oak):
    vendor = Assignee(name="Plumber", kind=AssigneeKind.outside_vendor, active=False)
    db.add(vendor)
    db.flush()
    add_request(db, oak, urgent=True, needs_review=True, assignee_id=vendor.id)

    row = client.get(REQUESTS).json()["items"][0]

    assert (row["status"], row["urgent"], row["needs_review"]) == ("new", True, True)
    assert (row["property_name"], row["unit_label"]) == ("Oak", "1A")
    assert row["assignee_name"] == "Plumber"  # still named after being deactivated
    for private in ("phone", "email", "description", "entry_notes", "idempotency_key"):
        assert private not in row


# T56


def test_summary_counts_by_status_and_open_flags(db, client, oak):
    add_request(db, oak)
    add_request(db, oak, urgent=True, needs_review=True)
    add_request(db, oak, status=RequestStatus.scheduled, urgent=True)
    add_request(db, oak, status=RequestStatus.done, urgent=True, needs_review=True)

    assert client.get(f"{REQUESTS}/summary").json() == {
        "by_status": {"new": 2, "scheduled": 1, "waiting_on_vendor": 0, "done": 1},
        "open_urgent": 2,
        "open_needs_review": 1,
    }


def test_new_count_matches_the_list(db, client, oak):
    for status in [RequestStatus.new] * 3 + [RequestStatus.done, RequestStatus.scheduled]:
        add_request(db, oak, status=status)

    summary = client.get(f"{REQUESTS}/summary").json()
    listed = references(client.get(REQUESTS, params={"status": "new"}))
    assert summary["by_status"]["new"] == len(listed) == 3


def test_summary_of_nothing_is_zeros(db, client):
    assert client.get(f"{REQUESTS}/summary").json() == {
        "by_status": {"new": 0, "scheduled": 0, "waiting_on_vendor": 0, "done": 0},
        "open_urgent": 0,
        "open_needs_review": 0,
    }


# T57


def add_photo(db, request: MaintenanceRequest) -> Photo:
    photo = Photo(
        request_id=request.id,
        storage_path=f"requests/{request.id}/{uuid4().hex}.jpg",
        content_type="image/jpeg",
        size_bytes=10,
    )
    db.add(photo)
    db.flush()
    return photo


def test_detail_returns_everything_staff_need(db, client, oak):
    request = add_request(
        db,
        oak,
        followup_answers={"problem": "leak"},
        entry_notes="Dog in the unit",
        contact_matched=False,
        needs_review=True,
        self_check_shown="clogged_drain",
        self_check_tried=True,
        emergency_ack_at=NOW,
    )
    photos = [add_photo(db, request), add_photo(db, request)]

    response = client.get(f"{REQUESTS}/{request.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["followup_answers"] == {"problem": "leak"}
    assert body["entry_permission"] == "notify_first"
    assert body["entry_notes"] == "Dog in the unit"
    assert body["contact_matched"] is False
    assert body["needs_review"] is True
    assert body["self_check_shown"] == "clogged_drain"
    assert body["self_check_tried"] is True
    assert body["phone"] == "+15551234567"
    assert body["email"] == "pat@example.com"
    assert body["description"] == "The sink is clogged"
    assert body["source"] == "tenant_form"
    assert body["unit_label"] == "1A"
    assert body["photo_ids"] == [photo.id for photo in photos]
    assert body["notes"] == []
    assert "idempotency_key" not in body
    assert "storage_path" not in response.text


@pytest.mark.parametrize("id_", [999999, MAX_ID + 1, -(MAX_ID + 1)])
def test_detail_of_unknown_id_is_404(db, client, id_):
    assert client.get(f"{REQUESTS}/{id_}").status_code == 404


# T58


def test_photo_url_is_short_lived_and_signed(db, client, oak, monkeypatch):
    monkeypatch.setattr(settings, "signed_url_seconds", 120)
    photo = add_photo(db, add_request(db, oak))

    response = client.get(f"{REQUESTS}/{photo.request_id}/photos/{photo.id}")

    assert response.status_code == 200
    url = response.json()["url"]
    assert photo.storage_path in url
    assert "X-Amz-Signature=" in url
    assert "X-Amz-Expires=120" in url


def test_photo_from_another_request_is_404(db, client, oak):
    photo = add_photo(db, add_request(db, oak))
    other = add_request(db, oak)
    assert client.get(f"{REQUESTS}/{other.id}/photos/{photo.id}").status_code == 404


@pytest.mark.parametrize("photo_id", [999999, MAX_ID + 1])
def test_unknown_photo_is_404(db, client, oak, photo_id):
    request = add_request(db, oak)
    assert client.get(f"{REQUESTS}/{request.id}/photos/{photo_id}").status_code == 404


def test_photo_url_stays_out_of_the_logs(db, client, oak, caplog):
    photo = add_photo(db, add_request(db, oak))
    with caplog.at_level("INFO"):
        client.get(f"{REQUESTS}/{photo.request_id}/photos/{photo.id}")
    assert "X-Amz-Signature" not in caplog.text


# T59


@pytest.mark.parametrize(
    ("current", "target"), [(c, t) for c in RequestStatus for t in RequestStatus]
)
def test_every_status_can_move_to_every_status(current, target):
    assert can_transition(current, target) is True


# T60

_WAITING = RequestStatus.waiting_on_vendor
_VENDOR = AssigneeKind.outside_vendor
_IN_HOUSE = AssigneeKind.in_house


@pytest.mark.parametrize(
    ("current", "requested", "kind", "expected"),
    [
        # Losing the vendor moves it off Waiting on vendor.
        (_WAITING, None, _IN_HOUSE, RequestStatus.scheduled),
        (_WAITING, None, None, RequestStatus.scheduled),
        (_WAITING, None, _VENDOR, _WAITING),
        # Only Waiting on vendor is affected.
        (RequestStatus.new, None, _IN_HOUSE, RequestStatus.new),
        (RequestStatus.done, None, None, RequestStatus.done),
        (RequestStatus.scheduled, None, _VENDOR, RequestStatus.scheduled),
        # A named status wins over the automatic move.
        (_WAITING, RequestStatus.done, None, RequestStatus.done),
        (_WAITING, RequestStatus.new, _IN_HOUSE, RequestStatus.new),
        (RequestStatus.new, _WAITING, _VENDOR, _WAITING),
    ],
)
def test_resolve_status(current, requested, kind, expected):
    assert resolve_status(current, requested, kind) == expected


@pytest.mark.parametrize("kind", [_IN_HOUSE, None])
@pytest.mark.parametrize("current", list(RequestStatus))
def test_waiting_on_vendor_needs_an_outside_vendor(current, kind):
    with pytest.raises(ValueError, match="outside vendor"):
        resolve_status(current, _WAITING, kind)


# T61


def add_assignee(db, name="Plumber", kind=AssigneeKind.outside_vendor, active=True) -> Assignee:
    assignee = Assignee(name=name, kind=kind, active=active)
    db.add(assignee)
    db.flush()
    return assignee


def patch_request(client, request: MaintenanceRequest, **fields):
    """Sends the request's current updated_at, as a dashboard that just loaded it would."""
    seen = client.get(f"{REQUESTS}/{request.id}").json()["updated_at"]
    return client.patch(f"{REQUESTS}/{request.id}", json={"updated_at": seen, **fields})


def test_patch_changes_each_field(db, client, oak):
    vendor = add_assignee(db)
    request = add_request(db, oak, needs_review=True)

    response = patch_request(
        client,
        request,
        status="waiting_on_vendor",
        assignee_id=vendor.id,
        scheduled_at="2026-11-05T09:00:00-05:00",
        needs_review=False,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "waiting_on_vendor"
    assert (body["assignee_id"], body["assignee_name"]) == (vendor.id, "Plumber")
    assert datetime.fromisoformat(body["scheduled_at"]) == datetime(2026, 11, 5, 14, tzinfo=UTC)
    assert body["needs_review"] is False


def test_patch_leaves_fields_it_does_not_send(db, client, oak):
    vendor = add_assignee(db)
    request = add_request(
        db, oak, assignee_id=vendor.id, scheduled_at=NOW, needs_review=True
    )

    body = patch_request(client, request, status="scheduled").json()

    assert body["assignee_id"] == vendor.id
    assert datetime.fromisoformat(body["scheduled_at"]) == NOW
    assert body["needs_review"] is True


def test_patch_null_unassigns_and_clears_the_time(db, client, oak):
    vendor = add_assignee(db)
    request = add_request(db, oak, assignee_id=vendor.id, scheduled_at=NOW)

    body = patch_request(client, request, assignee_id=None, scheduled_at=None).json()

    assert body["assignee_id"] is None
    assert body["scheduled_at"] is None


def test_stale_patch_is_409_and_changes_nothing(db, client, oak):
    request = add_request(db, oak)
    seen = client.get(f"{REQUESTS}/{request.id}").json()["updated_at"]
    first = client.patch(f"{REQUESTS}/{request.id}", json={"updated_at": seen, "status": "done"})
    assert first.status_code == 200
    assert first.json()["updated_at"] != seen

    stale = client.patch(
        f"{REQUESTS}/{request.id}", json={"updated_at": seen, "status": "scheduled"}
    )

    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "conflict"
    assert client.get(f"{REQUESTS}/{request.id}").json()["status"] == "done"


def test_stale_patch_is_409_even_if_the_rules_would_refuse_it(db, client, oak):
    request = add_request(db, oak)
    seen = client.get(f"{REQUESTS}/{request.id}").json()["updated_at"]
    client.patch(f"{REQUESTS}/{request.id}", json={"updated_at": seen, "status": "done"})

    # Unassigned, so this alone would be a 422.
    stale = client.patch(
        f"{REQUESTS}/{request.id}", json={"updated_at": seen, "status": "waiting_on_vendor"}
    )

    assert stale.status_code == 409


def test_update_statement_refuses_a_change_that_lands_after_the_read(db, oak):
    request = add_request(db, oak)
    seen = db.get(MaintenanceRequest, request.id).updated_at
    patch = RequestPatch(updated_at=seen, status=RequestStatus.done)
    # Both passed the read before either wrote, which only the update's own check can catch.
    db.execute(
        update(MaintenanceRequest)
        .where(MaintenanceRequest.id == request.id)
        .values(status=RequestStatus.scheduled)
        .execution_options(synchronize_session=False)
    )

    with pytest.raises(HTTPException) as caught:
        update_request(db, request.id, patch)

    assert caught.value.status_code == 409


def test_timestamp_in_another_offset_still_matches(db, client, oak):
    request = add_request(db, oak)
    seen = datetime.fromisoformat(client.get(f"{REQUESTS}/{request.id}").json()["updated_at"])
    same_moment = seen.astimezone(timezone(timedelta(hours=-5))).isoformat()

    response = client.patch(
        f"{REQUESTS}/{request.id}", json={"updated_at": same_moment, "status": "done"}
    )

    assert response.status_code == 200


def test_patch_that_changes_nothing_keeps_updated_at(db, client, oak):
    request = add_request(db, oak)
    before = client.get(f"{REQUESTS}/{request.id}").json()["updated_at"]

    assert patch_request(client, request).json()["updated_at"] == before
    assert patch_request(client, request, status="new").json()["updated_at"] == before


def test_reassigning_to_in_house_moves_status_to_scheduled(db, client, oak):
    vendor = add_assignee(db)
    in_house = add_assignee(db, "In-house maintenance", AssigneeKind.in_house)
    request = add_request(
        db, oak, status=RequestStatus.waiting_on_vendor, assignee_id=vendor.id
    )

    body = patch_request(client, request, assignee_id=in_house.id).json()

    assert (body["assignee_name"], body["status"]) == ("In-house maintenance", "scheduled")


def test_unassigning_moves_status_to_scheduled(db, client, oak):
    vendor = add_assignee(db)
    request = add_request(
        db, oak, status=RequestStatus.waiting_on_vendor, assignee_id=vendor.id
    )

    assert patch_request(client, request, assignee_id=None).json()["status"] == "scheduled"


def test_rule_goes_by_kind_not_name(db, client, oak):
    misleading = add_assignee(db, "Outside vendor crew", AssigneeKind.in_house)
    request = add_request(db, oak)

    response = patch_request(
        client, request, assignee_id=misleading.id, status="waiting_on_vendor"
    )

    assert response.status_code == 422


def test_one_patch_setting_vendor_and_waiting_is_judged_on_the_final_state(db, client, oak):
    vendor = add_assignee(db)
    in_house = add_assignee(db, "In-house maintenance", AssigneeKind.in_house)
    request = add_request(db, oak, assignee_id=in_house.id)

    response = patch_request(client, request, assignee_id=vendor.id, status="waiting_on_vendor")

    assert response.status_code == 200
    assert response.json()["status"] == "waiting_on_vendor"


def test_invalid_status_is_422_and_changes_nothing(db, client, oak):
    request = add_request(db, oak)
    before = client.get(f"{REQUESTS}/{request.id}").json()["updated_at"]

    response = patch_request(client, request, status="waiting_on_vendor")

    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "body.status"
    after = client.get(f"{REQUESTS}/{request.id}").json()
    assert (after["status"], after["updated_at"]) == ("new", before)


@pytest.mark.parametrize("known", [True, False], ids=["inactive", "unknown"])
def test_cannot_assign_an_inactive_or_unknown_assignee(db, client, oak, known):
    assignee_id = add_assignee(db, active=False).id if known else 999999
    request = add_request(db, oak)

    response = patch_request(client, request, assignee_id=assignee_id)

    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "body.assignee_id"


def test_request_can_stay_on_a_vendor_deactivated_after_assignment(db, client, oak):
    vendor = add_assignee(db, active=False)
    request = add_request(
        db, oak, status=RequestStatus.waiting_on_vendor, assignee_id=vendor.id
    )

    # A dashboard may send the whole form back, including the unchanged assignee.
    response = patch_request(client, request, assignee_id=vendor.id, scheduled_at=NOW.isoformat())

    assert response.status_code == 200
    assert response.json()["status"] == "waiting_on_vendor"
    assert response.json()["assignee_id"] == vendor.id


@pytest.mark.parametrize(
    "fields",
    [
        {"status": "cancelled"},
        {"status": None},
        {"needs_review": True},
        {"needs_review": None},
        {"assignee_id": MAX_ID + 1},
        {"assignee_id": 0},
        {"scheduled_at": "2026-11-05T09:00:00"},
        {"scheduled_at": "9999-12-31T23:59:59-14:00"},
        {"scheduled_at": "0001-01-01T00:00:00+14:00"},
    ],
    ids=[
        "status",
        "null-status",
        "set-review",
        "null-review",
        "huge-assignee",
        "zero-assignee",
        "naive-time",
        "far-future",
        "far-past",
    ],
)
def test_bad_patch_is_422(db, client, oak, fields):
    assert patch_request(client, add_request(db, oak), **fields).status_code == 422


@pytest.mark.parametrize(
    "seen", [None, "yesterday", "2026-11-05T09:00:00"], ids=["missing", "garbage", "naive"]
)
def test_patch_requires_a_real_last_seen_time(db, client, oak, seen):
    request = add_request(db, oak)
    body = {"status": "done"} | ({"updated_at": seen} if seen else {})
    assert client.patch(f"{REQUESTS}/{request.id}", json=body).status_code == 422


@pytest.mark.parametrize("id_", [999999, MAX_ID + 1])
def test_patch_of_unknown_id_is_404(client, id_):
    response = client.patch(f"{REQUESTS}/{id_}", json={"updated_at": NOW.isoformat()})
    assert response.status_code == 404


# T62


def test_assignees_lists_active_entries_with_their_kind(db, client):
    add_assignee(db, "In-house maintenance", AssigneeKind.in_house)
    plumber = add_assignee(db, "Plumber")
    add_assignee(db, "Old vendor", active=False)

    response = client.get(ASSIGNEES)

    assert response.status_code == 200
    assert [(a["name"], a["kind"]) for a in response.json()] == [
        ("In-house maintenance", "in_house"),
        ("Plumber", "outside_vendor"),
    ]
    assert response.json()[1]["id"] == plumber.id


# T63


def test_add_vendor_is_always_an_outside_vendor(client):
    response = client.post(ASSIGNEES, json={"name": "  Roofer  ", "kind": "in_house"})

    assert response.status_code == 201
    body = response.json()
    assert (body["name"], body["kind"], body["active"]) == ("Roofer", "outside_vendor", True)
    assert body["id"] in [a["id"] for a in client.get(ASSIGNEES).json()]


def test_duplicate_vendor_name_is_409(db, client):
    add_assignee(db, "Plumber")
    other = add_assignee(db, "Electrician")
    db.commit()  # the route's rollback would otherwise undo these rows too

    assert client.post(ASSIGNEES, json={"name": "Plumber"}).status_code == 409
    renamed = client.patch(f"{ASSIGNEES}/{other.id}", json={"name": "Plumber"})
    assert renamed.status_code == 409
    assert {a["name"] for a in client.get(ASSIGNEES).json()} == {"Plumber", "Electrician"}


def test_rename_vendor(db, client):
    vendor = add_assignee(db)

    response = client.patch(f"{ASSIGNEES}/{vendor.id}", json={"name": "Pipes Inc"})

    assert response.status_code == 200
    assert (response.json()["name"], response.json()["active"]) == ("Pipes Inc", True)


def test_in_house_cannot_be_deactivated_or_change_kind_but_can_be_renamed(db, client):
    in_house = add_assignee(db, "In-house maintenance", AssigneeKind.in_house)
    url = f"{ASSIGNEES}/{in_house.id}"

    assert client.patch(url, json={"active": False}).status_code == 422
    assert client.patch(url, json={"name": "Skip", "active": False}).status_code == 422
    assert client.get(ASSIGNEES).json()[0]["name"] == "In-house maintenance"

    response = client.patch(url, json={"name": "Our team", "kind": "outside_vendor"})
    assert response.status_code == 200
    assert (response.json()["name"], response.json()["kind"]) == ("Our team", "in_house")


def test_deactivating_a_used_vendor_leaves_requests_intact(db, client, oak):
    vendor = add_assignee(db)
    request = add_request(
        db, oak, status=RequestStatus.waiting_on_vendor, assignee_id=vendor.id
    )

    response = client.patch(f"{ASSIGNEES}/{vendor.id}", json={"active": False})

    assert response.status_code == 200
    assert client.get(ASSIGNEES).json() == []
    detail = client.get(f"{REQUESTS}/{request.id}").json()
    assert detail["assignee_name"] == "Plumber"
    assert detail["status"] == "waiting_on_vendor"


@pytest.mark.parametrize(
    "name", ["", "   ", "x" * 201, "a\x00b", None], ids=["empty", "blank", "long", "nul", "null"]
)
def test_bad_vendor_name_is_422(db, client, name):
    vendor = add_assignee(db)
    assert client.post(ASSIGNEES, json={"name": name}).status_code == 422
    assert client.patch(f"{ASSIGNEES}/{vendor.id}", json={"name": name}).status_code == 422


@pytest.mark.parametrize("id_", [999999, MAX_ID + 1])
def test_patch_of_unknown_assignee_is_404(client, id_):
    assert client.patch(f"{ASSIGNEES}/{id_}", json={"active": False}).status_code == 404


# T64


@pytest.fixture
def staff(db, client) -> StaffUser:
    user = StaffUser(name="Sam Lee", email="sam@example.com", auth_id=uuid4())
    db.add(user)
    db.flush()
    client.app.dependency_overrides[require_staff] = lambda: user
    return user


def test_note_saves_with_its_author_and_shows_in_detail(db, client, oak, staff):
    request = add_request(db, oak)

    # An author in the body is ignored: it only comes from the token.
    response = client.post(
        f"{REQUESTS}/{request.id}/notes", json={"body": "  Called the tenant  ", "author_id": 999}
    )
    second = client.post(f"{REQUESTS}/{request.id}/notes", json={"body": "Booked for Tuesday"})

    assert response.status_code == second.status_code == 201
    assert (response.json()["body"], response.json()["author_name"]) == (
        "Called the tenant",
        "Sam Lee",
    )
    stored = db.scalar(select(Note).where(Note.id == response.json()["id"]))
    assert stored.author_id == staff.id
    notes = client.get(f"{REQUESTS}/{request.id}").json()["notes"]
    assert notes[0] == response.json()
    assert [note["body"] for note in notes] == ["Called the tenant", "Booked for Tuesday"]


def test_note_does_not_make_an_open_edit_stale(db, client, oak, staff):
    request = add_request(db, oak)
    seen = client.get(f"{REQUESTS}/{request.id}").json()["updated_at"]

    client.post(f"{REQUESTS}/{request.id}/notes", json={"body": "Called the tenant"})

    response = client.patch(f"{REQUESTS}/{request.id}", json={"updated_at": seen, "status": "done"})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "body", ["", "   ", "x" * 5001, "a\x00b", None], ids=["empty", "blank", "long", "nul", "null"]
)
def test_bad_note_is_422_without_echoing_it(db, client, oak, staff, body):
    request = add_request(db, oak)
    response = client.post(f"{REQUESTS}/{request.id}/notes", json={"body": body})
    assert response.status_code == 422
    assert "a\x00b" not in response.text


@pytest.mark.parametrize("id_", [999999, MAX_ID + 1])
def test_note_on_unknown_request_is_404(client, staff, id_):
    assert client.post(f"{REQUESTS}/{id_}/notes", json={"body": "Hello"}).status_code == 404


def test_note_body_stays_out_of_the_logs(db, client, oak, staff, caplog):
    request = add_request(db, oak)
    with caplog.at_level("DEBUG"):
        client.post(f"{REQUESTS}/{request.id}/notes", json={"body": "Gate code 4412"})
    server_lines = [r.getMessage() for r in caplog.records if r.name != "httpx2"]
    assert server_lines
    assert not any("4412" in line for line in server_lines)


# T65


def staff_request(unit: Unit, **fields) -> dict:
    return {
        "unit_id": unit.id,
        "tenant_name": "Pat Lee",
        "phone": "(555) 123-4567",
        "category": "plumbing",
        "description": "The sink is clogged",
        "entry_permission": "notify_first",
        "followup_answers": {"problem": "clogged_drain", "location": "kitchen"},
        "source": "phone",
        **fields,
    }


@pytest.mark.parametrize("source", ["phone", "text", "in_person"])
def test_staff_logged_request_saves_the_source(client, oak, source):
    response = client.post(REQUESTS, json=staff_request(oak, source=source))

    assert response.status_code == 201
    body = response.json()
    assert body["source"] == source
    assert body["status"] == "new"
    assert body["reference_number"].startswith("MR-")


def test_staff_logged_request_is_never_flagged_for_review(client, oak):
    body = client.post(REQUESTS, json=staff_request(oak)).json()

    assert body["contact_matched"] is False  # no one on the roster
    assert body["needs_review"] is False


@pytest.mark.parametrize(
    "source", ["tenant_form", "email", None], ids=["tenant", "unknown", "null"]
)
def test_staff_logged_request_needs_a_staff_source(client, oak, source):
    assert client.post(REQUESTS, json=staff_request(oak, source=source)).status_code == 422


def test_staff_logged_request_skips_tenant_only_checks(client, oak, monkeypatch):
    client.app.state.form_config.require_emergency_ack = True
    monkeypatch.setattr(settings, "public_form_enabled", False)
    monkeypatch.setattr(settings, "rate_limit_unit_per_hour", 0)

    response = client.post(REQUESTS, json=staff_request(oak, website="filled"))

    assert response.status_code == 201
    assert response.json()["emergency_ack_at"] is None


def test_staff_logged_request_records_no_tenant_acknowledgement(client, oak):
    body = client.post(REQUESTS, json=staff_request(oak, not_an_emergency=True)).json()
    assert body["emergency_ack_at"] is None


def test_two_staff_logged_requests_do_not_collide(client, oak):
    first = client.post(REQUESTS, json=staff_request(oak)).json()
    second = client.post(REQUESTS, json=staff_request(oak)).json()
    assert first["id"] != second["id"]


def test_staff_logged_request_still_detects_urgent_and_validates_answers(client, oak):
    config = client.app.state.form_config
    plumbing = next(c for c in config.categories if c.id == "plumbing")
    urgent = next(
        (question, option)
        for question in plumbing.questions
        for option in question.options
        if option.urgent
    )
    answers = {q.id: q.options[0].value for q in plumbing.questions if q.required}
    answers[urgent[0].id] = urgent[1].value

    logged = client.post(REQUESTS, json=staff_request(oak, followup_answers=answers))
    assert logged.json()["urgent"] is True

    for bad in ({"followup_answers": {}}, {"category": "nope"}):
        assert client.post(REQUESTS, json=staff_request(oak, **bad)).status_code == 422


def test_staff_logged_request_for_unknown_unit_is_422(client, oak):
    payload = staff_request(oak, unit_id=999999)
    assert client.post(REQUESTS, json=payload).status_code == 422


def test_whole_life_of_a_request(db, client, oak, staff):
    vendor = client.post(ASSIGNEES, json={"name": "Drain Co"}).json()
    in_house = add_assignee(db, "In-house maintenance", AssigneeKind.in_house)

    logged = client.post(REQUESTS, json=staff_request(oak)).json()
    request = db.get(MaintenanceRequest, logged["id"])
    assert patch_request(client, request, status="waiting_on_vendor").status_code == 422

    assert (
        patch_request(
            client, request, assignee_id=vendor["id"], status="waiting_on_vendor"
        ).json()["status"]
        == "waiting_on_vendor"
    )
    client.post(f"{REQUESTS}/{logged['id']}/notes", json={"body": "Vendor booked"})
    assert patch_request(client, request, assignee_id=in_house.id).json()["status"] == "scheduled"
    assert patch_request(client, request, status="done").json()["status"] == "done"
    assert patch_request(client, request, status="new").json()["status"] == "new"  # reopened
    assert len(client.get(f"{REQUESTS}/{logged['id']}").json()["notes"]) == 1
