import logging
from collections.abc import Iterable
from datetime import timedelta

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.intake.form_config import Category
from app.intake.models import Property, Unit
from app.requests.models import (
    REFERENCE_SEQUENCE,
    MaintenanceRequest,
    RequestSource,
)
from app.requests.schemas import RequestCreate
from app.residents.models import Resident
from app.settings import settings

logger = logging.getLogger(__name__)


def next_reference(db: Session) -> str:
    return f"MR-{db.scalar(REFERENCE_SEQUENCE.next_value())}"


def contact_matches(email: str | None, phone: str | None, residents: Iterable[Resident]) -> bool:
    """Expects the stored forms: lowercase email and E.164 phone."""
    return any(
        resident.active
        and ((email and resident.email == email) or (phone and resident.phone == phone))
        for resident in residents
    )


def _find_by_key(db: Session, idempotency_key: str) -> MaintenanceRequest | None:
    query = select(MaintenanceRequest).where(MaintenanceRequest.idempotency_key == idempotency_key)
    return db.scalar(query)


def create_request(
    db: Session, data: RequestCreate, idempotency_key: str, category: Category
) -> MaintenanceRequest:
    # First, so a retry returns its original even once the unit is at its limit.
    original = _find_by_key(db, idempotency_key)
    if original is not None:
        return original

    unit = db.scalar(
        select(Unit)
        .join(Property, Unit.property_id == Property.id)
        .where(Unit.id == data.unit_id, Unit.active, Property.active)
    )
    if unit is None:
        raise RequestValidationError([{"loc": ("body", "unit_id"), "msg": "Unknown unit"}])

    # Only the tenant form counts, so staff logging requests cannot lock a tenant out.
    recent = db.scalar(
        select(func.count())
        .select_from(MaintenanceRequest)
        .where(
            MaintenanceRequest.unit_id == unit.id,
            MaintenanceRequest.source == RequestSource.tenant_form,
            MaintenanceRequest.created_at > func.now() - timedelta(hours=1),
        )
    )
    if recent >= settings.rate_limit_unit_per_hour:
        logger.warning("rate limit exceeded for unit %s", unit.id)
        raise HTTPException(429, "Too many requests for this unit, please call the office")

    residents = db.scalars(select(Resident).where(Resident.unit_id == unit.id))
    matched = contact_matches(data.email, data.phone, residents)
    # Both come from the answers and the config, so the client cannot set or clear them.
    chosen = category.chosen_options(data.followup_answers)
    # shortcut: keeps the first if answers to two questions both have one, which no category does
    # yet. Add a list column if one ever does.
    self_check = next((option.self_check for option in chosen if option.self_check), None)
    request = MaintenanceRequest(
        reference_number=next_reference(db),
        unit_id=unit.id,
        property_id=unit.property_id,
        tenant_name=data.tenant_name,
        phone=data.phone,
        email=data.email,
        category=data.category,
        description=data.description,
        followup_answers=data.followup_answers,
        entry_permission=data.entry_permission,
        entry_notes=data.entry_notes,
        source=RequestSource.tenant_form,
        contact_matched=matched,
        needs_review=not matched,
        urgent=any(option.urgent for option in chosen),
        self_check_shown=self_check.id if self_check else None,
        self_check_tried=self_check is not None and data.self_check_tried,
        emergency_ack_at=func.now() if data.not_an_emergency else None,
        idempotency_key=idempotency_key,
    )
    db.add(request)
    try:
        db.commit()
    except IntegrityError:
        # A simultaneous submit with this key won the race, so its request is the original.
        db.rollback()
        winner = _find_by_key(db, idempotency_key)
        if winner is None:
            raise
        return winner
    return request
