"""
База данных: SQLModel + SQLAlchemy.
Postgres (Railway) или SQLite (локально).
"""

from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, create_engine, Session, select
import config

db_url = config.DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
engine = create_engine(db_url, echo=False, connect_args=connect_args, pool_pre_ping=True)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    token_balance: int = 0
    is_admin: bool = False
    plan: str = "free"
    plan_posts_used: int = 0
    plan_reset_at: Optional[datetime] = None
    ref_code: str = ""
    referred_by: Optional[int] = Field(default=None, foreign_key="user.id")
    ref_bonus_given: bool = False
    # Telegram уведомления
    tg_chat_id: Optional[int] = None       # числовой id чата с ботом (из /start)
    tg_username: str = ""                   # для отображения
    notify_new_post: bool = False
    notify_published: bool = False
    notify_low_tokens: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Channel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str
    tg_chat: str = ""
    verified: bool = False

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
    interval_hours: float = 12.0           # float: 0.25=15мин, 0.5=30мин, 1, 3, 6...
    interval_jitter_minutes: int = 0       # ±N минут рандомизации
    publish_window_start: str = ""         # "09:00" — начало окна публикации
    publish_window_end: str = ""           # "22:00" — конец окна
    daily_times: str = '["10:00"]'

    channel_type: str = "thematic"  # "thematic" или "news"
    enabled: bool = True
    onboarded: bool = False
    last_generated_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ChannelRule(SQLModel, table=True):
    """Персональные правила стиля канала из диалога с ИИ-консультантом."""
    id: Optional[int] = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id", index=True)
    rule_text: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Source(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id", index=True)
    url: str
    enabled: bool = True


class Post(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    text: str
    status: str = "pending"
    scheduled_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    tg_message_id: Optional[int] = None
    tokens_used: int = 0
    post_format: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Payment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    package_id: str
    label: str = Field(index=True)
    rub: float
    tokens: int
    status: str = "pending"
    operation_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    paid_at: Optional[datetime] = None


class Referral(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    referrer_id: int = Field(foreign_key="user.id", index=True)
    referred_id: int = Field(foreign_key="user.id")
    bonus_tokens: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


def init_db():
    SQLModel.metadata.create_all(engine)


def session():
    return Session(engine)


def all_enabled_channels(s: Session) -> list[Channel]:
    return list(s.exec(select(Channel).where(Channel.enabled == True)).all())  # noqa


def due_scheduled_posts(s: Session, now: datetime) -> list[Post]:
    return list(
        s.exec(select(Post).where(Post.status == "scheduled", Post.scheduled_at <= now)).all()
    )
