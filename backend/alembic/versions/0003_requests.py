"""requests table and reference number sequence

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE request_reference_seq START WITH 1001")
    op.create_table(
        "requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reference_number", sa.String(), nullable=False),
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=False),
        sa.Column("tenant_name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column(
            "followup_answers",
            postgresql.JSONB(),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column(
            "entry_permission",
            sa.Enum("anytime", "notify_first", "only_when_home", name="entry_permission"),
            nullable=False,
        ),
        sa.Column("entry_notes", sa.String(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("new", "scheduled", "waiting_on_vendor", "done", name="request_status"),
            server_default="new",
            nullable=False,
        ),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "source",
            sa.Enum("tenant_form", "phone", "text", "in_person", name="request_source"),
            nullable=False,
        ),
        sa.Column("contact_matched", sa.Boolean(), nullable=False),
        sa.Column("needs_review", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("urgent", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["assignees.id"], name=op.f("fk_requests_assignee_id_assignees")
        ),
        sa.ForeignKeyConstraint(
            ["property_id"], ["properties.id"], name=op.f("fk_requests_property_id_properties")
        ),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], name=op.f("fk_requests_unit_id_units")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_requests")),
        sa.UniqueConstraint("idempotency_key", name=op.f("uq_requests_idempotency_key")),
        sa.UniqueConstraint("reference_number", name=op.f("uq_requests_reference_number")),
    )
    op.create_index(op.f("ix_requests_category"), "requests", ["category"])
    op.create_index(op.f("ix_requests_created_at"), "requests", ["created_at"])
    op.create_index(op.f("ix_requests_property_id"), "requests", ["property_id"])
    op.create_index(op.f("ix_requests_status"), "requests", ["status"])
    op.create_index(op.f("ix_requests_unit_id"), "requests", ["unit_id"])


def downgrade() -> None:
    op.drop_table("requests")
    op.execute("DROP TYPE request_source")
    op.execute("DROP TYPE request_status")
    op.execute("DROP TYPE entry_permission")
    op.execute("DROP SEQUENCE request_reference_seq")
