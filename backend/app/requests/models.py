from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Sequence, false, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.assignees.models import Assignee
from app.db import Base
from app.intake.models import Property, Unit
from app.staff.models import StaffUser

# A sequence never hands a number out twice, even after a rollback. Gaps are harmless.
REFERENCE_SEQUENCE = Sequence("request_reference_seq", start=1001, metadata=Base.metadata)


class RequestStatus(StrEnum):
    new = "new"
    scheduled = "scheduled"
    waiting_on_vendor = "waiting_on_vendor"
    done = "done"


class EntryPermission(StrEnum):
    anytime = "anytime"
    notify_first = "notify_first"
    only_when_home = "only_when_home"


class RequestSource(StrEnum):
    tenant_form = "tenant_form"
    phone = "phone"
    text = "text"
    in_person = "in_person"


class MaintenanceRequest(Base):
    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference_number: Mapped[str] = mapped_column(unique=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey(Unit.id), index=True)
    # Stored as well as the unit, because the staff property filter needs an index. Units never
    # move between properties, so the two cannot drift apart.
    property_id: Mapped[int] = mapped_column(ForeignKey(Property.id), index=True)
    tenant_name: Mapped[str]
    phone: Mapped[str | None]
    email: Mapped[str | None]
    category: Mapped[str] = mapped_column(index=True)
    description: Mapped[str]
    followup_answers: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'"))
    entry_permission: Mapped[EntryPermission] = mapped_column(
        Enum(EntryPermission, name="entry_permission")
    )
    entry_notes: Mapped[str | None]
    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, name="request_status"), server_default=RequestStatus.new, index=True
    )
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey(Assignee.id))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[RequestSource] = mapped_column(Enum(RequestSource, name="request_source"))
    contact_matched: Mapped[bool]
    needs_review: Mapped[bool] = mapped_column(server_default=false())
    urgent: Mapped[bool] = mapped_column(server_default=false())
    self_check_shown: Mapped[str | None]
    self_check_tried: Mapped[bool] = mapped_column(server_default=false())
    emergency_ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Null for staff-logged requests (T65), which do not send one. Nulls do not collide.
    idempotency_key: Mapped[str | None] = mapped_column(unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # The stale-edit check compares this, so it must move on every update. now() is the time the
    # transaction started, which can repeat.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.clock_timestamp()
    )


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey(MaintenanceRequest.id, ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey(StaffUser.id))
    body: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
