import os

import pytest

# app.settings reads this on import. The engine is lazy, so only the `db` fixture connects.
# Without it set, the `db` tests need the compose database: docker compose up -d db
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://fixboard:fixboard@localhost:5432/fixboard")
os.environ.setdefault("NEON_AUTH_URL", "https://test.neon.invalid/neondb/auth")


@pytest.fixture(scope="session")
def migrated():
    from alembic.config import Config

    from alembic import command

    command.upgrade(Config("alembic.ini"), "head")


@pytest.fixture
def db(migrated):
    """A session on an emptied database, where everything is rolled back after the test."""
    from sqlalchemy.orm import Session

    from app.db import Base, engine

    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        with Session(connection, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()
