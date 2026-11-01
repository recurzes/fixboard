from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db import MAX_ID, get_db
from app.photos import storage
from app.requests.models import RequestStatus
from app.requests.queries import get_photo, get_request_detail, list_requests, request_counts
from app.requests.schemas import PhotoUrl, RequestDetail, RequestPage, RequestSummary
from app.staff.auth import CurrentStaff, require_staff

# On the router, so a staff endpoint added later cannot forget the guard.
router = APIRouter(prefix="/api/staff", dependencies=[Depends(require_staff)])

Db = Annotated[Session, Depends(get_db)]

PropertyId = Annotated[int, Field(gt=0, le=MAX_ID)]
# Postgres text cannot hold NUL, so it would otherwise be a 500.
SearchText = Annotated[str, Field(max_length=200, pattern=r"^[^\x00]*$")]


class StaffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    email: str


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


@router.get("/requests/{request_id}", response_model=RequestDetail)
def get_request(request_id: int, db: Db):
    detail = get_request_detail(db, request_id)
    if detail is None:
        raise HTTPException(404, "Request not found")
    return detail


@router.get("/requests/{request_id}/photos/{photo_id}", response_model=PhotoUrl)
def get_photo_url(request_id: int, photo_id: int, db: Db):
    photo = get_photo(db, request_id, photo_id)
    if photo is None:
        raise HTTPException(404, "Photo not found")
    return PhotoUrl(url=storage.signed_url(photo.storage_path))
