"""Drive → knowledge base sync. Runs nightly and on demand.

Change detection is metadata-only (md5 / modifiedTime), so a night with no changes costs
a few Drive API calls and zero LLM tokens. Only new or changed files are downloaded and indexed.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select, text

from app.db.models import Document, SyncRun, TokenUsage
from app.db.session import bump_kb_version, session_scope
from app.drive import client as drive
from app.ingestion.extract import SUPPORTED_TYPES, guess_mime
from app.ingestion.pipeline import ingest_document

log = logging.getLogger(__name__)

LOCK_KEY = 784_221_001  # pg advisory lock id for the sync job
LOCAL_PREFIX = "local:"  # documents imported from disk, not from Drive; sync leaves them alone


@dataclass
class Plan:
    new: list[drive.DriveFile] = field(default_factory=list)
    changed: list[drive.DriveFile] = field(default_factory=list)
    unchanged: list[drive.DriveFile] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)  # drive file ids
    unsupported: list[drive.DriveFile] = field(default_factory=list)


def supported(f: drive.DriveFile) -> bool:
    return f.mime_type in drive.EXPORTS or guess_mime(f.name, f.mime_type) in SUPPORTED_TYPES


def plan_sync(remote: list[drive.DriveFile], known: dict[str, tuple[str | None, str, bool]]) -> Plan:
    """`known` maps drive_file_id → (fingerprint, status, is_active)."""
    plan = Plan()
    remote_ids = set()
    for f in remote:
        if not supported(f):
            plan.unsupported.append(f)
            continue
        remote_ids.add(f.id)
        prev = known.get(f.id)
        if prev is None:
            plan.new.append(f)
        elif prev[0] != f.fingerprint or prev[1] != "indexed" or not prev[2]:
            plan.changed.append(f)
        else:
            plan.unchanged.append(f)
    plan.removed = [
        fid
        for fid, (_, _, active) in known.items()
        if active and fid not in remote_ids and not fid.startswith(LOCAL_PREFIX)
    ]
    return plan


def _fingerprint(doc: Document) -> str | None:
    return doc.md5 or (f"mtime:{doc.modified_time}" if doc.modified_time else None)


def is_running() -> bool:
    with session_scope() as db:
        return bool(db.scalar(select(func.count()).select_from(SyncRun).where(SyncRun.status == "running")))


def run_sync(trigger: str = "manual", progress: Callable[[dict], None] | None = None) -> dict:
    notify = progress or (lambda _e: None)
    with session_scope() as lock_db:
        got = lock_db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
        if not got:
            return {"status": "already_running"}
        try:
            return _run(trigger, notify)
        finally:
            lock_db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})


def _run(trigger: str, notify: Callable[[dict], None]) -> dict:
    started = datetime.now(timezone.utc)
    with session_scope() as db:
        # A crashed earlier run would stay "running" forever; close it.
        for stale in db.scalars(select(SyncRun).where(SyncRun.status == "running")):
            stale.status = "failed"
            stale.message = "הריצה נקטעה"
            stale.finished_at = started
        run = SyncRun(trigger=trigger, status="running", started_at=started)
        db.add(run)
        db.flush()
        run_id = run.id

    items: list[dict] = []
    counts = {"added": 0, "updated": 0, "deleted": 0, "failed": 0, "unchanged": 0}
    try:
        notify({"stage": "listing"})
        remote = drive.list_files()
        with session_scope() as db:
            known = {
                d.drive_file_id: (_fingerprint(d), d.status, d.is_active)
                for d in db.scalars(select(Document)).all()
            }
        plan = plan_sync(remote, known)
        counts["unchanged"] = len(plan.unchanged)
        todo = [(f, "added") for f in plan.new] + [(f, "updated") for f in plan.changed]
        notify({"stage": "planned", "total": len(todo), "removed": len(plan.removed)})

        for index, (f, kind) in enumerate(todo, start=1):
            notify({"stage": "indexing", "current": index, "total": len(todo), "name": f.name})
            try:
                data, mime = drive.download(f)
                with session_scope() as db:
                    doc = db.scalar(select(Document).where(Document.drive_file_id == f.id))
                    if doc is None:
                        doc = Document(drive_file_id=f.id, name=f.name)
                        db.add(doc)
                    doc.name, doc.mime_type, doc.drive_path = f.name, mime, f.path
                    doc.web_view_link, doc.modified_time, doc.size_bytes = f.web_view_link, f.modified_time, f.size
                    db.flush()
                    report = ingest_document(db, doc, data)
                    doc.md5 = f.md5
                counts[kind] += 1
                items.append({"name": f.name, "action": kind, **report})
            except Exception as exc:  # one bad file must not stop the run
                log.exception("failed to index %s", f.name)
                counts["failed"] += 1
                items.append({"name": f.name, "action": "failed", "error": str(exc)[:300]})
                with session_scope() as db:
                    doc = db.scalar(select(Document).where(Document.drive_file_id == f.id))
                    if doc is None:
                        doc = Document(drive_file_id=f.id, name=f.name, mime_type=f.mime_type, drive_path=f.path)
                        db.add(doc)
                    doc.status, doc.error = "failed", str(exc)[:1000]
                    doc.web_view_link, doc.modified_time = f.web_view_link, f.modified_time

        if plan.removed:
            with session_scope() as db:
                for doc in db.scalars(select(Document).where(Document.drive_file_id.in_(plan.removed))):
                    doc.is_active = False
                    doc.status = "deleted"
                    items.append({"name": doc.name, "action": "deleted"})
                    counts["deleted"] += 1

        with session_scope() as db:
            if counts["added"] or counts["updated"] or counts["deleted"]:
                bump_kb_version(db)
            tokens, cost = db.execute(
                select(
                    func.coalesce(func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens), 0),
                    func.coalesce(func.sum(TokenUsage.cost_usd), 0.0),
                ).where(TokenUsage.created_at >= started)
            ).one()
            run = db.get(SyncRun, run_id)
            run.status = "partial" if counts["failed"] else "success"
            run.finished_at = datetime.now(timezone.utc)
            run.total_files = len(remote)
            run.items = items[-500:]
            run.tokens, run.cost_usd = int(tokens), float(cost)
            for k, v in counts.items():
                setattr(run, k, v)
            if plan.unsupported:
                run.message = f"{len(plan.unsupported)} קבצים בפורמט שלא נתמך דולגו"
        notify({"stage": "done", **counts})
        return {"status": "success", "run_id": run_id, **counts}
    except Exception as exc:
        log.exception("sync failed")
        with session_scope() as db:
            run = db.get(SyncRun, run_id)
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.message = str(exc)[:1000]
            run.items = items
            for k, v in counts.items():
                setattr(run, k, v)
        notify({"stage": "error", "message": str(exc)})
        return {"status": "failed", "run_id": run_id, "error": str(exc)}
