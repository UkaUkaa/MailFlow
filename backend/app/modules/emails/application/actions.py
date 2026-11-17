"""Write side: read/star/archive/trash/spam on threads and single messages."""

from __future__ import annotations

import uuid

from app.integrations.email_providers.contracts import ThreadAction
from app.modules.email_accounts.application.sessions import ProviderSessionFactory
from app.modules.emails.application.ingestion import MessageIngestor
from app.modules.emails.application.ports import MailRepository
from app.modules.emails.domain.entities import Message, ThreadSummary, apply_action
from app.shared.domain.errors import InvalidInputError, NotFoundError, UnsupportedError

MESSAGE_ACTIONS = frozenset(
    {ThreadAction.MARK_READ, ThreadAction.MARK_UNREAD, ThreadAction.STAR, ThreadAction.UNSTAR}
)
MAX_BULK = 100


class ThreadActionService:
    def __init__(
        self, mail: MailRepository, sessions: ProviderSessionFactory, ingestor: MessageIngestor
    ) -> None:
        self._mail = mail
        self._sessions = sessions
        self._ingestor = ingestor

    async def apply(
        self, user_id: uuid.UUID, thread_id: uuid.UUID, action: ThreadAction
    ) -> ThreadSummary:
        thread = await self._mail.get_thread(user_id, thread_id)
        if thread is None:
            raise NotFoundError
        async with self._sessions.open(user_id, thread.account_id) as session:
            caps = session.provider.capabilities
            if action in (ThreadAction.SPAM, ThreadAction.NOT_SPAM) and not caps.spam:
                raise UnsupportedError
            if action in (ThreadAction.ARCHIVE, ThreadAction.UNARCHIVE) and not caps.archive:
                raise UnsupportedError
            # Provider first: local state changes only after the mailbox really changed.
            moved = await session.provider.modify_thread(thread.provider_thread_id, action)
        for relocation in moved or ():
            await self._ingestor.relocate(
                user_id, thread.account_id, relocation.old_message_id, relocation.new_message_id
            )
        for message in await self._mail.list_messages(user_id, thread_id):
            await self._mail.set_flags(user_id, message.id, apply_action(message.flags, action))
        await self._ingestor.refresh_threads(user_id, [thread_id])
        updated = await self._mail.get_thread(user_id, thread_id)
        if updated is None:
            raise NotFoundError
        return updated

    async def apply_many(
        self, user_id: uuid.UUID, thread_ids: list[uuid.UUID], action: ThreadAction
    ) -> list[uuid.UUID]:
        if not thread_ids or len(thread_ids) > MAX_BULK:
            raise InvalidInputError(f"Between 1 and {MAX_BULK} threads are required.")
        updated: list[uuid.UUID] = []
        for thread_id in dict.fromkeys(thread_ids):
            try:
                await self.apply(user_id, thread_id, action)
            except NotFoundError:
                continue  # foreign or vanished ids are skipped, never revealed
            updated.append(thread_id)
        return updated

    async def apply_to_message(
        self, user_id: uuid.UUID, message_id: uuid.UUID, action: ThreadAction
    ) -> Message:
        if action not in MESSAGE_ACTIONS:
            raise InvalidInputError("This action applies to whole conversations.")
        message = await self._mail.get_message(user_id, message_id)
        if message is None:
            raise NotFoundError
        async with self._sessions.open(user_id, message.account_id) as session:
            moved = await session.provider.modify_message(message.provider_message_id, action)
        for relocation in moved or ():
            await self._ingestor.relocate(
                user_id, message.account_id, relocation.old_message_id, relocation.new_message_id
            )
        await self._mail.set_flags(user_id, message.id, apply_action(message.flags, action))
        await self._ingestor.refresh_threads(user_id, [message.thread_id])
        updated = await self._mail.get_message(user_id, message_id)
        if updated is None:
            raise NotFoundError
        return updated
