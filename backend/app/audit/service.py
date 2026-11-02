from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.audit.models import HistoryEntity, HistoryEvent, HistoryEventType
from app.staff.models import StaffUser


def _as_text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def record_event(
    db: Session,
    entity_type: HistoryEntity,
    entity_id: int,
    actor: StaffUser | None,
    event: HistoryEventType,
    field: str | None = None,
    old=None,
    new=None,
) -> None:
    """Adds to the caller's transaction and never commits, so the change and its event share a fate.

    Never pass tenant details or note text: this table cannot be edited later.
    """
    db.add(
        HistoryEvent(
            entity_type=entity_type,
            entity_id=entity_id,
            actor_id=actor.id if actor else None,
            event=event,
            field=field,
            old_value=_as_text(old),
            new_value=_as_text(new),
        )
    )
