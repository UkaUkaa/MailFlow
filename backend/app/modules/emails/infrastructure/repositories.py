from __future__ import annotations

import builtins
import uuid
from typing import Any

from sqlalchemy import ColumnElement, and_, delete, func, or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.integrations.email_providers.contracts import Address, FolderRole
from app.modules.emails.application.ports import ThreadFilter
from app.modules.emails.domain.entities import (
    DraftMeta,
    Message,
    MessageFlags,
    MessageState,
    StoredMessage,
    ThreadState,
    ThreadSummary,
)
from app.modules.emails.infrastructure.models import EmailMessageModel as M
from app.modules.emails.infrastructure.models import EmailThreadModel as T
from app.shared.application.pagination import KeysetCursor

_VIEW_COLUMNS = {
    FolderRole.INBOX: T.in_inbox,
    FolderRole.SENT: T.in_sent,
    FolderRole.DRAFTS: T.in_drafts,
    FolderRole.STARRED: T.is_starred,
    FolderRole.ARCHIVE: T.in_archive,
    FolderRole.TRASH: T.in_trash,
    FolderRole.SPAM: T.in_spam,
}


def _addresses(values: tuple[Address, ...]) -> list[dict[str, Any]]:
    return [{"name": a.name, "email": a.email} for a in values]


def _to_addresses(values: list[dict[str, Any]] | None) -> tuple[Address, ...]:
    return tuple(Address(email=str(v["email"]), name=v.get("name")) for v in values or [])


def _flags(row: M) -> MessageFlags:
    return MessageFlags(
        is_read=row.is_read,
        is_starred=row.is_starred,
        is_draft=row.is_draft,
        in_inbox=row.in_inbox,
        in_sent=row.in_sent,
        in_trash=row.in_trash,
        in_spam=row.in_spam,
    )


def _flag_values(flags: MessageFlags) -> dict[str, bool]:
    return {
        "is_read": flags.is_read,
        "is_starred": flags.is_starred,
        "is_draft": flags.is_draft,
        "in_inbox": flags.in_inbox,
        "in_sent": flags.in_sent,
        "in_trash": flags.in_trash,
        "in_spam": flags.in_spam,
    }


def _sender(row: M) -> Address | None:
    return Address(email=row.from_email, name=row.from_name) if row.from_email else None


def _summary(row: T) -> ThreadSummary:
    return ThreadSummary(
        id=row.id,
        account_id=row.account_id,
        provider_thread_id=row.provider_thread_id,
        subject=row.subject,
        snippet=row.snippet,
        participants=_to_addresses(row.participants),
        message_count=row.message_count,
        has_attachments=row.has_attachments,
        is_unread=row.is_unread,
        is_starred=row.is_starred,
        last_message_at=row.last_message_at,
    )


def _message(row: M) -> Message:
    meta = None
    if row.draft_meta:
        source = row.draft_meta.get("source_message_id")
        meta = DraftMeta(
            mode=str(row.draft_meta.get("mode", "new")),
            source_message_id=uuid.UUID(source) if source else None,
        )
    return Message(
        id=row.id,
        thread_id=row.thread_id,
        account_id=row.account_id,
        provider_message_id=row.provider_message_id,
        provider_draft_id=row.provider_draft_id,
        sender=_sender(row),
        to=_to_addresses(row.to_addresses),
        cc=_to_addresses(row.cc_addresses),
        bcc=_to_addresses(row.bcc_addresses),
        reply_to=_to_addresses(row.reply_to_addresses),
        subject=row.subject,
        snippet=row.snippet,
        sent_at=row.sent_at,
        flags=_flags(row),
        rfc822_message_id=row.rfc822_message_id,
        references=row.references_header,
        has_remote_images=row.has_remote_images,
        body_html=row.body_html,
        body_text=row.body_text,
        draft_meta=meta,
        updated_at=row.updated_at,
    )


def _after(cursor: KeysetCursor | None) -> ColumnElement[bool] | None:
    if cursor is None:
        return None
    return tuple_(T.last_message_at, T.id) < tuple_(cursor.at, uuid.UUID(cursor.id))


class SqlMailRepository:
    """Every statement filters on ``user_id``; RLS enforces the same rule underneath."""

    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    # -- writes ----------------------------------------------------------------------------

    async def upsert_thread(
        self, user_id: uuid.UUID, account_id: uuid.UUID, provider_thread_id: str
    ) -> uuid.UUID:
        stmt = insert(T).values(
            id=uuid.uuid4(),
            user_id=user_id,
            account_id=account_id,
            provider_thread_id=provider_thread_id,
        )
        result = await self._db.execute(
            stmt.on_conflict_do_update(
                index_elements=["account_id", "provider_thread_id"],
                set_={"updated_at": func.now()},
                where=T.user_id == user_id,
            ).returning(T.id)
        )
        return result.scalar_one()

    async def upsert_message(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        thread_id: uuid.UUID,
        message: StoredMessage,
    ) -> uuid.UUID:
        values: dict[str, Any] = {
            "thread_id": thread_id,
            "rfc822_message_id": message.rfc822_message_id,
            "in_reply_to": message.in_reply_to,
            "references_header": message.references,
            "from_name": message.sender.name if message.sender else None,
            "from_email": message.sender.email if message.sender else None,
            "to_addresses": _addresses(message.to),
            "cc_addresses": _addresses(message.cc),
            "bcc_addresses": _addresses(message.bcc),
            "reply_to_addresses": _addresses(message.reply_to),
            "subject": message.subject,
            "snippet": message.snippet,
            "sent_at": message.sent_at,
            "folder_ids": list(message.folder_ids),
            "has_attachments": message.has_attachments,
            "has_remote_images": message.has_remote_images,
            "size_estimate": message.size_estimate,
            "body_html": message.body_html,
            "body_text": message.body_text,
            **_flag_values(message.flags),
        }
        if message.provider_draft_id is not None:
            values["provider_draft_id"] = message.provider_draft_id
        stmt = insert(M).values(
            id=uuid.uuid4(),
            user_id=user_id,
            account_id=account_id,
            provider_message_id=message.provider_message_id,
            **values,
        )
        result = await self._db.execute(
            stmt.on_conflict_do_update(
                index_elements=["account_id", "provider_message_id"],
                set_={**values, "updated_at": func.now()},
                where=M.user_id == user_id,
            ).returning(M.id)
        )
        return result.scalar_one()

    async def delete_by_provider_ids(
        self, user_id: uuid.UUID, account_id: uuid.UUID, provider_message_ids: builtins.list[str]
    ) -> builtins.list[uuid.UUID]:
        result = await self._db.execute(
            delete(M)
            .where(
                M.user_id == user_id,
                M.account_id == account_id,
                M.provider_message_id.in_(provider_message_ids),
            )
            .returning(M.thread_id)
        )
        return list(dict.fromkeys(result.scalars().all()))

    async def delete_message(self, user_id: uuid.UUID, message_id: uuid.UUID) -> None:
        await self._db.execute(delete(M).where(M.user_id == user_id, M.id == message_id))

    async def purge_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        await self._db.execute(delete(T).where(T.user_id == user_id, T.account_id == account_id))

    async def delete_empty_threads(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        has_messages = select(M.id).where(M.thread_id == T.id).exists()
        await self._db.execute(
            delete(T).where(T.user_id == user_id, T.account_id == account_id, ~has_messages)
        )

    async def message_states(
        self, user_id: uuid.UUID, thread_id: uuid.UUID
    ) -> builtins.list[MessageState]:
        rows = await self._db.scalars(
            select(M)
            .where(M.user_id == user_id, M.thread_id == thread_id)
            .execution_options(populate_existing=True)
        )
        return [
            MessageState(
                flags=_flags(r),
                sent_at=r.sent_at,
                subject=r.subject,
                snippet=r.snippet,
                sender=_sender(r),
                has_attachments=r.has_attachments,
            )
            for r in rows
        ]

    async def save_thread_state(
        self, user_id: uuid.UUID, thread_id: uuid.UUID, state: ThreadState | None
    ) -> None:
        scope = (T.user_id == user_id, T.id == thread_id)
        if state is None:
            await self._db.execute(delete(T).where(*scope))
            return
        await self._db.execute(
            update(T)
            .where(*scope)
            .values(
                subject=state.subject,
                snippet=state.snippet,
                participants=_addresses(state.participants),
                message_count=state.message_count,
                has_attachments=state.has_attachments,
                is_unread=state.is_unread,
                is_starred=state.is_starred,
                last_message_at=state.last_message_at,
                in_inbox=state.in_inbox,
                in_sent=state.in_sent,
                in_drafts=state.in_drafts,
                in_archive=state.in_archive,
                in_trash=state.in_trash,
                in_spam=state.in_spam,
            )
        )

    async def set_flags(
        self, user_id: uuid.UUID, message_id: uuid.UUID, flags: MessageFlags
    ) -> None:
        await self._db.execute(
            update(M).where(M.user_id == user_id, M.id == message_id).values(**_flag_values(flags))
        )

    async def set_draft_meta(
        self, user_id: uuid.UUID, message_id: uuid.UUID, meta: DraftMeta
    ) -> None:
        payload = {
            "mode": meta.mode,
            "source_message_id": str(meta.source_message_id) if meta.source_message_id else None,
        }
        await self._db.execute(
            update(M).where(M.user_id == user_id, M.id == message_id).values(draft_meta=payload)
        )

    async def repoint_draft(
        self,
        user_id: uuid.UUID,
        message_id: uuid.UUID,
        *,
        provider_message_id: str,
        provider_draft_id: str,
    ) -> None:
        await self._db.execute(
            update(M)
            .where(M.user_id == user_id, M.id == message_id)
            .values(provider_message_id=provider_message_id, provider_draft_id=provider_draft_id)
        )

    async def relocate_message(
        self, user_id: uuid.UUID, account_id: uuid.UUID, old_id: str, new_id: str
    ) -> None:
        mine = (M.user_id == user_id, M.account_id == account_id)
        taken = await self._db.scalar(select(M.id).where(*mine, M.provider_message_id == new_id))
        if taken is not None:
            # A synchronization got there first; keep its row.
            await self._db.execute(delete(M).where(*mine, M.provider_message_id == old_id))
            return
        await self._db.execute(
            update(M)
            .where(*mine, M.provider_message_id == old_id)
            .values(provider_message_id=new_id)
        )
        threads = (T.user_id == user_id, T.account_id == account_id)
        clash = await self._db.scalar(select(T.id).where(*threads, T.provider_thread_id == new_id))
        if clash is None:
            await self._db.execute(
                update(T)
                .where(*threads, T.provider_thread_id == old_id)
                .values(provider_thread_id=new_id)
            )

    # -- reads -----------------------------------------------------------------------------

    async def list_threads(
        self, user_id: uuid.UUID, flt: ThreadFilter, cursor: KeysetCursor | None, limit: int
    ) -> builtins.list[ThreadSummary]:
        conditions: list[ColumnElement[bool]] = [T.user_id == user_id]
        if flt.custom_folder is not None:
            account_id, provider_folder_id = flt.custom_folder
            conditions += [
                T.account_id == account_id,
                T.in_trash.is_(False),
                T.in_spam.is_(False),
                select(M.id)
                .where(
                    M.thread_id == T.id,
                    M.user_id == user_id,
                    M.folder_ids.contains([provider_folder_id]),
                )
                .exists(),
            ]
        elif flt.role is not None:
            conditions.append(_VIEW_COLUMNS[flt.role].is_(True))
        if flt.account_id is not None:
            conditions.append(T.account_id == flt.account_id)
        if flt.unread_only:
            conditions.append(T.is_unread.is_(True))
        after = _after(cursor)
        if after is not None:
            conditions.append(after)
        rows = await self._db.scalars(
            select(T)
            .where(and_(*conditions))
            .order_by(T.last_message_at.desc(), T.id.desc())
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return [_summary(r) for r in rows]

    async def search_threads(
        self,
        user_id: uuid.UUID,
        query: str,
        account_id: uuid.UUID | None,
        cursor: KeysetCursor | None,
        limit: int,
    ) -> builtins.list[ThreadSummary]:
        match = select(M.thread_id).where(
            M.user_id == user_id,
            M.in_trash.is_(False),
            M.in_spam.is_(False),
            M.search_vector.op("@@")(func.to_tsquery("simple", query)),
        )
        conditions: list[ColumnElement[bool]] = [T.user_id == user_id, T.id.in_(match)]
        if account_id is not None:
            conditions.append(T.account_id == account_id)
        after = _after(cursor)
        if after is not None:
            conditions.append(after)
        rows = await self._db.scalars(
            select(T)
            .where(and_(*conditions))
            .order_by(T.last_message_at.desc(), T.id.desc())
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return [_summary(r) for r in rows]

    async def get_thread(self, user_id: uuid.UUID, thread_id: uuid.UUID) -> ThreadSummary | None:
        row = await self._db.scalar(
            select(T)
            .where(T.user_id == user_id, T.id == thread_id)
            .execution_options(populate_existing=True)
        )
        return _summary(row) if row else None

    async def list_messages(
        self, user_id: uuid.UUID, thread_id: uuid.UUID
    ) -> builtins.list[Message]:
        rows = await self._db.scalars(
            select(M)
            .where(M.user_id == user_id, M.thread_id == thread_id)
            .options(undefer(M.body_html), undefer(M.body_text))
            .order_by(M.sent_at, M.id)
            .execution_options(populate_existing=True)
        )
        return [_message(r) for r in rows]

    async def get_message(self, user_id: uuid.UUID, message_id: uuid.UUID) -> Message | None:
        row = await self._db.scalar(
            select(M)
            .where(M.user_id == user_id, M.id == message_id)
            .options(undefer(M.body_html), undefer(M.body_text))
            .execution_options(populate_existing=True)
        )
        return _message(row) if row else None

    async def unread_counts(
        self, user_id: uuid.UUID, account_id: uuid.UUID | None
    ) -> dict[FolderRole, int]:
        """Unread conversations per view; for drafts the total number of drafts."""
        columns = [
            func.count().filter(column.is_(True), T.is_unread.is_(True)).label(role.value)
            for role, column in _VIEW_COLUMNS.items()
            if role is not FolderRole.DRAFTS
        ]
        columns.append(func.count().filter(T.in_drafts.is_(True)).label(FolderRole.DRAFTS.value))
        stmt = select(*columns).where(
            T.user_id == user_id, or_(T.is_unread.is_(True), T.in_drafts.is_(True))
        )
        if account_id is not None:
            stmt = stmt.where(T.account_id == account_id)
        row = (await self._db.execute(stmt)).one()._mapping
        counts = {role: int(row[role.value]) for role in _VIEW_COLUMNS}
        counts[FolderRole.SENT] = 0  # an unread badge on Sent is noise
        return counts
