"""properties, units, staff users, assignees, residents

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "properties",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("address", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_properties")),
    )
    op.create_table(
        "units",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.ForeignKeyConstraint(
            ["property_id"], ["properties.id"], name=op.f("fk_units_property_id_properties")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_units")),
        sa.UniqueConstraint("property_id", "label", name=op.f("uq_units_property_id")),
    )
    op.create_table(
        "staff_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("auth_id", sa.Uuid(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff_users")),
        sa.UniqueConstraint("auth_id", name=op.f("uq_staff_users_auth_id")),
    )
    op.create_table(
        "assignees",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "kind", sa.Enum("in_house", "outside_vendor", name="assignee_kind"), nullable=False
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assignees")),
        sa.UniqueConstraint("name", name=op.f("uq_assignees_name")),
    )
    op.create_table(
        "residents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], name=op.f("fk_residents_unit_id_units")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_residents")),
    )
    op.create_index(op.f("ix_residents_unit_id"), "residents", ["unit_id"])


def downgrade() -> None:
    op.drop_table("residents")
    op.drop_table("assignees")
    op.execute("DROP TYPE assignee_kind")
    op.drop_table("staff_users")
    op.drop_table("units")
    op.drop_table("properties")
