import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.assignees.models import Assignee, AssigneeKind
from app.assignees.seed import seed_assignees
from app.db import get_db
from app.intake.models import Property, Unit
from app.intake.seed import load_properties
from app.main import create_app
from app.phone import normalize_phone
from app.residents.models import Resident
from app.residents.seed import load_residents
from app.staff.models import StaffUser

PROPERTIES_HEADER = "property_name,property_address,unit_label\n"
ROSTER_HEADER = "property_name,unit_label,name,email,phone\n"


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def write_csv(tmp_path, content: str, encoding: str = "utf-8"):
    path = tmp_path / "file.csv"
    path.write_text(content, encoding=encoding)
    return path


def add_property(db, name: str = "Oak", active: bool = True) -> Property:
    property_ = Property(name=name, address="1 Main St", active=active)
    db.add(property_)
    db.flush()
    return property_


def add_unit(db, property_: Property, label: str = "1A", active: bool = True) -> Unit:
    unit = Unit(property_id=property_.id, label=label, active=active)
    db.add(unit)
    db.flush()
    return unit


def residents_by_name(db) -> dict[str, Resident]:
    db.expire_all()
    return {r.name: r for r in db.scalars(select(Resident))}


@pytest.mark.parametrize("raw", ["(555) 123-4567", "555-123-4567", "+15551234567", "15551234567"])
def test_phone_formats_normalize_to_e164(raw):
    assert normalize_phone(raw) == "+15551234567"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "abc",
        "not a phone",
        "123-4567",  # seven digits count as "possible" to phonenumbers, but have no area code
        "555-123-45678",
        "(000) 000-0000",
        "+442079460958",
    ],
)
def test_phone_junk_is_rejected(raw):
    with pytest.raises(ValueError) as error:
        normalize_phone(raw)
    assert not raw or raw not in str(error.value)


def test_unit_label_is_unique_per_property_only(db):
    oak, elm = add_property(db, "Oak"), add_property(db, "Elm")
    add_unit(db, oak)
    add_unit(db, elm)

    with pytest.raises(IntegrityError), db.begin_nested():
        add_unit(db, oak)


def test_staff_user_inserts_and_auth_id_is_unique(db):
    auth_id = uuid4()
    db.add(StaffUser(name="Sam", email="sam@example.com", auth_id=auth_id))
    db.flush()

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(StaffUser(name="Other", email="other@example.com", auth_id=auth_id))


def test_duplicate_assignee_name_is_rejected(db):
    db.add(Assignee(name="Roofer", kind=AssigneeKind.outside_vendor))
    db.flush()

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(Assignee(name="Roofer", kind=AssigneeKind.outside_vendor))


def test_seed_assignees_twice_leaves_five_with_one_in_house(db):
    seed_assignees(db)
    seed_assignees(db)

    assignees = db.scalars(select(Assignee)).all()
    assert len(assignees) == 5
    assert [a.name for a in assignees if a.kind == AssigneeKind.in_house] == [
        "In-house maintenance"
    ]


def test_resident_links_to_unit_with_optional_contact(db):
    unit = add_unit(db, add_property(db))
    db.add(Resident(unit_id=unit.id, name="Pat"))
    db.flush()

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(Resident(unit_id=unit.id + 1, name="Nobody"))


def test_load_properties_twice_creates_no_duplicates_and_updates_address(db, tmp_path):
    rows = "Oak,1 Main St,1A\nOak,1 Main St,1B\nElm,2 Elm St,1A\n"
    first = write_csv(tmp_path, PROPERTIES_HEADER + rows)
    assert load_properties(db, first) == {"properties created": 2, "units created": 3}

    second = write_csv(tmp_path, PROPERTIES_HEADER + rows.replace("1 Main St", "9 New St"))
    assert load_properties(db, second) == {"properties created": 0, "units created": 0}
    db.flush()

    assert len(db.scalars(select(Property)).all()) == 2
    assert len(db.scalars(select(Unit)).all()) == 3
    assert db.scalar(select(Property.address).where(Property.name == "Oak")) == "9 New St"


def test_load_properties_reads_excel_bom(db, tmp_path):
    path = write_csv(tmp_path, PROPERTIES_HEADER + "Oak,1 Main St,1A\n", encoding="utf-8-sig")
    assert load_properties(db, path)["units created"] == 1


@pytest.mark.parametrize(
    "content, message",
    [
        ("name,address\nOak,1 Main St\n", "Missing columns"),
        (PROPERTIES_HEADER, "no rows"),
        (PROPERTIES_HEADER + "Oak,,1A\n", "Line 2"),
    ],
)
def test_load_properties_rejects_bad_files(db, tmp_path, content, message):
    with pytest.raises(SystemExit, match=message):
        load_properties(db, write_csv(tmp_path, content))


def test_load_residents_normalizes_and_rerun_updates(db, tmp_path):
    add_unit(db, add_property(db))
    first = write_csv(
        tmp_path,
        ROSTER_HEADER
        + "Oak,1A,Pat Lee,PAT@Example.COM,(555) 123-4567\n"
        + "Oak,1A,Mo Ray,,\n",
    )
    assert load_residents(db, first) == {"created": 2, "updated": 0, "deactivated": 0}
    db.flush()

    residents = residents_by_name(db)
    assert residents["Pat Lee"].email == "pat@example.com"
    assert residents["Pat Lee"].phone == "+15551234567"
    assert residents["Mo Ray"].email is None
    assert residents["Mo Ray"].phone is None

    second = write_csv(
        tmp_path,
        ROSTER_HEADER
        + "Oak,1A,pat lee,new@example.com,555-123-4567\n"
        + "Oak,1A,Mo Ray,,\n",
    )
    assert load_residents(db, second) == {"created": 0, "updated": 2, "deactivated": 0}
    db.flush()

    residents = residents_by_name(db)
    assert len(residents) == 2
    assert residents["pat lee"].email == "new@example.com"


def test_load_residents_deactivates_missing_and_reactivates_returning(db, tmp_path):
    add_unit(db, add_property(db))
    both = write_csv(tmp_path, ROSTER_HEADER + "Oak,1A,Pat,,\nOak,1A,Mo,,\n")
    load_residents(db, both)
    db.flush()

    only_mo = write_csv(tmp_path, ROSTER_HEADER + "Oak,1A,Mo,,\n")
    assert load_residents(db, only_mo)["deactivated"] == 1
    db.flush()
    assert residents_by_name(db)["Pat"].active is False

    both = write_csv(tmp_path, ROSTER_HEADER + "Oak,1A,Pat,,\nOak,1A,Mo,,\n")
    load_residents(db, both)
    db.flush()
    assert residents_by_name(db)["Pat"].active is True


@pytest.mark.parametrize(
    "row, message",
    [
        ("Oak,9Z,Pat Secret,,", "Line 2: unknown"),
        ("Oak,1A,,secret@example.com,", "Line 2: name"),
        ("Oak,1A,Pat Secret,,not-a-phone-secret", "Line 2: invalid phone"),
    ],
)
def test_load_residents_rejects_bad_rows_without_printing_them(db, tmp_path, row, message):
    add_unit(db, add_property(db))
    with pytest.raises(SystemExit, match=message) as error:
        load_residents(db, write_csv(tmp_path, ROSTER_HEADER + row + "\n"))
    assert "ecret" not in str(error.value)


def test_load_residents_rejects_duplicate_name_in_unit(db, tmp_path):
    add_unit(db, add_property(db))
    path = write_csv(tmp_path, ROSTER_HEADER + "Oak,1A,Pat,,\nOak,1A,PAT,,\n")
    with pytest.raises(SystemExit, match="Line 3"):
        load_residents(db, path)


def test_properties_returns_active_only(db, client):
    oak = add_property(db, "Oak")
    add_property(db, "Closed", active=False)

    response = client.get("/api/public/properties")
    assert response.status_code == 200
    assert response.json() == [{"id": oak.id, "name": "Oak"}]


def test_units_returns_only_that_propertys_active_units(db, client):
    oak, elm = add_property(db, "Oak"), add_property(db, "Elm")
    unit = add_unit(db, oak, "1A")
    add_unit(db, oak, "1B", active=False)
    add_unit(db, elm, "2A")

    response = client.get(f"/api/public/properties/{oak.id}/units")
    assert response.status_code == 200
    assert response.json() == [{"id": unit.id, "label": "1A"}]


def test_units_404s_for_unknown_and_inactive_property(db, client):
    closed = add_property(db, "Closed", active=False)
    add_unit(db, closed)

    for property_id in (closed.id + 1, closed.id, 2**31, -(2**31) - 1, 10**23):
        response = client.get(f"/api/public/properties/{property_id}/units")
        assert response.status_code == 404
        assert response.json() == {"error": {"code": "not_found", "message": "Property not found"}}


def test_config_returns_the_seven_categories():
    response = TestClient(create_app()).get("/api/public/config")
    assert response.status_code == 200
    assert [category["id"] for category in response.json()["categories"]] == [
        "ac_heating",
        "plumbing",
        "electrical",
        "pest",
        "appliance",
        "door_lock",
        "other",
    ]


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        "{}",
        json.dumps({"categories": []}),
        json.dumps({"categories": [{"id": "pest"}]}),
        json.dumps({"categories": [{"id": "", "label": "Pest"}]}),
        json.dumps({"categories": [{"id": "pest", "label": "A"}, {"id": "pest", "label": "B"}]}),
        json.dumps({"categories": [{"id": "pest", "label": "Pest", "typo": 1}]}),
    ],
)
def test_bad_config_stops_the_app_from_booting(tmp_path, content):
    path = tmp_path / "form_config.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(ValidationError):
        create_app(form_config_path=path)
