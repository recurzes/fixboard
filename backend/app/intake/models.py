from sqlalchemy import ForeignKey, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    address: Mapped[str]
    active: Mapped[bool] = mapped_column(server_default=true())


class Unit(Base):
    __tablename__ = "units"
    __table_args__ = (UniqueConstraint("property_id", "label"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey(Property.id))
    label: Mapped[str]
    active: Mapped[bool] = mapped_column(server_default=true())
