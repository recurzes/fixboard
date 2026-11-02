"""append-only history table

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "entity_type", sa.Enum("request", "assignee", name="history_entity"), nullable=False
        ),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column(
            "event",
            sa.Enum("created", "changed", "note_added", name="history_event"),
            nullable=False,
        ),
        sa.Column("field", sa.String(), nullable=True),
        sa.Column("old_value", sa.String(), nullable=True),
        sa.Column("new_value", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"], ["staff_users.id"], name=op.f("fk_history_actor_id_staff_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_history")),
    )
    op.create_index("ix_history_entity", "history", ["entity_type", "entity_id"])
    op.execute(
        """
        CREATE FUNCTION history_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'history is append-only';
        END
        $$
        """
    )
    # Per statement, so it refuses even a statement that matches no rows.
    op.execute(
        """
        CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON history
        FOR EACH STATEMENT EXECUTE FUNCTION history_is_append_only()
        """
    )


def downgrade() -> None:
    op.drop_table("history")
    op.execute("DROP FUNCTION history_is_append_only")
    op.execute("DROP TYPE history_event")
    op.execute("DROP TYPE history_entity")
