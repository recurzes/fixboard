from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.intake.form_config import FormConfig
from app.intake.models import Property, Unit

router = APIRouter(prefix="/api/public")

Db = Annotated[Session, Depends(get_db)]

MAX_ID = 2**31 - 1


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
    # Postgres raises on an id outside its integer range, which would turn a 404 into a 500.
    property_ = db.get(Property, property_id) if abs(property_id) <= MAX_ID else None
    # An inactive property is hidden from the dropdown, so its units stay hidden too.
    if property_ is None or not property_.active:
        raise HTTPException(404, "Property not found")
    query = select(Unit).where(Unit.property_id == property_id, Unit.active).order_by(Unit.label)
    return db.scalars(query).all()
