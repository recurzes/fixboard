import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db import MAX_ID
from app.phone import normalize_phone
from app.requests.models import EntryPermission

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
    not_an_emergency: bool = False  # enforced and stored by T42
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

    @model_validator(mode="after")
    def phone_or_email_is_present(self):
        if not self.phone and not self.email:
            raise ValueError("Provide a phone number or an email address")
        return self


class RequestCreated(BaseModel):
    reference_number: str
