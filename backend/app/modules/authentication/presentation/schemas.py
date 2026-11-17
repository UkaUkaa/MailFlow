from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class RegisterRequest(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)
    display_name: str = Field(min_length=1, max_length=100)
    locale: Literal["en", "uk"] | None = None


class LoginRequest(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class TokenRequest(Strict):
    token: str = Field(min_length=10, max_length=200)


class EmailRequest(Strict):
    email: EmailStr
    locale: Literal["en", "uk"] | None = None


class ResetPasswordRequest(Strict):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=1, max_length=1024)


class ChangePasswordRequest(Strict):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=1, max_length=1024)


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    email_verified: bool
    created_at: datetime


class UserEnvelope(BaseModel):
    user: UserResponse


class StatusResponse(BaseModel):
    status: str


class CsrfResponse(BaseModel):
    csrf_token: str


class SessionResponse(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip_address: str | None
    is_current: bool


class SessionList(BaseModel):
    items: list[SessionResponse]
