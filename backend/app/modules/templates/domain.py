"""Message templates: reusable subject and body a user inserts into the composer."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

MAX_NAME_LENGTH = 100
MAX_SUBJECT_LENGTH = 998  # RFC 5322 line limit, same as the composer's subject field
MAX_BODY_BYTES = 100 * 1024
MAX_TEMPLATES_PER_USER = 200

# Placeholders the composer fills in when a template is inserted. Anything else in double
# braces is left as written, so a template never fails to insert.
PLACEHOLDERS = ("first_name", "name", "email", "my_name", "date")


@dataclass(frozen=True, slots=True)
class TemplateContent:
    name: str
    subject: str
    body_html: str


@dataclass(frozen=True, slots=True)
class Template:
    id: uuid.UUID
    name: str
    subject: str
    body_html: str
    created_at: datetime
    updated_at: datetime
