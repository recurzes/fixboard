import os

import pytest

# app.settings reads this on import. The engine is lazy, so only the `db` fixture connects.
# Without it set, the `db` tests need the compose database: docker compose up -d db
# 127.0.0.1, because compose binds only that, and on Windows trying localhost's ::1 first stalls
# each new connection for about two minutes.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://fixboard:fixboard@127.0.0.1:5432/fixboard")
os.environ.setdefault("APP_ORIGIN", "https://app.test.invalid")
os.environ.setdefault("NEON_AUTH_URL", "https://test.neon.invalid/neondb/auth")
os.environ.setdefault("STORAGE_ENDPOINT_URL", "https://storage.test.invalid")
os.environ.setdefault("STORAGE_BUCKET", "photos")
os.environ.setdefault("STORAGE_ACCESS_KEY_ID", "test")
os.environ.setdefault("STORAGE_SECRET_ACCESS_KEY", "test")


@pytest.fixture(scope="session")
def migrated():
    from alembic.config import Config

    from alembic import command

    command.upgrade(Config("alembic.ini"), "head")


@pytest.fixture
def db(migrated):
    """A session on an emptied database, where everything is rolled back after the test."""
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from app.audit import models  # noqa: F401
    from app.db import Base, engine

    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            # The trigger refuses DELETE on history. TRUNCATE is rolled back like the rest.
            if table.name == "history":
                connection.execute(text("TRUNCATE history"))
            else:
                connection.execute(table.delete())
        with Session(connection, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()
