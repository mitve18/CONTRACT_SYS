"""Read-only Google Drive access with a service account."""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from functools import lru_cache

from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

log = logging.getLogger(__name__)

FOLDER = "application/vnd.google-apps.folder"
GOOGLE_DOC = "application/vnd.google-apps.document"
EXPORTS = {GOOGLE_DOC: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
FIELDS = "nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime, size, webViewLink, trashed)"


@dataclass
class DriveFile:
    id: str
    name: str
    mime_type: str
    path: str
    md5: str | None
    modified_time: str | None
    size: int | None
    web_view_link: str | None

    @property
    def fingerprint(self) -> str:
        """md5 for binary files; Google Docs have no md5, so modifiedTime stands in."""
        return self.md5 or f"mtime:{self.modified_time}"


class DriveNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    info = get_settings().service_account_info()
    if not info:
        raise DriveNotConfigured("לא הוגדר Service Account ל-Google Drive.")
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def service_account_email() -> str | None:
    info = get_settings().service_account_info()
    return (info or {}).get("client_email")


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=1, max=15), reraise=True)
def _list(q: str, page_token: str | None) -> dict:
    return (
        _service()
        .files()
        .list(
            q=q,
            fields=FIELDS,
            pageSize=1000,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )


def _children(folder_id: str) -> list[dict]:
    items, token = [], None
    while True:
        resp = _list(f"'{folder_id}' in parents and trashed = false", token)
        items.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            return items


def resolve_folder_path(path: str) -> str:
    """Find a folder id by a path like 'MITVE TOOLS/NECHASIM/CONTRACTS' among folders shared with the account."""
    parts = [p.strip() for p in path.split("/") if p.strip()]
    if not parts:
        raise ValueError("נתיב תיקייה ריק")

    def esc(v: str) -> str:
        return v.replace("\\", "\\\\").replace("'", "\\'")

    # The last segment is usually the folder that was shared with the service account.
    for start in range(len(parts)):
        name = parts[start]
        resp = _list(f"name = '{esc(name)}' and mimeType = '{FOLDER}' and trashed = false", None)
        for candidate in resp.get("files", []):
            current, ok = candidate["id"], True
            for child_name in parts[start + 1 :]:
                match = next(
                    (c for c in _children(current) if c["mimeType"] == FOLDER and c["name"] == child_name), None
                )
                if match is None:
                    ok = False
                    break
                current = match["id"]
            if ok:
                return current
    raise FileNotFoundError(f"התיקייה '{path}' לא נמצאה. ודאו שהיא משותפת עם {service_account_email()}")


@lru_cache(maxsize=1)
def root_folder_id() -> str:
    s = get_settings()
    if s.google_drive_folder_id and s.google_drive_folder_id not in ("demo-folder", "changeme"):
        return s.google_drive_folder_id
    return resolve_folder_path(s.google_drive_folder_path)


def list_files(folder_id: str | None = None) -> list[DriveFile]:
    """All files under the folder, recursively. Metadata only, no downloads."""
    root = folder_id or root_folder_id()
    out: list[DriveFile] = []
    stack: list[tuple[str, str]] = [(root, "")]
    seen: set[str] = set()
    while stack:
        fid, prefix = stack.pop()
        if fid in seen:
            continue
        seen.add(fid)
        for f in _children(fid):
            if f.get("trashed"):
                continue
            path = f"{prefix}/{f['name']}" if prefix else f["name"]
            if f["mimeType"] == FOLDER:
                stack.append((f["id"], path))
                continue
            out.append(
                DriveFile(
                    id=f["id"],
                    name=f["name"],
                    mime_type=f["mimeType"],
                    path=path,
                    md5=f.get("md5Checksum"),
                    modified_time=f.get("modifiedTime"),
                    size=int(f["size"]) if f.get("size") else None,
                    web_view_link=f.get("webViewLink"),
                )
            )
    return out


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=1, max=15), reraise=True)
def download(file: DriveFile) -> tuple[bytes, str]:
    """Returns (bytes, effective mime type). Google Docs are exported to .docx."""
    from googleapiclient.http import MediaIoBaseDownload

    svc = _service()
    if file.mime_type in EXPORTS:
        mime = EXPORTS[file.mime_type]
        request = svc.files().export_media(fileId=file.id, mimeType=mime)
    elif file.mime_type.startswith("application/vnd.google-apps"):
        raise ValueError(f"סוג קובץ Google לא נתמך: {file.mime_type}")
    else:
        mime = file.mime_type
        request = svc.files().get_media(fileId=file.id, supportsAllDrives=True)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request, chunksize=8 * 1024 * 1024)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), mime
