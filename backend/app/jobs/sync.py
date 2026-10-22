"""Nightly sync entry point: `python -m app.jobs.sync` (used by the Render Cron Job)."""

from __future__ import annotations

import json
import logging
import sys

from app.db.session import init_db
from app.services.sync import run_sync


def main() -> int:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    init_db()
    trigger = sys.argv[1] if len(sys.argv) > 1 else "nightly"
    result = run_sync(trigger, progress=lambda e: logging.info("sync: %s", e))
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") in ("success", "already_running") else 1


if __name__ == "__main__":
    raise SystemExit(main())
