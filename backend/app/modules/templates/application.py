from __future__ import annotations

import builtins
import uuid
from typing import Protocol

from app.modules.emails.application.ports import HtmlSanitizer
from app.modules.templates.domain import (
    MAX_BODY_BYTES,
    MAX_NAME_LENGTH,
    MAX_SUBJECT_LENGTH,
    MAX_TEMPLATES_PER_USER,
    Template,
    TemplateContent,
)
from app.shared.domain.errors import ConflictError, FieldProblem, InvalidInputError, NotFoundError


class TemplateRepository(Protocol):
    async def list(self, user_id: uuid.UUID) -> builtins.list[Template]: ...
    async def get(self, user_id: uuid.UUID, template_id: uuid.UUID) -> Template | None: ...
    async def count(self, user_id: uuid.UUID) -> int: ...
    async def create(self, user_id: uuid.UUID, content: TemplateContent) -> Template: ...
    async def update(
        self, user_id: uuid.UUID, template_id: uuid.UUID, content: TemplateContent
    ) -> Template | None: ...
    async def delete(self, user_id: uuid.UUID, template_id: uuid.UUID) -> bool: ...


class TemplateService:
    def __init__(self, repository: TemplateRepository, sanitizer: HtmlSanitizer) -> None:
        self._repo = repository
        self._sanitizer = sanitizer

    async def list(self, user_id: uuid.UUID) -> builtins.list[Template]:
        return await self._repo.list(user_id)

    async def create(self, user_id: uuid.UUID, content: TemplateContent) -> Template:
        clean = self._validate(content)
        if await self._repo.count(user_id) >= MAX_TEMPLATES_PER_USER:
            raise ConflictError("Too many templates.", code="template_limit_reached")
        return await self._repo.create(user_id, clean)

    async def update(
        self, user_id: uuid.UUID, template_id: uuid.UUID, changes: dict[str, str]
    ) -> Template:
        current = await self._repo.get(user_id, template_id)
        if current is None:
            raise NotFoundError
        merged = TemplateContent(
            name=changes.get("name", current.name),
            subject=changes.get("subject", current.subject),
            body_html=changes.get("body_html", current.body_html),
        )
        updated = await self._repo.update(user_id, template_id, self._validate(merged))
        if updated is None:
            raise NotFoundError
        return updated

    async def delete(self, user_id: uuid.UUID, template_id: uuid.UUID) -> None:
        if not await self._repo.delete(user_id, template_id):
            raise NotFoundError

    def _validate(self, content: TemplateContent) -> TemplateContent:
        name = " ".join(content.name.split())
        subject = " ".join(content.subject.split())
        problems: list[FieldProblem] = []
        if not name:
            problems.append(FieldProblem("name", "required"))
        elif len(name) > MAX_NAME_LENGTH:
            problems.append(FieldProblem("name", "too_long"))
        if len(subject) > MAX_SUBJECT_LENGTH:
            problems.append(FieldProblem("subject", "too_long"))
        if len(content.body_html.encode()) > MAX_BODY_BYTES:
            problems.append(FieldProblem("body_html", "too_long"))
        if problems:
            raise InvalidInputError(problems=problems)
        # Stored already sanitized: the composer loads it straight into the editor.
        body = self._sanitizer.sanitize(content.body_html).html if content.body_html else ""
        return TemplateContent(name=name, subject=subject, body_html=body)
