"""row-level security on every table, deny by default

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

TABLES = (
    "alembic_version",
    "properties",
    "units",
    "staff_users",
    "assignees",
    "residents",
    "requests",
    "photos",
    "notes",
    "history",
)


def upgrade() -> None:
    # No policies, so every role sees nothing except the table owner, which is the backend's role.
    # Naming no roles also keeps this working on both Neon and the plain Postgres in compose.
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
