"""message templates and per-user AI keys

Adds ``message_templates``, ``user_secrets`` (Token Vault ciphertext of user-level secrets
such as the user's own AI API key) and ``assistant_configs`` (which AI provider and model the
user connected; D43). All three are under tenant RLS like every user-owned table.

Revision ID: 0007
Revises: 0006
"""
import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

APP_ROLE = os.environ.get("DB_APP_ROLE", "mailflow_app")
TABLES = ("message_templates", "user_secrets", "assistant_configs")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        'message_templates',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('subject', sa.Text(), nullable=False),
        sa.Column('body_html', sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'],
                                name=op.f('fk_message_templates_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_message_templates')),
    )
    op.create_index('ix_message_templates_user_id_name', 'message_templates', ['user_id', 'name'])

    op.create_table(
        'user_secrets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('key_id', sa.String(length=64), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'],
                                name=op.f('fk_user_secrets_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_user_secrets')),
        sa.UniqueConstraint('user_id', 'kind', name=op.f('uq_user_secrets_user_id_kind')),
    )

    op.create_table(
        'assistant_configs',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('provider', sa.String(length=16), nullable=False),
        sa.Column('model', sa.String(length=128), nullable=False),
        sa.Column('key_hint', sa.String(length=8), nullable=False),
        sa.Column('models', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'],
                                name=op.f('fk_assistant_configs_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', name=op.f('pk_assistant_configs')),
        sa.CheckConstraint("provider IN ('openai', 'anthropic', 'gemini')",
                           name=op.f('ck_assistant_configs_provider')),
    )

    for table in TABLES:
        op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO "{APP_ROLE}"')
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
            WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
            """
        )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
