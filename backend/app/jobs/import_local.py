"""Import contracts from a local folder: `python -m app.jobs.import_local <folder>`.

Useful for testing before Drive is connected. Imported documents get a `local:` id,
so the Drive sync never marks them as deleted.
"""

from __future__ import annotations

import hashlib
import logging
import sys
from pathlib import Path

from sqlalchemy import select

from app.db.models import Document
from app.db.session import bump_kb_version, init_db, session_scope
from app.ingestion.extract import SUPPORTED_TYPES, guess_mime
from app.ingestion.pipeline import ingest_document
from app.services.sync import LOCAL_PREFIX


def import_folder(folder: Path) -> list[dict]:
    results = []
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        mime = guess_mime(path.name, None)
        if mime not in SUPPORTED_TYPES:
            continue
        data = path.read_bytes()
        file_id = LOCAL_PREFIX + hashlib.sha1(str(path.relative_to(folder)).encode()).hexdigest()[:24]
        md5 = hashlib.md5(data).hexdigest()
        with session_scope() as db:
            doc = db.scalar(select(Document).where(Document.drive_file_id == file_id))
            if doc is None:
                doc = Document(drive_file_id=file_id, name=path.name)
                db.add(doc)
            if doc.md5 == md5 and doc.status == "indexed":
                results.append({"name": path.name, "action": "unchanged"})
                continue
            doc.name, doc.mime_type, doc.drive_path = path.name, mime, str(path.relative_to(folder))
            db.flush()
            report = ingest_document(db, doc, data)
            doc.md5 = md5
            bump_kb_version(db)
        results.append({"name": path.name, "action": "indexed", **report})
        logging.info("indexed %s: %s", path.name, report)
    return results


def main() -> int:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
    if len(sys.argv) < 2:
        print("usage: python -m app.jobs.import_local <folder>")
        return 2
    init_db()
    for r in import_folder(Path(sys.argv[1])):
        print(r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
