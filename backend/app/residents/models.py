from sqlalchemy import ForeignKey, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.intake.models import Unit


class Resident(Base):
    __tablename__ = "residents"

    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey(Unit.id), index=True)
    name: Mapped[str]
    # Matching works on either one, so a roster row may lack the other.
    email: Mapped[str | None]
    phone: Mapped[str | None]
    active: Mapped[bool] = mapped_column(server_default=true())
