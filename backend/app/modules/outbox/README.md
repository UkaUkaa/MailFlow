# outbox

Server-side scheduled outbox: one mechanism behind **Send later** and **Undo send** (D42).

- `domain.py` — `OutboxItem`, statuses, the rules for what may be cancelled or rescheduled.
- `application.py` — `OutboxService` (submit, list, reschedule, cancel; API side) and
  `OutboxDispatcher` (claim and send one item; worker side). Sending goes through
  `emails.application.compose.ComposeService` with the item's idempotency key.
- `infrastructure.py` — `outbox_items` / `outbox_attachments` (both under tenant RLS) and the
  repository, including the atomic `pending -> sending` claim.
- `presentation.py` — `/api/v1/outbox`.

Celery (`app/infrastructure/celery/tasks.py`): `outbox.dispatch_due` (beat) asks the
`mailflow_claim_due_outbox` SECURITY DEFINER function for due ids (`FOR UPDATE SKIP LOCKED`) and
enqueues `outbox.send(user_id, outbox_id)`. Tasks carry identifiers only.
