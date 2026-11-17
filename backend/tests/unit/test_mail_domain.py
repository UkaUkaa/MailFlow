from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.integrations.email_providers.contracts import Address, FolderRole, ThreadAction
from app.modules.emails.application.queries import build_prefix_query
from app.modules.emails.domain.entities import (
    MessageFlags,
    MessageState,
    apply_action,
    compute_thread_state,
)

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def flags(**overrides):
    base = {"is_read": True, "is_starred": False, "is_draft": False, "in_inbox": True,
            "in_sent": False, "in_trash": False, "in_spam": False}  # fmt: skip
    return MessageFlags(**{**base, **overrides})


def state(minutes=0, sender="a@example.com", subject="S", **flag_overrides):
    return MessageState(
        flags=flags(**flag_overrides),
        sent_at=T0 + timedelta(minutes=minutes),
        subject=subject,
        snippet=f"snip{minutes}",
        sender=Address(email=sender),
        has_attachments=False,
    )


def test_from_roles():
    f = MessageFlags.from_roles(
        frozenset({FolderRole.INBOX, FolderRole.TRASH}), is_read=False, is_starred=True,
        is_draft=False,
    )  # fmt: skip
    assert f.in_inbox and f.in_trash and not f.in_sent and f.is_starred and not f.is_read


@pytest.mark.parametrize(
    ("action", "start", "expected"),
    [
        (ThreadAction.MARK_READ, {"is_read": False}, {"is_read": True}),
        (ThreadAction.MARK_UNREAD, {}, {"is_read": False}),
        (ThreadAction.STAR, {}, {"is_starred": True}),
        (ThreadAction.UNSTAR, {"is_starred": True}, {"is_starred": False}),
        (ThreadAction.ARCHIVE, {}, {"in_inbox": False}),
        (ThreadAction.UNARCHIVE, {"in_inbox": False}, {"in_inbox": True}),
        (ThreadAction.TRASH, {"in_spam": True}, {"in_trash": True, "in_inbox": False,
                                                 "in_spam": False}),
        (ThreadAction.RESTORE, {"in_trash": True, "in_inbox": False},
         {"in_trash": False, "in_inbox": True}),
        (ThreadAction.SPAM, {}, {"in_spam": True, "in_inbox": False}),
        (ThreadAction.NOT_SPAM, {"in_spam": True, "in_inbox": False},
         {"in_spam": False, "in_inbox": True}),
    ],
)  # fmt: skip
def test_apply_action(action, start, expected):
    result = apply_action(flags(**start), action)
    for key, value in expected.items():
        assert getattr(result, key) is value, key


def test_every_action_is_handled():
    for action in ThreadAction:
        assert isinstance(apply_action(flags(), action), MessageFlags)


def test_thread_state_basic():
    result = compute_thread_state(
        [state(2, sender="b@example.com", subject="Re: S", is_read=False), state(1)]
    )
    assert result is not None
    assert result.subject == "S" and result.snippet == "snip2" and result.message_count == 2
    assert [p.email for p in result.participants] == ["a@example.com", "b@example.com"]
    assert result.is_unread and result.in_inbox and not result.in_archive
    assert result.last_message_at == T0 + timedelta(minutes=2)


def test_thread_state_empty_is_none():
    assert compute_thread_state([]) is None


def test_archived_sent_draft_trash_views():
    archived = compute_thread_state([state(in_inbox=False)])
    assert archived and archived.in_archive and not archived.in_inbox
    sent_only = compute_thread_state([state(in_inbox=False, in_sent=True)])
    assert sent_only and sent_only.in_sent and not sent_only.in_archive
    draft_only = compute_thread_state([state(in_inbox=False, is_draft=True)])
    assert draft_only and draft_only.in_drafts and not draft_only.in_archive
    trashed = compute_thread_state([state(in_inbox=False, in_trash=True, is_starred=True)])
    assert trashed and trashed.in_trash and not trashed.in_inbox and not trashed.in_archive
    assert not trashed.is_starred and trashed.message_count == 1


def test_partially_trashed_thread_stays_visible_with_live_messages_only():
    result = compute_thread_state(
        [state(1), state(2, in_inbox=False, in_trash=True, is_read=False)]
    )
    assert result and result.in_inbox and result.in_trash
    assert result.message_count == 1 and not result.is_unread and result.snippet == "snip1"


def test_participants_are_capped_and_unique():
    states = [state(i, sender=f"u{i % 9}@example.com") for i in range(30)]
    result = compute_thread_state(states)
    assert result and len(result.participants) == 6


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("quarterly report", "quarterly:* & report:*"),
        ("  Hello,   World!! ", "hello:* & world:*"),
        ("alice@example.com", "'alice@example.com':*"),
        ("звіт", "звіт:*"),
        ("a' | b & !c :* (d)", "a:* & b:* & c:* & d:*"),
        ("--- ... @@@", None),
        ("", None),
    ],
)
def test_build_prefix_query(text, expected):
    assert build_prefix_query(text) == expected


def test_prefix_query_is_bounded():
    assert build_prefix_query(" ".join(f"w{i}" for i in range(50))).count("&") == 7
