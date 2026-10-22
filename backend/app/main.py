from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings

settings = get_settings()
logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    from app.db.session import init_db

    init_db()
    scheduler = None
    if settings.enable_scheduler:
        from apscheduler.schedulers.background import BackgroundScheduler

        from app.services.sync import run_sync

        scheduler = BackgroundScheduler(timezone=settings.timezone)
        scheduler.add_job(lambda: run_sync("nightly"), "cron", hour=settings.sync_cron_hour, minute=0)
        scheduler.start()
        log.info("nightly sync scheduled at %02d:00 %s", settings.sync_cron_hour, settings.timezone)
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="MITVE Contracts", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
