from datetime import UTC, datetime, timedelta
from itertools import count as counter
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.assignees.models import Assignee, AssigneeKind
from app.db import MAX_ID, get_db
from app.intake.models import Property, Unit
from app.main import create_app
from app.photos.models import Photo
from app.requests.models import EntryPermission, MaintenanceRequest, RequestSource, RequestStatus
from app.requests.queries import PAGE_SIZE
from app.settings import settings
from app.staff.auth import require_staff

REQUESTS = "/api/staff/requests"
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
    for path in (REQUESTS, f"{REQUESTS}/summary", f"{REQUESTS}/1", f"{REQUESTS}/1/photos/1"):
        assert client.get(path).status_code == 401


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
