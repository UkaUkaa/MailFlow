"""interface preferences: message list layout, row tint, accent colour, reader text size

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

COLUMNS = (
    ('list_density', sa.String(length=16), 'comfortable'),
    ('list_preview_lines', sa.SmallInteger(), sa.text('1')),
    ('show_avatars', sa.Boolean(), sa.true()),
    ('account_tint', sa.String(length=16), 'subtle'),
    ('accent_color', sa.String(length=16), 'blue'),
    ('reader_text_size', sa.String(length=16), 'default'),
)


def upgrade() -> None:
    for name, type_, default in COLUMNS:
        op.add_column(
            'user_settings',
            sa.Column(name, type_, nullable=False, server_default=default),
        )


def downgrade() -> None:
    for name, _type, _default in reversed(COLUMNS):
        op.drop_column('user_settings', name)
