from __future__ import annotations

import uuid

from fastapi import APIRouter
from fastapi.responses import Response

from app.api.deps import Auth, Svc
from app.core.security.filenames import content_disposition_attachment

router = APIRouter(prefix="/attachments", tags=["attachments"])


@router.get("/{attachment_id}/download")
async def download_attachment(attachment_id: uuid.UUID, auth: Auth, svc: Svc) -> Response:
    attachment, content = await svc.attachments.download(auth.user_id, attachment_id)
    return Response(
        content=content,
        # Always served as an opaque download: never rendered inline, never sniffed.
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": content_disposition_attachment(attachment.filename),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Cache-Control": "private, no-store",
        },
    )
