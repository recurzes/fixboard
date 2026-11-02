"""Loads made-up data for the client demo: python -m app.demo_seed

Everyone here is invented, and nothing reads or changes the real roster. The properties are named
"Demo - ..." so they are easy to find, and RUNBOOK.md shows how to remove them before real tenants
arrive, because tenants would see them in the form's dropdown.

Stops if the demo data is already loaded, because a second run would double the requests.
"""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.assignees.models import Assignee
from app.assignees.seed import seed_assignees
from app.db import SessionLocal
from app.intake.form_config import FORM_CONFIG_PATH, FormConfig, load_form_config
from app.intake.models import Property, Unit
from app.phone import normalize_phone
from app.requests.models import RequestSource, RequestStatus
from app.requests.schemas import RequestCreate
from app.requests.service import create_request
from app.residents.models import Resident

PALM = "Demo - Palm Court"
HARBOR = "Demo - Harbor View"

PROPERTIES = {
    PALM: ("100 Example Ave, Springfield", ["101", "102", "103", "104"]),
    HARBOR: ("200 Sample St, Springfield", ["A", "B", "C"]),
}

# 555-01xx numbers are reserved for fiction, and example.com never delivers.
RESIDENTS = [
    (PALM, "101", "Avery Stone", "avery.stone@example.com", "(212) 555-0101"),
    (PALM, "102", "Blake Rivera", "blake.rivera@example.com", "(212) 555-0102"),
    (PALM, "103", "Casey Nguyen", None, "(212) 555-0103"),
    (PALM, "104", "Drew Patel", "drew.patel@example.com", None),
    (HARBOR, "A", "Emery Walsh", "emery.walsh@example.com", "(212) 555-0104"),
    (HARBOR, "B", "Finley Brooks", "finley.brooks@example.com", "(212) 555-0105"),
    (HARBOR, "C", "Harper Quinn", None, "(212) 555-0106"),
]

REQUESTS = [
    {  # urgent, and the one to open first in a demo
        "unit": (PALM, "101"),
        "tenant_name": "Avery Stone",
        "phone": "(212) 555-0101",
        "category": "plumbing",
        "description": "Water is coming through the ceiling above the kitchen sink.",
        "followup_answers": {"problem": "active_flooding", "location": "kitchen"},
        "entry_permission": "anytime",
    },
    {  # contact mismatch: the name is on the roster, but this email and phone are not
        "unit": (PALM, "102"),
        "tenant_name": "Blake Rivera",
        "email": "blake.new.address@example.com",
        "phone": "(212) 555-0199",
        "category": "door_lock",
        "description": "The front door will not lock unless I lift the handle.",
        "followup_answers": {"problem": "will_not_lock", "door": "front"},
        "entry_permission": "notify_first",
    },
    {  # shows a self-check the tenant already tried
        "unit": (HARBOR, "A"),
        "tenant_name": "Emery Walsh",
        "email": "emery.walsh@example.com",
        "category": "plumbing",
        "description": "The bathroom sink drains very slowly.",
        "followup_answers": {"problem": "clogged_drain", "location": "bathroom"},
        "entry_permission": "only_when_home",
        "entry_notes": "Home after 5pm on weekdays.",
        "self_check_tried": True,
        "days_ago": 1,
    },
    {
        "unit": (PALM, "103"),
        "tenant_name": "Casey Nguyen",
        "phone": "(212) 555-0103",
        "category": "pest",
        "description": "Ants along the kitchen window.",
        "followup_answers": {"pest_type": "ants", "frequency": "daily"},
        "entry_permission": "notify_first",
        "status": RequestStatus.scheduled,
        "assignee": "Pest control",
        "scheduled_in_days": 2,
        "days_ago": 3,
    },
    {
        "unit": (HARBOR, "B"),
        "tenant_name": "Finley Brooks",
        "email": "finley.brooks@example.com",
        "category": "ac_heating",
        "description": "The AC runs but only blows warm air.",
        "followup_answers": {
            "symptom": "warm_air",
            "filter_changed": "under_3_months",
            "above_90": "no",
            "gas_smell": "no",
        },
        "entry_permission": "anytime",
        "status": RequestStatus.waiting_on_vendor,
        "assignee": "AC contractor",
        "days_ago": 4,
    },
    {  # logged by staff from a phone call
        "unit": (HARBOR, "C"),
        "tenant_name": "Harper Quinn",
        "phone": "(212) 555-0106",
        "category": "appliance",
        "description": "The dishwasher stops halfway through a cycle.",
        "followup_answers": {"appliance": "dishwasher", "working": "partly", "gas_smell": "no"},
        "entry_permission": "notify_first",
        "source": RequestSource.phone,
        "status": RequestStatus.scheduled,
        "assignee": "In-house maintenance",
        "scheduled_in_days": 1,
        "days_ago": 5,
    },
    {
        "unit": (PALM, "104"),
        "tenant_name": "Drew Patel",
        "email": "drew.patel@example.com",
        "category": "electrical",
        "description": "The bedroom light flickers when the fan is on.",
        "followup_answers": {"problem": "flickering", "extent": "one_room"},
        "entry_permission": "anytime",
        "status": RequestStatus.done,
        "assignee": "Electrician",
        "days_ago": 9,
    },
]


def seed_demo(session: Session, config: FormConfig) -> int:
    if session.scalar(select(Property.id).where(Property.name.in_(PROPERTIES))):
        raise SystemExit("The demo data is already loaded")

    seed_assignees(session)
    assignees = dict(session.execute(select(Assignee.name, Assignee.id)).all())
    categories = {category.id: category for category in config.categories}

    unit_ids = {}
    for name, (address, labels) in PROPERTIES.items():
        property_ = Property(name=name, address=address)
        session.add(property_)
        session.flush()
        for label in labels:
            unit = Unit(property_id=property_.id, label=label)
            session.add(unit)
            session.flush()
            unit_ids[name, label] = unit.id

    for property_name, label, name, email, phone in RESIDENTS:
        session.add(
            Resident(
                unit_id=unit_ids[property_name, label],
                name=name,
                email=email,
                phone=normalize_phone(phone) if phone else None,
            )
        )

    for row in REQUESTS:
        row = dict(row)
        unit_id = unit_ids[row.pop("unit")]
        status = row.pop("status", None)
        assignee = row.pop("assignee", None)
        scheduled_in_days = row.pop("scheduled_in_days", None)
        days_ago = row.pop("days_ago", None)
        source = row.pop("source", RequestSource.tenant_form)
        data = RequestCreate(unit_id=unit_id, not_an_emergency=True, **row)
        request = create_request(session, data, None, categories[data.category], source=source)

        # Set directly, so these later stages have no history events, like other seeded data.
        if status:
            request.status = status
        if assignee:
            request.assignee_id = assignees[assignee]
        if scheduled_in_days:
            request.scheduled_at = func.now() + timedelta(days=scheduled_in_days)
        if days_ago:
            request.created_at = func.now() - timedelta(days=days_ago)
    session.commit()
    return len(REQUESTS)


if __name__ == "__main__":
    with SessionLocal() as session:
        count = seed_demo(session, load_form_config(FORM_CONFIG_PATH))
    print(f"Demo data loaded: {count} requests")
