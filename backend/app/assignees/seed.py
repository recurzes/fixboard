"""Seeds the starting vendor list: python -m app.assignees.seed"""

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.assignees.models import Assignee, AssigneeKind
from app.db import SessionLocal

STARTING_ASSIGNEES = [
    ("In-house maintenance", AssigneeKind.in_house),
    ("Pest control", AssigneeKind.outside_vendor),
    ("AC contractor", AssigneeKind.outside_vendor),
    ("Plumber", AssigneeKind.outside_vendor),
    ("Electrician", AssigneeKind.outside_vendor),
]


def seed_assignees(session: Session) -> None:
    # shortcut: keys on name, so a re-run after staff rename an entry recreates the old name.
    # This is a setup-time script, run it only before staff start editing the list.
    rows = [{"name": name, "kind": kind} for name, kind in STARTING_ASSIGNEES]
    session.execute(insert(Assignee).values(rows).on_conflict_do_nothing(index_elements=["name"]))


if __name__ == "__main__":
    with SessionLocal.begin() as session:
        seed_assignees(session)
    print("Vendor list seeded")
