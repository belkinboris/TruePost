from typing import Optional
from pydantic import BaseModel


class AuthIn(BaseModel):
    email: str
    password: str
    ref_code: str = ""


class ChannelIn(BaseModel):
    title: str
    tg_chat: str = ""
    about: str = ""
    style: str = ""
    style_profile: str = ""
    post_length: str = "100-200 слов"
    language: str = "русский"
    post_voice: str = "author"
    post_format: str = "story"
    emoji_style: str = "minimal"
    cta_enabled: bool = False
    cta_text: str = ""
    use_web_search: bool = True
    auto_publish: bool = False
    schedule_kind: str = "interval"
    interval_hours: int = 12
    daily_times: list[str] = ["10:00"]
    enabled: bool = True
    onboarded: bool = False


class ChannelPatch(BaseModel):
    title: Optional[str] = None
    tg_chat: Optional[str] = None
    about: Optional[str] = None
    style: Optional[str] = None
    style_profile: Optional[str] = None
    post_length: Optional[str] = None
    language: Optional[str] = None
    post_voice: Optional[str] = None
    post_format: Optional[str] = None
    emoji_style: Optional[str] = None
    cta_enabled: Optional[bool] = None
    cta_text: Optional[str] = None
    use_web_search: Optional[bool] = None
    auto_publish: Optional[bool] = None
    schedule_kind: Optional[str] = None
    interval_hours: Optional[int] = None
    daily_times: Optional[list[str]] = None
    enabled: Optional[bool] = None
    onboarded: Optional[bool] = None


class SourceIn(BaseModel):
    url: str


class AnalyzeIn(BaseModel):
    link: str


class AnalyzeStyleOnly(BaseModel):
    link: str


class GenerateFormatIn(BaseModel):
    post_format: str = "story"


class PostIn(BaseModel):
    topic: str = ""


class PostPatch(BaseModel):
    text: str


class ScheduleIn(BaseModel):
    scheduled_at: str


class BuyIn(BaseModel):
    package_id: str
