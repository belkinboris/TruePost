"""
База данных: SQLModel поверх SQLAlchemy.
Работает и с Postgres (Railway), и с SQLite (локально) — определяется по DATABASE_URL.
"""

from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, create_engine, Session, select

import config

# Railway иногда отдаёт URL вида postgres://… — SQLAlchemy хочет postgresql://
db_url = config.DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
engine = create_engine(db_url, echo=False, connect_args=connect_args, pool_pre_ping=True)


# ── МОДЕЛИ ────────────────────────────────────────────────────

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    token_balance: int = 0          # сколько токенов осталось у пользователя
    is_admin: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Channel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str
    tg_chat: str = ""               # @username канала или числовой -100… id
    verified: bool = False          # проверено ли, что бот — админ канала

    about: str = ""                 # про что канал
    style: str = ""                 # стилистика (как писать)
    style_profile: str = ""         # авто-профиль стиля (если анализировали чужой канал)
    post_length: str = "100-200 слов"
    language: str = "русский"

    use_web_search: bool = True     # разрешить Claude искать в интернете
    auto_publish: bool = False      # публиковать сразу без ревью

    # Расписание
    schedule_kind: str = "interval"     # "interval" | "daily"
    interval_hours: int = 12            # для interval
    daily_times: str = "[\"10:00\"]"    # JSON-список "ЧЧ:ММ" для daily

    enabled: bool = True
    last_generated_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Source(SQLModel, table=True):
    """Конкретные сайты/RSS, которые ИИ обязан просматривать для канала."""
    id: Optional[int] = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id", index=True)
    url: str
    enabled: bool = True


class Post(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    text: str
    status: str = "pending"         # pending | scheduled | published | rejected
    scheduled_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    tg_message_id: Optional[int] = None

    tokens_used: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Payment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    package_id: str
    label: str = Field(index=True)  # метка, которую отдаём ЮMoney
    rub: float
    tokens: int
    status: str = "pending"         # pending | paid
    operation_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    paid_at: Optional[datetime] = None


# ── ИНИЦИАЛИЗАЦИЯ И ХЕЛПЕРЫ ───────────────────────────────────

def init_db():
    SQLModel.metadata.create_all(engine)


def session():
    return Session(engine)


def get_user_by_email(s: Session, email: str) -> Optional[User]:
    return s.exec(select(User).where(User.email == email)).first()


def get_user(s: Session, user_id: int) -> Optional[User]:
    return s.get(User, user_id)


def user_channels(s: Session, user_id: int) -> list[Channel]:
    return list(s.exec(select(Channel).where(Channel.user_id == user_id)).all())


def channel_sources(s: Session, channel_id: int) -> list[Source]:
    return list(s.exec(select(Source).where(Source.channel_id == channel_id)).all())


def all_enabled_channels(s: Session) -> list[Channel]:
    return list(s.exec(select(Channel).where(Channel.enabled == True)).all())  # noqa: E712


def due_scheduled_posts(s: Session, now: datetime) -> list[Post]:
    return list(
        s.exec(
            select(Post).where(Post.status == "scheduled", Post.scheduled_at <= now)
        ).all()
    )
