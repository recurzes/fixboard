from uuid import UUID

from sqlalchemy import true
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class StaffUser(Base):
    __tablename__ = "staff_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    email: Mapped[str]
    auth_id: Mapped[UUID] = mapped_column(unique=True)
    active: Mapped[bool] = mapped_column(server_default=true())
