"""account appearance: any colour and an optional picture

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

# Named colours stored before 0002, with the hex value the frontend already showed for them.
NAMED_TO_HEX = {
    'blue': '#3355e0',
    'teal': '#0e8f8f',
    'green': '#1f8a4c',
    'amber': '#a86a00',
    'red': '#c2513a',
    'pink': '#b8388a',
    'violet': '#7a4fd6',
    'slate': '#5d6577',
}


def upgrade() -> None:
    op.add_column('email_accounts', sa.Column('avatar_image', sa.LargeBinary(), nullable=True))
    op.add_column('email_accounts', sa.Column('avatar_media_type', sa.String(length=32), nullable=True))
    op.add_column(
        'email_accounts', sa.Column('avatar_updated_at', sa.DateTime(timezone=True), nullable=True)
    )
    for name, value in NAMED_TO_HEX.items():
        op.execute(
            sa.text("UPDATE email_accounts SET color = :value WHERE color = :name").bindparams(
                value=value, name=name
            )
        )
    # Anything else that is not a hex colour falls back to the first default hue.
    op.execute("UPDATE email_accounts SET color = '#3355e0' WHERE color !~ '^#[0-9a-f]{6}$'")
    op.create_check_constraint(
        op.f('ck_email_accounts_color_hex'), 'email_accounts', "color ~ '^#[0-9a-f]{6}$'"
    )
    op.create_check_constraint(
        op.f('ck_email_accounts_avatar_complete'),
        'email_accounts',
        '(avatar_image IS NULL) = (avatar_media_type IS NULL)',
    )


def downgrade() -> None:
    op.drop_constraint(op.f('ck_email_accounts_avatar_complete'), 'email_accounts', type_='check')
    op.drop_constraint(op.f('ck_email_accounts_color_hex'), 'email_accounts', type_='check')
    for name, value in NAMED_TO_HEX.items():
        op.execute(
            sa.text("UPDATE email_accounts SET color = :name WHERE color = :value").bindparams(
                value=value, name=name
            )
        )
    op.execute("UPDATE email_accounts SET color = 'blue' WHERE color LIKE '#%'")
    op.drop_column('email_accounts', 'avatar_updated_at')
    op.drop_column('email_accounts', 'avatar_media_type')
    op.drop_column('email_accounts', 'avatar_image')
