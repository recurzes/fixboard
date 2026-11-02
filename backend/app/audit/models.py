from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.staff.models import StaffUser


class HistoryEntity(StrEnum):
    request = "request"
    assignee = "assignee"


class HistoryEventType(StrEnum):
    created = "created"
    changed = "changed"
    note_added = "note_added"


class HistoryEvent(Base):
    """Append-only: a database trigger refuses UPDATE and DELETE."""

    __tablename__ = "history"
    __table_args__ = (Index("ix_history_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[HistoryEntity] = mapped_column(Enum(HistoryEntity, name="history_entity"))
    # No foreign key, because it points at different tables and must outlive what it describes.
    entity_id: Mapped[int]
    # Null means the tenant, who has no account.
    actor_id: Mapped[int | None] = mapped_column(ForeignKey(StaffUser.id))
    event: Mapped[HistoryEventType] = mapped_column(Enum(HistoryEventType, name="history_event"))
    field: Mapped[str | None]
    old_value: Mapped[str | None]
    new_value: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
