"""Enhanced tables for routing rules and analytics.

Revision ID: 0002
Revises: 0001
Create Date: 2025-01-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("rule_type", sa.String(64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    with op.batch_alter_table("request_logs") as batch_op:
        batch_op.add_column(
            sa.Column("provider", sa.String(length=64), nullable=False, server_default="unknown")
        )
        batch_op.add_column(
            sa.Column("saved_usd", sa.Float(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("baseline_cost_usd", sa.Float(), nullable=False, server_default="0")
        )
        batch_op.create_index("ix_request_logs_provider", ["provider"])
        batch_op.create_index("ix_request_logs_cache_hit", ["cache_hit"])


def downgrade() -> None:
    with op.batch_alter_table("request_logs") as batch_op:
        batch_op.drop_index("ix_request_logs_cache_hit")
        batch_op.drop_index("ix_request_logs_provider")
        batch_op.drop_column("baseline_cost_usd")
        batch_op.drop_column("cache_hit")
        batch_op.drop_column("saved_usd")
        batch_op.drop_column("provider")
    op.drop_table("user_rules")
