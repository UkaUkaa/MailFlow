"""remote images shown by default: flip the load_remote_images default to true

Only the column default changes. Existing rows keep their value: a stored false may be a
deliberate opt-out, which the migration cannot tell apart from the old default.

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


def downgrade() -> None:
    op.alter_column('user_settings', 'load_remote_images', server_default=None)
