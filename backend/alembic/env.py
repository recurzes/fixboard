import app.assignees.models  # noqa: F401
import app.audit.models  # noqa: F401
import app.intake.models  # noqa: F401
import app.photos.models  # noqa: F401
import app.requests.models  # noqa: F401
import app.residents.models  # noqa: F401
import app.staff.models  # noqa: F401
from alembic import context
from app.db import Base, engine
from app.log import configure_logging

configure_logging()

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
