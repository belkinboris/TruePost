"""Pydantic-схемы запросов/ответов."""

from typing import Optional
from pydantic import BaseModel


class AuthIn(BaseModel):
    email: str
    password: str


class ChannelIn(BaseModel):
    title: str
    tg_chat: str = ""
    about: str = ""
    style: str = ""
    post_length: str = "100-200 слов"
    language: str = "русский"
    use_web_search: bool = True
    auto_publish: bool = False
    schedule_kind: str = "interval"
    interval_hours: int = 12
    daily_times: list[str] = ["10:00"]
    enabled: bool = True


class ChannelPatch(BaseModel):
    title: Optional[str] = None
    tg_chat: Optional[str] = None
    about: Optional[str] = None
    style: Optional[str] = None
    post_length: Optional[str] = None
    language: Optional[str] = None
    use_web_search: Optional[bool] = None
    auto_publish: Optional[bool] = None
    schedule_kind: Optional[str] = None
    interval_hours: Optional[int] = None
    daily_times: Optional[list[str]] = None
    enabled: Optional[bool] = None


class SourceIn(BaseModel):
    url: str


class AnalyzeIn(BaseModel):
    link: str


class PostPatch(BaseModel):
    text: str


class ScheduleIn(BaseModel):
    scheduled_at: str   # ISO 8601, например "2025-06-02T10:00:00"


class BuyIn(BaseModel):
    package_id: str
