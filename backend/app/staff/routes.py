from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.assignees.models import Assignee, AssigneeKind
from app.audit.models import HistoryEntity, HistoryEventType
from app.audit.service import record_event
from app.db import MAX_ID, get_db
from app.photos import storage
from app.requests.models import RequestStatus
from app.requests.queries import get_photo, get_request_detail, list_requests, request_counts
from app.requests.schemas import (
    NoteCreate,
    NoteOut,
    PhotoUrl,
    RequestDetail,
    RequestPage,
    RequestPatch,
    RequestSummary,
    StaffRequestCreate,
)
from app.requests.service import add_note, create_request, update_request
from app.staff.auth import CurrentStaff, require_staff
from app.staff.models import StaffUser

# On the router, so a staff endpoint added later cannot forget the guard.
router = APIRouter(prefix="/api/staff", dependencies=[Depends(require_staff)])

Db = Annotated[Session, Depends(get_db)]

PropertyId = Annotated[int, Field(gt=0, le=MAX_ID)]
# Postgres text cannot hold NUL, so it would otherwise be a 500.
SearchText = Annotated[str, Field(max_length=200, pattern=r"^[^\x00]*$")]
AssigneeName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\x00]*$"),
]


class StaffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    email: str


class AssigneeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: AssigneeKind
    active: bool


class AssigneeCreate(BaseModel):
    name: AssigneeName


class AssigneePatch(BaseModel):
    # Pydantic does not validate defaults, so None means "not sent" and an explicit null is a 422.
    name: AssigneeName = None
    active: bool = None


@router.get("/me", response_model=StaffOut)
def get_me(staff: CurrentStaff):
    return staff


@router.get("/requests", response_model=RequestPage)
def get_requests(
    db: Db,
    property_: Annotated[list[PropertyId], Query(alias="property")] = [],
    status: Annotated[list[RequestStatus], Query()] = [],
    category: Annotated[list[SearchText], Query()] = [],
    needs_review: bool | None = None,
    urgent: bool | None = None,
    q: SearchText | None = None,
    include_done: bool = False,
    cursor: str | None = None,
):
    items, next_cursor = list_requests(
        db, property_, status, category, needs_review, urgent, q, include_done, cursor
    )
    return {"items": items, "next_cursor": next_cursor}


# Before /requests/{request_id}, so "summary" is not read as an id.
@router.get("/requests/summary", response_model=RequestSummary)
def get_summary(db: Db):
    return request_counts(db)


@router.post("/requests", response_model=RequestDetail, status_code=201)
def log_request(request: Request, data: StaffRequestCreate, staff: CurrentStaff, db: Db):
    config = request.app.state.form_config
    category = next((c for c in config.categories if c.id == data.category), None)
    if category is None:
        raise RequestValidationError([{"loc": ("body", "category"), "msg": "Unknown category"}])
    errors = category.answer_errors(data.followup_answers)
    if errors:
        raise RequestValidationError(errors)
    created = create_request(db, data, None, category, source=data.source, actor=staff)
    return get_request_detail(db, created.id)


@router.get("/requests/{request_id}", response_model=RequestDetail)
def get_request(request_id: int, db: Db):
    detail = get_request_detail(db, request_id)
    if detail is None:
        raise HTTPException(404, "Request not found")
    return detail


@router.patch("/requests/{request_id}", response_model=RequestDetail)
def patch_request(request_id: int, patch: RequestPatch, staff: CurrentStaff, db: Db):
    update_request(db, request_id, patch, staff)
    return get_request_detail(db, request_id)


@router.post("/requests/{request_id}/notes", response_model=NoteOut, status_code=201)
def post_note(request_id: int, data: NoteCreate, staff: CurrentStaff, db: Db):
    return add_note(db, request_id, staff, data.body)


@router.get("/requests/{request_id}/photos/{photo_id}", response_model=PhotoUrl)
def get_photo_url(request_id: int, photo_id: int, db: Db):
    photo = get_photo(db, request_id, photo_id)
    if photo is None:
        raise HTTPException(404, "Photo not found")
    return PhotoUrl(url=storage.signed_url(photo.storage_path))


@router.get("/assignees", response_model=list[AssigneeOut])
def list_assignees(db: Db):
    return db.scalars(select(Assignee).where(Assignee.active).order_by(Assignee.name)).all()


def _save_assignee(
    db: Session,
    assignee: Assignee,
    actor: StaffUser | None,
    event: HistoryEventType,
    changes: dict[str, tuple],
) -> None:
    try:
        # Raises on a duplicate name, and gives a new entry the id its event needs.
        db.flush()
        for field, (old, new) in changes.items():
            record_event(db, HistoryEntity.assignee, assignee.id, actor, event, field, old, new)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That name is already on the vendor list") from None


@router.post("/assignees", response_model=AssigneeOut, status_code=201)
def add_assignee(data: AssigneeCreate, staff: CurrentStaff, db: Db):
    # Always an outside vendor: the kind is not an input, so nothing can become in-house.
    assignee = Assignee(name=data.name, kind=AssigneeKind.outside_vendor)
    db.add(assignee)
    _save_assignee(db, assignee, staff, HistoryEventType.created, {"name": (None, data.name)})
    return assignee


@router.patch("/assignees/{assignee_id}", response_model=AssigneeOut)
def patch_assignee(assignee_id: int, patch: AssigneePatch, staff: CurrentStaff, db: Db):
    assignee = db.get(Assignee, assignee_id) if abs(assignee_id) <= MAX_ID else None
    if assignee is None:
        raise HTTPException(404, "Assignee not found")
    if assignee.kind == AssigneeKind.in_house and patch.active is False:
        error = {"loc": ("body", "active"), "msg": "In-house maintenance cannot be deactivated"}
        raise RequestValidationError([error])
    changes = {
        field: (getattr(assignee, field), value)
        for field, value in (("name", patch.name), ("active", patch.active))
        if value is not None and getattr(assignee, field) != value
    }
    for field, (_, value) in changes.items():
        setattr(assignee, field, value)
    _save_assignee(db, assignee, staff, HistoryEventType.changed, changes)
    return assignee
