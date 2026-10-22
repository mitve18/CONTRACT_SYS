from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.models import AppState, Base

engine = create_engine(get_settings().sqlalchemy_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    """Create the pgvector extension and all tables. Safe to run on every start."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    with session_scope() as session:
        yield session


# Knowledge-base version. It goes up whenever indexed content changes,
# which invalidates cached answers without scanning the cache table.
KB_VERSION_KEY = "kb_version"


def get_kb_version(session: Session) -> int:
    row = session.scalar(select(AppState).where(AppState.key == KB_VERSION_KEY))
    return int(row.value) if row else 0


def bump_kb_version(session: Session) -> int:
    row = session.scalar(select(AppState).where(AppState.key == KB_VERSION_KEY))
    if row is None:
        row = AppState(key=KB_VERSION_KEY, value="1")
        session.add(row)
    else:
        row.value = str(int(row.value) + 1)
    session.flush()
    return int(row.value)
