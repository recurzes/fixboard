"""Loads properties and units from a CSV: python -m app.intake.seed properties.csv

Columns, one row per unit, all required: property_name, property_address, unit_label

Safe to re-run. A property is identified by its name, and a changed address is updated.
Properties and units missing from the file are left as they are.
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.intake.models import Property, Unit
from app.seed_csv import read_csv

COLUMNS = ("property_name", "property_address", "unit_label")


def load_properties(session: Session, path: str | Path) -> dict[str, int]:
    properties = {p.name: p for p in session.scalars(select(Property))}
    units = {tuple(row) for row in session.execute(select(Unit.property_id, Unit.label))}
    counts = {"properties created": 0, "units created": 0}

    for line, row in read_csv(path, COLUMNS):
        if not all(row.values()):
            sys.exit(f"Line {line}: every column is required")

        property_ = properties.get(row["property_name"])
        if property_ is None:
            property_ = Property(name=row["property_name"], address=row["property_address"])
            session.add(property_)
            session.flush()
            properties[property_.name] = property_
            counts["properties created"] += 1
        property_.address = row["property_address"]

        if (property_.id, row["unit_label"]) not in units:
            session.add(Unit(property_id=property_.id, label=row["unit_label"]))
            units.add((property_.id, row["unit_label"]))
            counts["units created"] += 1

    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load properties and units from a CSV")
    parser.add_argument("path")
    args = parser.parse_args()
    with SessionLocal.begin() as session:
        print(load_properties(session, args.path))
