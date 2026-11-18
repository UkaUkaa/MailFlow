"""user identities: link MailFlow users to external sign-in accounts (Sign in with Google)

Revision ID: 0004
Revises: 0003
"""
import os

from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None

APP_ROLE = os.environ.get("DB_APP_ROLE", "mailflow_app")


def upgrade() -> None:
    op.create_table('user_identities',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_identities_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_identities')),
    sa.UniqueConstraint('provider', 'subject', name=op.f('uq_user_identities_providersubject')),
    )
    op.create_index(op.f('ix_user_identities_user_id'), 'user_identities', ['user_id'], unique=False)
    # Read before authentication (like user_sessions), so it is not under tenant RLS.
    op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON user_identities TO "{APP_ROLE}"')


def downgrade() -> None:
    op.drop_index(op.f('ix_user_identities_user_id'), table_name='user_identities')
    op.drop_table('user_identities')
