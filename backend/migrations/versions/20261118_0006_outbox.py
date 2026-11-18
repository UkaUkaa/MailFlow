"""scheduled outbox: send later and undo send

Adds ``outbox_items`` / ``outbox_attachments`` (tenant RLS like every user-owned table), the
``mailflow_claim_due_outbox`` scan used by the beat task, the ``undo_send_seconds`` setting, and
teaches the cleanup function to drop finished outbox rows.

Revision ID: 0006
Revises: 0005
"""
import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

APP_ROLE = os.environ.get("DB_APP_ROLE", "mailflow_app")
TABLES = ("outbox_items", "outbox_attachments")
CLAIM = "mailflow_claim_due_outbox(integer, integer)"

_CLEANUP_BASE = """
          DELETE FROM user_sessions
            WHERE expires_at < now() - interval '7 days'
               OR revoked_at < now() - interval '7 days';
          DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '1 day';
          DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day';
          DELETE FROM oauth_states WHERE expires_at < now() - interval '1 hour';
          DELETE FROM audit_events WHERE created_at < now() - interval '180 days';
"""
_CLEANUP_OUTBOX = """
          DELETE FROM outbox_items
            WHERE status IN ('sent', 'cancelled') AND updated_at < now() - interval '30 days';
"""


def _cleanup(body: str) -> str:
    return f"""
        CREATE OR REPLACE FUNCTION mailflow_cleanup_expired() RETURNS void
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$ {body} $$;
    """


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('undo_send_seconds', sa.SmallInteger(), nullable=False, server_default=sa.text('5')),
    )
    op.create_table(
        'outbox_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('send_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('enqueued_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('idempotency_key', sa.String(length=128), nullable=False),
        sa.Column('mode', sa.String(length=16), nullable=False),
        sa.Column('recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('subject', sa.Text(), nullable=False),
        sa.Column('snippet', sa.String(length=255), nullable=False),
        sa.Column('body_html', sa.Text(), nullable=False),
        sa.Column('source_message_id', sa.UUID(), nullable=True),
        sa.Column('draft_id', sa.UUID(), nullable=True),
        sa.Column('forward_attachment_ids', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column('error_code', sa.String(length=64), nullable=True),
        sa.Column('message_id', sa.UUID(), nullable=True),
        sa.Column('thread_id', sa.UUID(), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['account_id', 'user_id'], ['email_accounts.id', 'email_accounts.user_id'],
                                name=op.f('fk_outbox_items_account_id_user_id_email_accounts'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_outbox_items')),
        sa.UniqueConstraint('user_id', 'idempotency_key', name=op.f('uq_outbox_items_user_id_idempotency_key')),
        sa.CheckConstraint("status IN ('pending', 'sending', 'sent', 'cancelled', 'failed')",
                           name=op.f('ck_outbox_items_status')),
    )
    op.create_index('ix_outbox_items_due', 'outbox_items', ['next_attempt_at'],
                    postgresql_where=sa.text("status IN ('pending', 'sending')"))
    op.create_index('ix_outbox_items_user_id_send_at', 'outbox_items', ['user_id', 'send_at'])
    op.create_table(
        'outbox_attachments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('outbox_id', sa.UUID(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=255), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('content', sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(['outbox_id'], ['outbox_items.id'],
                                name=op.f('fk_outbox_attachments_outbox_id_outbox_items'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_outbox_attachments')),
    )
    op.create_index(op.f('ix_outbox_attachments_user_id'), 'outbox_attachments', ['user_id'])
    op.create_index(op.f('ix_outbox_attachments_outbox_id'), 'outbox_attachments', ['outbox_id'])

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

    # The beat task has no tenant context, so it finds due work through this narrowly scoped
    # definer function. It returns identifiers only and never changes an item's status: the
    # worker that receives the ids claims the row itself, inside the owner's tenant context.
    # SKIP LOCKED lets several beat/scan callers run without handing out the same row twice;
    # ``enqueued_until`` keeps one scan from re-enqueueing what another just handed out.
    op.execute(
        """
        CREATE FUNCTION mailflow_claim_due_outbox(p_limit integer, p_lease_seconds integer)
        RETURNS TABLE (user_id uuid, outbox_id uuid)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH due AS (
            SELECT o.id
            FROM outbox_items o
            JOIN users u ON u.id = o.user_id
            WHERE u.status = 'active'
              AND ((o.status = 'pending' AND o.next_attempt_at <= now())
                   OR (o.status = 'sending' AND o.locked_until <= now()))
              AND (o.enqueued_until IS NULL OR o.enqueued_until <= now())
            ORDER BY o.next_attempt_at
            LIMIT p_limit
            FOR UPDATE OF o SKIP LOCKED
          )
          UPDATE outbox_items o
          SET enqueued_until = now() + make_interval(secs => p_lease_seconds)
          FROM due
          WHERE o.id = due.id
          RETURNING o.user_id, o.id
        $$;
        """
    )
    op.execute(f"REVOKE ALL ON FUNCTION {CLAIM} FROM PUBLIC")
    op.execute(f'GRANT EXECUTE ON FUNCTION {CLAIM} TO "{APP_ROLE}"')
    op.execute(_cleanup(_CLEANUP_BASE + _CLEANUP_OUTBOX))


def downgrade() -> None:
    op.execute(_cleanup(_CLEANUP_BASE))
    op.execute(f"DROP FUNCTION IF EXISTS {CLAIM}")
    op.drop_table('outbox_attachments')
    op.drop_table('outbox_items')
    op.drop_column('user_settings', 'undo_send_seconds')
