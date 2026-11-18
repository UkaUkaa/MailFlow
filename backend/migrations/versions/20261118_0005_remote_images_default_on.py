"""remote images shown by default: flip the load_remote_images default to true

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('user_settings', 'load_remote_images', server_default=sa.text('true'))
    op.execute("UPDATE user_settings SET load_remote_images = true")


def downgrade() -> None:
    op.alter_column('user_settings', 'load_remote_images', server_default=None)
