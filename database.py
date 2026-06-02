"""
База данных: SQLModel поверх SQLAlchemy.
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
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Channel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str
    tg_chat: str = ""
    verified: bool = False

    # Основные настройки
    about: str = ""
    style: str = ""
    style_profile: str = ""
    post_length: str = "100-200 слов"
    language: str = "русский"

    # Расширенные настройки (новые)
    post_voice: str = "author"        # author = от первого лица, news = сухие новости, expert = как эксперт
    post_format: str = "story"        # story = история, tips = советы, news = новость, question = пост-вопрос
    emoji_style: str = "minimal"      # none = без эмодзи, minimal = 1-2, rich = много
    cta_enabled: bool = False         # добавлять призыв к действию в конце
    cta_text: str = ""                # текст призыва (подписаться, писать в лс и т.д.)

    use_web_search: bool = True
    auto_publish: bool = False

    # Расписание
    schedule_kind: str = "interval"
    interval_hours: int = 12
    daily_times: str = '["10:00"]'

    enabled: bool = True
    last_generated_at: Optional[datetime] = None
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


def init_db():
    SQLModel.metadata.create_all(engine)


def session():
    return Session(engine)


def get_user_by_email(s: Session, email: str) -> Optional[User]:
    return s.exec(select(User).where(User.email == email)).first()


def get_user(s: Session, user_id: int) -> Optional[User]:
    return s.get(User, user_id)


def all_enabled_channels(s: Session) -> list[Channel]:
    return list(s.exec(select(Channel).where(Channel.enabled == True)).all())  # noqa: E712


def due_scheduled_posts(s: Session, now: datetime) -> list[Post]:
    return list(
        s.exec(select(Post).where(Post.status == "scheduled", Post.scheduled_at <= now)).all()
    )
