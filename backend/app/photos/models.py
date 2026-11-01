from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.requests.models import MaintenanceRequest


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The cascade removes rows, not files. V1 has no delete endpoint, and the orphan report
    # (app.photos.report) lists any files left behind.
    request_id: Mapped[int] = mapped_column(
        ForeignKey(MaintenanceRequest.id, ondelete="CASCADE"), index=True
    )
    storage_path: Mapped[str] = mapped_column(unique=True)
    content_type: Mapped[str]
    size_bytes: Mapped[int]
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
