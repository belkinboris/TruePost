"""
GET /api/internal/schema-diagnostics для отладки P0-бага DELETE /api/me.

Проблема: задача явно требует не гадать по локальному database.py какие
таблицы ссылаются на users/channels/posts, а посмотреть РЕАЛЬНУЮ схему
продовой Postgres БД. database.py в репозитории может не на 100% совпадать
с тем, что реально развёрнуто (миграции руками, более старые версии кода,
ручные правки схемы и т.п.) -- этот эндпоинт убирает все предположения,
обращаясь прямо к information_schema.

Подключение в main.py (рядом с internal_metrics, internal_landing_funnel):

    from internal_schema_diagnostics import router as schema_diag_router
    app.include_router(schema_diag_router)

Использует тот же токен что и остальные internal-эндпоинты:
    TRUEPOST_INTERNAL_API_TOKEN (Authorization: Bearer {token})
"""

import os

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import text

import database

router = APIRouter()

INTERNAL_API_TOKEN = os.environ.get("TRUEPOST_INTERNAL_API_TOKEN")


def _check_auth(authorization: str | None) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="TRUEPOST_INTERNAL_API_TOKEN not configured on this server")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


_PG_FK_QUERY = """
SELECT
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    tc.constraint_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY referenced_table, referencing_table;
"""

_PG_ALL_TABLES_QUERY = """
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
"""


@router.get("/api/internal/schema-diagnostics")
def schema_diagnostics(authorization: str | None = Header(default=None)):
    """
    Возвращает РЕАЛЬНУЮ схему БД: список всех таблиц и всех FK constraints,
    с акцентом на то, что ссылается на users/channels/posts. Работает только
    на Postgres (information_schema этих view нет в нужном виде на SQLite) --
    если БД это SQLite, возвращает явное предупреждение вместо молчаливо
    неверного ответа.
    """
    _check_auth(authorization)

    db_url = database.db_url
    if db_url.startswith("sqlite"):
        return {
            "warning": (
                "Эта БД -- SQLite (вероятно локальная разработка), не продовый Postgres. "
                "SQLite не enforces FK constraints по умолчанию и не даёт надёжной "
                "информации о реальной схеме -- этот эндпоинт предназначен для "
                "диагностики именно продовой Postgres БД."
            ),
            "all_tables": _sqlite_tables(),
        }

    with database.engine.connect() as conn:
        fk_rows = conn.execute(text(_PG_FK_QUERY)).fetchall()
        table_rows = conn.execute(text(_PG_ALL_TABLES_QUERY)).fetchall()

    all_tables = [r[0] for r in table_rows]

    fks = [
        {
            "referencing_table": r[0],
            "referencing_column": r[1],
            "referenced_table": r[2],
            "referenced_column": r[3],
            "constraint_name": r[4],
            "delete_rule": r[5],  # NO ACTION / CASCADE / SET NULL / RESTRICT
        }
        for r in fk_rows
    ]

    # Самое важное для отладки P0: какие таблицы реально ссылаются на
    # users/channels/posts, и не реализован ли каскад на уровне БД (в этом
    # случае delete_rule будет 'CASCADE', и наш ручной Python-код для этой
    # таблицы избыточен; если 'NO ACTION' -- именно эта таблица должна быть
    # явно очищена в delete_account() ДО удаления родительской записи).
    fks_into_core_tables = [
        fk for fk in fks
        if fk["referenced_table"] in ("user", "channel", "post", "users", "channels", "posts")
    ]

    # Таблицы из кода (database.py в этом репозитории), для сравнения с тем
    # что реально есть на проде -- если есть таблица в all_tables, которой
    # нет в этом списке, значит на проде есть что-то, чего нет в текущем коде.
    known_tables_in_code = [
        "user", "channel", "channelrule", "source", "post",
        "payment", "referral", "landingevent", "idempotencykey",
    ]
    unknown_tables = [t for t in all_tables if t.lower() not in known_tables_in_code]

    return {
        "all_tables": all_tables,
        "known_tables_in_current_code": known_tables_in_code,
        "unknown_tables_not_in_current_code": unknown_tables,
        "all_foreign_keys": fks,
        "foreign_keys_referencing_core_tables": fks_into_core_tables,
        "diagnostic_note": (
            "Если unknown_tables_not_in_current_code не пуст -- на проде есть таблицы, "
            "о которых текущий код database.py не знает. Если у такой таблицы есть "
            "запись в foreign_keys_referencing_core_tables с delete_rule='NO ACTION', "
            "это и есть вероятная причина ForeignKeyViolation при DELETE /api/me."
        ),
    }


def _sqlite_tables():
    with database.engine.connect() as conn:
        rows = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    return [r[0] for r in rows]
