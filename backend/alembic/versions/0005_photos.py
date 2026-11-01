"""photos table

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["requests.id"],
            name=op.f("fk_photos_request_id_requests"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_photos")),
        sa.UniqueConstraint("storage_path", name=op.f("uq_photos_storage_path")),
    )
    op.create_index(op.f("ix_photos_request_id"), "photos", ["request_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_photos_request_id"), table_name="photos")
    op.drop_table("photos")
