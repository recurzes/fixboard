"""Loads the resident roster from a CSV: python -m app.residents.seed roster.csv

Columns: property_name, unit_label, name, email, phone. Email and phone may be blank.

The file is the whole roster, so each re-run refreshes it:
- A resident is identified by unit plus name, ignoring case. Existing rows are updated.
- A resident missing from the file becomes inactive, so former tenants stop matching.
- A resident who reappears in a later file becomes active again.

The roster is personal data: keep the file out of git, and never print its rows here.
Any bad row stops the script with its line number, and nothing is saved.
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.intake.models import Property, Unit
from app.phone import normalize_phone
from app.residents.models import Resident
from app.seed_csv import read_csv

COLUMNS = ("property_name", "unit_label", "name", "email", "phone")


def load_residents(session: Session, path: str | Path) -> dict[str, int]:
    rows = read_csv(path, COLUMNS)
    unit_ids = {
        (property_name, label): unit_id
        for property_name, label, unit_id in session.execute(
            select(Property.name, Unit.label, Unit.id).join(Unit, Unit.property_id == Property.id)
        )
    }
    residents = {(r.unit_id, r.name.casefold()): r for r in session.scalars(select(Resident))}
    seen = set()
    counts = {"created": 0, "updated": 0, "deactivated": 0}

    for line, row in rows:
        unit_id = unit_ids.get((row["property_name"], row["unit_label"]))
        if unit_id is None:
            sys.exit(f"Line {line}: unknown property or unit")
        if not row["name"]:
            sys.exit(f"Line {line}: name is required")

        key = (unit_id, row["name"].casefold())
        if key in seen:
            sys.exit(f"Line {line}: the same name appears twice in this unit")
        seen.add(key)

        try:
            phone = normalize_phone(row["phone"]) if row["phone"] else None
        except ValueError:
            sys.exit(f"Line {line}: invalid phone")
        email = row["email"].lower() or None

        resident = residents.get(key)
        if resident is None:
            session.add(Resident(unit_id=unit_id, name=row["name"], email=email, phone=phone))
            counts["created"] += 1
        else:
            resident.name, resident.email, resident.phone = row["name"], email, phone
            resident.active = True
            counts["updated"] += 1

    for key, resident in residents.items():
        if key not in seen and resident.active:
            resident.active = False
            counts["deactivated"] += 1

    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load the resident roster from a CSV")
    parser.add_argument("path")
    args = parser.parse_args()
    with SessionLocal.begin() as session:
        print(load_residents(session, args.path))
