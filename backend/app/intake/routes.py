from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, ValidationError
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


class PublicConfig(FormConfig):
    # Not in form_config.json, because the kill switch is an environment setting.
    form_enabled: bool


@router.get("/config", response_model=PublicConfig)
def get_config(request: Request):
    config = request.app.state.form_config
    return PublicConfig(**config.model_dump(), form_enabled=settings.public_form_enabled)


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
    # A JSON part, because the follow-up answers do not fit flat form fields.
    body: Annotated[str, Form(alias="data")],
    # Required, so a retry can never create a second request. Long enough to rule out two
    # tenants' browsers generating the same key, which would silently drop one request.
    idempotency_key: Annotated[str, Header(min_length=16, max_length=255)],
    db: Db,
    photos: Annotated[list[UploadFile], File()] = [],
):
    try:
        data = RequestCreate.model_validate_json(body)
    except ValidationError as error:
        raise RequestValidationError(
            [{"loc": ("body", *e["loc"]), "msg": e["msg"]} for e in error.errors()]
        ) from None

    # Looks like a normal success, with nothing saved, so a bot learns nothing.
    if data.website:
        return RequestCreated(reference_number=next_reference(db))

    config = request.app.state.form_config
    errors = []
    # Checked here, not in the service, because staff-logged requests skip it (T65).
    if config.require_emergency_ack and not data.not_an_emergency:
        errors.append({"loc": ("body", "not_an_emergency"), "msg": "Please confirm this box"})
    category = next((c for c in config.categories if c.id == data.category), None)
    if category is None:
        errors.append({"loc": ("body", "category"), "msg": "Unknown category"})
    else:
        errors += category.answer_errors(data.followup_answers)
    if errors:
        raise RequestValidationError(errors)

    created = create_request(db, data, idempotency_key, category, photos)
    return RequestCreated(reference_number=created.reference_number)
