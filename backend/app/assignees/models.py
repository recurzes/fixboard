from enum import StrEnum

from sqlalchemy import Enum, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AssigneeKind(StrEnum):
    in_house = "in_house"
    outside_vendor = "outside_vendor"


class Assignee(Base):
    __tablename__ = "assignees"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    kind: Mapped[AssigneeKind] = mapped_column(Enum(AssigneeKind, name="assignee_kind"))
    active: Mapped[bool] = mapped_column(server_default=true())
