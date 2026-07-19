"""
Временный диагностический эндпоинт: проверяет реальную сетевую связь
процесса приложения с api.telegram.org -- в отличие от Консоли Timeweb
(судя по всему, отдельное окружение с иным DNS/сетевым путём), это
измерение из ТОГО ЖЕ процесса, что делает verify_channel и поллинг.

Удалить после диагностики (router и импорт в main.py).
"""
import time
import httpx
from fastapi import APIRouter, Header, HTTPException
import os

router = APIRouter()
INTERNAL_API_TOKEN = os.environ.get("TRUEPOST_INTERNAL_API_TOKEN")


@router.get("/api/internal/telegram-ping")
async def telegram_ping(authorization: str | None = Header(default=None)):
    if not INTERNAL_API_TOKEN or not authorization or authorization[7:] != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="invalid internal token")

    results = []
    for i in range(5):
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get("https://api.telegram.org")
            results.append({"attempt": i + 1, "status": r.status_code, "elapsed_s": round(time.monotonic() - t0, 2)})
        except httpx.HTTPError as e:
            results.append({"attempt": i + 1, "error": type(e).__name__, "elapsed_s": round(time.monotonic() - t0, 2)})
    return {"results": results}
