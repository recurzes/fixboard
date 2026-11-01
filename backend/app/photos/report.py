"""Lists storage files with no database row: python -m app.photos.report

Report only, and it deletes nothing, because a file from a submit still in progress looks the same.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.photos import storage
from app.photos.models import Photo


def find_orphans(session: Session) -> list[str]:
    # Files first, so a submit that commits between the two steps is not reported.
    paths = list(storage.list_paths())
    known = set(session.scalars(select(Photo.storage_path)))
    return [path for path in paths if path not in known]


if __name__ == "__main__":
    with SessionLocal() as session:
        orphans = find_orphans(session)
    for orphan in orphans:
        print(orphan)
    print(f"{len(orphans)} orphan file(s)")
