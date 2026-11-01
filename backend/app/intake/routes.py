from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import MAX_ID, get_db
from app.errors import FormClosed
from app.intake.form_config import FormConfig
from app.intake.models import Property, Unit
from app.requests.schemas import RequestCreate, RequestCreated
from app.requests.service import create_request, next_reference
from app.settings import settings

router = APIRouter(prefix="/api/public")

Db = Annotated[Session, Depends(get_db)]


def _client_ip(request: Request) -> str:
    # Only trustworthy while the container can be reached solely through the Cloudflare tunnel.
    return request.headers.get("cf-connecting-ip") or get_remote_address(request)


# shortcut: in-memory counters reset on restart and are per process, run one worker or move to
# a shared store if the backend ever scales out.
limiter = Limiter(key_func=_client_ip)


def _require_form_open() -> None:
    if not settings.public_form_enabled:
        raise FormClosed()


class PropertyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class UnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str


@router.get("/config", response_model=FormConfig)
def get_config(request: Request):
    return request.app.state.form_config


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(db: Db):
    return db.scalars(select(Property).where(Property.active).order_by(Property.name)).all()


@router.get("/properties/{property_id}/units", response_model=list[UnitOut])
def list_units(property_id: int, db: Db):
    property_ = db.get(Property, property_id) if abs(property_id) <= MAX_ID else None
    # An inactive property is hidden from the dropdown, so its units stay hidden too.
    if property_ is None or not property_.active:
        raise HTTPException(404, "Property not found")
    query = select(Unit).where(Unit.property_id == property_id, Unit.active).order_by(Unit.label)
    return db.scalars(query).all()


@router.post(
    "/requests",
    response_model=RequestCreated,
    status_code=201,
    dependencies=[Depends(_require_form_open)],
)
@limiter.limit(
    lambda: settings.rate_limit_ip, error_message="Too many requests, please call the office"
)
def submit_request(
    request: Request,
    data: RequestCreate,
    # Required, so a retry can never create a second request. Long enough to rule out two
    # tenants' browsers generating the same key, which would silently drop one request.
    idempotency_key: Annotated[str, Header(min_length=16, max_length=255)],
    db: Db,
):
    # Looks like a normal success, with nothing saved, so a bot learns nothing.
    if data.website:
        return RequestCreated(reference_number=next_reference(db))

    categories = {category.id for category in request.app.state.form_config.categories}
    if data.category not in categories:
        raise RequestValidationError([{"loc": ("body", "category"), "msg": "Unknown category"}])

    created = create_request(db, data, idempotency_key)
    return RequestCreated(reference_number=created.reference_number)
