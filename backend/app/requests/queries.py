"""What the staff dashboard reads. Creating a request is in service.py."""

from collections.abc import Collection
from datetime import UTC, datetime

from fastapi.exceptions import RequestValidationError
from sqlalchemy import Row, func, or_, select, tuple_
from sqlalchemy.orm import Session

from app.assignees.models import Assignee
from app.db import MAX_ID
from app.intake.models import Property, Unit
from app.photos.models import Photo
from app.requests.models import MaintenanceRequest, Note, RequestStatus
from app.staff.models import StaffUser

PAGE_SIZE = 25

_CURSOR_TIME = "%Y%m%d%H%M%S%f"  # digits only, so a cursor needs no URL encoding

# An assignee can be deactivated while still on a request, and the vendor list only returns active
# entries, so the name has to come from here.
_WITH_NAMES = (
    select(
        *MaintenanceRequest.__table__.c,
        Unit.label.label("unit_label"),
        Property.name.label("property_name"),
        Assignee.name.label("assignee_name"),
    )
    .select_from(MaintenanceRequest)
    .join(Unit, MaintenanceRequest.unit_id == Unit.id)
    .join(Property, MaintenanceRequest.property_id == Property.id)
    .outerjoin(Assignee, MaintenanceRequest.assignee_id == Assignee.id)
)


def _search(db: Session, q: str):
    # An exact reference wins, because MR-1042 is also part of MR-10420.
    reference = MaintenanceRequest.reference_number
    if db.scalar(select(MaintenanceRequest.id).where(reference == q.upper())):
        return reference == q.upper()
    return or_(
        reference.icontains(q, autoescape=True),
        Unit.label.icontains(q, autoescape=True),
        MaintenanceRequest.tenant_name.icontains(q, autoescape=True),
    )


def _encode_cursor(row: Row) -> str:
    return f"{row.created_at.astimezone(UTC).strftime(_CURSOR_TIME)}_{row.id}"


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        created_at, id_ = cursor.split("_")
        if not 0 < int(id_) <= MAX_ID:
            raise ValueError
        return datetime.strptime(created_at, _CURSOR_TIME).replace(tzinfo=UTC), int(id_)
    except ValueError:
        error = {"loc": ("query", "cursor"), "msg": "Invalid cursor"}
        raise RequestValidationError([error]) from None


def list_requests(
    db: Session,
    properties: Collection[int] = (),
    statuses: Collection[RequestStatus] = (),
    categories: Collection[str] = (),
    needs_review: bool | None = None,
    urgent: bool | None = None,
    q: str | None = None,
    include_done: bool = False,
    cursor: str | None = None,
) -> tuple[list[Row], str | None]:
    """One page, newest first, and the cursor for the next page if there is one."""
    query = _WITH_NAMES
    if properties:
        query = query.where(MaintenanceRequest.property_id.in_(properties))
    # Naming a status is asking for it, so `include_done` only affects the unfiltered list.
    if statuses:
        query = query.where(MaintenanceRequest.status.in_(statuses))
    elif not include_done:
        query = query.where(MaintenanceRequest.status != RequestStatus.done)
    if categories:
        query = query.where(MaintenanceRequest.category.in_(categories))
    if needs_review is not None:
        query = query.where(MaintenanceRequest.needs_review == needs_review)
    if urgent is not None:
        query = query.where(MaintenanceRequest.urgent == urgent)
    if q and q.strip():
        query = query.where(_search(db, q.strip()))
    if cursor:
        position = tuple_(MaintenanceRequest.created_at, MaintenanceRequest.id)
        query = query.where(position < _decode_cursor(cursor))

    # The id keeps the order stable for rows with the same timestamp. One extra row shows whether
    # another page exists.
    query = query.order_by(
        MaintenanceRequest.created_at.desc(), MaintenanceRequest.id.desc()
    ).limit(PAGE_SIZE + 1)
    rows = db.execute(query).all()
    page = rows[:PAGE_SIZE]
    return page, _encode_cursor(page[-1]) if len(rows) > PAGE_SIZE else None


def request_counts(db: Session) -> dict:
    """Counts by status, using the same statuses as the list, so New always matches it."""
    rows = db.execute(
        select(
            MaintenanceRequest.status,
            func.count(),
            func.count().filter(MaintenanceRequest.urgent),
            func.count().filter(MaintenanceRequest.needs_review),
        ).group_by(MaintenanceRequest.status)
    ).all()
    open_rows = [row for row in rows if row[0] != RequestStatus.done]
    return {
        "by_status": {status: 0 for status in RequestStatus} | {row[0]: row[1] for row in rows},
        "open_urgent": sum(row[2] for row in open_rows),
        "open_needs_review": sum(row[3] for row in open_rows),
    }


def get_request_detail(db: Session, request_id: int) -> dict | None:
    if abs(request_id) > MAX_ID:
        return None
    row = db.execute(_WITH_NAMES.where(MaintenanceRequest.id == request_id)).first()
    if row is None:
        return None
    photos = select(Photo.id).where(Photo.request_id == request_id).order_by(Photo.id)
    notes = (
        select(Note.id, Note.body, StaffUser.name.label("author_name"), Note.created_at)
        .join(StaffUser, Note.author_id == StaffUser.id)
        .where(Note.request_id == request_id)
        .order_by(Note.id)
    )
    return {
        **row._mapping,
        "photo_ids": db.scalars(photos).all(),
        "notes": db.execute(notes).all(),
    }


def get_photo(db: Session, request_id: int, photo_id: int) -> Photo | None:
    if abs(request_id) > MAX_ID or abs(photo_id) > MAX_ID:
        return None
    return db.scalar(select(Photo).where(Photo.id == photo_id, Photo.request_id == request_id))
