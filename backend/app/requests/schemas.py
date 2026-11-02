import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.audit.models import HistoryEventType
from app.db import MAX_ID
from app.phone import normalize_phone
from app.requests.models import EntryPermission, RequestSource, RequestStatus

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class RequestCreate(BaseModel):
    # Unknown fields are ignored, so a client-sent `urgent` flag never reaches the service.
    model_config = ConfigDict(str_strip_whitespace=True)

    unit_id: int = Field(gt=0, le=MAX_ID)
    tenant_name: str = Field(min_length=1, max_length=200)
    phone: str | None = None
    email: str | None = Field(default=None, max_length=254)
    category: str = Field(min_length=1)
    description: str = Field(min_length=1, max_length=5000)
    entry_permission: EntryPermission
    entry_notes: str | None = Field(default=None, max_length=1000)
    followup_answers: dict[str, str] = {}  # checked against the category's questions by the route
    self_check_tried: bool = False
    not_an_emergency: bool = False
    website: str | None = None  # the honeypot: hidden in the form, so only bots fill it

    @field_validator("*", mode="before")
    @classmethod
    def no_nul_characters(cls, value):
        # Postgres text cannot hold NUL, so it would otherwise be a 500.
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("Invalid characters")
        return value

    @field_validator("phone")
    @classmethod
    def phone_is_us(cls, value: str | None) -> str | None:
        return normalize_phone(value) if value else None

    @field_validator("email")
    @classmethod
    def email_is_valid(cls, value: str | None) -> str | None:
        if not value:
            return None
        if not _EMAIL.fullmatch(value):
            raise ValueError("Invalid email address")
        return value.lower()

    @field_validator("followup_answers")
    @classmethod
    def blank_answers_are_missing(cls, value: dict[str, str]) -> dict[str, str]:
        return {question: answer for question, answer in value.items() if answer}

    @model_validator(mode="after")
    def phone_or_email_is_present(self):
        if not self.phone and not self.email:
            raise ValueError("Provide a phone number or an email address")
        return self


class StaffRequestCreate(RequestCreate):
    source: Literal[RequestSource.phone, RequestSource.text, RequestSource.in_person]


class RequestCreated(BaseModel):
    reference_number: str


class RequestPatch(BaseModel):
    updated_at: AwareDatetime  # as last seen by the client, so a stale edit can be refused
    # Pydantic does not validate defaults, so None means "not sent" and an explicit null is a 422.
    status: RequestStatus = None
    # Null is meaningful for these two: it unassigns, and clears the time.
    assignee_id: int | None = Field(default=None, gt=0, le=MAX_ID)
    # Bounded because a year near 9999 can pass 9999 in UTC, and that row could never be read back.
    scheduled_at: AwareDatetime | None = Field(
        default=None, ge=datetime(2000, 1, 1, tzinfo=UTC), lt=datetime(2100, 1, 1, tzinfo=UTC)
    )
    needs_review: Literal[False] = None  # staff can clear the flag, only the server sets it


class NoteCreate(BaseModel):
    # NUL because Postgres text cannot hold it, so it would otherwise be a 500.
    body: str = Field(min_length=1, max_length=5000, pattern=r"^[^\x00]*$")

    model_config = ConfigDict(str_strip_whitespace=True)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    body: str
    author_name: str
    created_at: datetime


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event: HistoryEventType
    field: str | None
    old_value: str | None
    new_value: str | None
    actor_name: str | None  # null means the tenant
    created_at: datetime


class RequestRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reference_number: str
    property_id: int
    property_name: str
    unit_id: int
    unit_label: str
    tenant_name: str
    category: str
    status: RequestStatus  # "new" is what the dashboard highlights
    urgent: bool
    needs_review: bool
    assignee_id: int | None
    assignee_name: str | None
    scheduled_at: datetime | None
    created_at: datetime


class RequestPage(BaseModel):
    items: list[RequestRow]
    next_cursor: str | None


class RequestSummary(BaseModel):
    by_status: dict[RequestStatus, int]
    open_urgent: int
    open_needs_review: int


class RequestDetail(RequestRow):
    phone: str | None
    email: str | None
    description: str
    followup_answers: dict[str, str]
    entry_permission: EntryPermission
    entry_notes: str | None
    source: RequestSource
    contact_matched: bool
    self_check_shown: str | None
    self_check_tried: bool
    emergency_ack_at: datetime | None
    updated_at: datetime
    photo_ids: list[int]
    notes: list[NoteOut]
    history: list[HistoryOut]  # newest first


class PhotoUrl(BaseModel):
    url: str
