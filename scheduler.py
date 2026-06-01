"""
Планировщик: каждые TICK_SECONDS вызывает tasks.tick().
Состояние хранится в БД, поэтому перезапуски Railway безопасны.
"""

import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import config
import tasks

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


def start():
    scheduler.add_job(
        tasks.tick,
        trigger="interval",
        seconds=config.TICK_SECONDS,
        id="master_tick",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info(f"Планировщик запущен, тик каждые {config.TICK_SECONDS}с")


def stop():
    if scheduler.running:
        scheduler.shutdown(wait=False)
