from alembic import context
from app.db import Base, engine
from app.log import configure_logging

configure_logging()

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
