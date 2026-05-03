import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from api import auth, content, search, users, preferences, compilations, collection_cart, draft_books, metadata, templates, email, ai_jobs, ai_generation
from models.database import DATABASE_URL
from services.schema_bootstrap import ensure_phase1_schema

logger = logging.getLogger(__name__)

MEDIA_DIR = os.getenv("MEDIA_DIR", "media")
MEDIA_DIR_RESOLVED = os.path.abspath(MEDIA_DIR)
MEDIA_STORAGE_BACKEND = os.getenv("MEDIA_STORAGE_BACKEND", "local").strip().lower()
LOCAL_MEDIA_BACKENDS = {"local", "filesystem", "railway-volume"}
APP_BASE_URL = os.getenv("APP_BASE_URL", "https://scriptle.org")


def _validate_media_storage_config() -> None:
    if MEDIA_STORAGE_BACKEND == "railway-volume":
        media_path = Path(MEDIA_DIR)
        if not media_path.is_absolute():
            raise RuntimeError(
                "Invalid media storage config: MEDIA_STORAGE_BACKEND=railway-volume requires "
                f"an absolute MEDIA_DIR path (current value: {MEDIA_DIR!r})"
            )
        if not str(media_path).startswith("/data"):
            logger.warning(
                "Railway volume backend is enabled but MEDIA_DIR does not start with /data: %s",
                MEDIA_DIR,
            )


def _media_storage_runtime_state() -> dict:
    media_path = Path(MEDIA_DIR_RESOLVED)
    exists = media_path.exists()
    is_dir = media_path.is_dir()
    is_absolute = media_path.is_absolute()
    writable = os.access(media_path, os.W_OK) if exists else False

    return {
        "media_storage_backend": MEDIA_STORAGE_BACKEND,
        "media_dir": MEDIA_DIR_RESOLVED,
        "media_dir_exists": exists,
        "media_dir_is_directory": is_dir,
        "media_dir_is_absolute": is_absolute,
        "media_dir_writable": writable,
        "media_static_mount_enabled": MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS,
    }


_validate_media_storage_config()
if MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS:
    os.makedirs(MEDIA_DIR, exist_ok=True)

app = FastAPI(title="Hindu Scriptures Platform", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)


class NoCacheMediaMiddleware(BaseHTTPMiddleware):
    """Force browsers to revalidate media files on every request.

    StaticFiles does not set Cache-Control, so browsers use heuristic caching
    and may serve stale bytes after a file is replaced. Setting no-cache here
    means browsers always revalidate with ETag/Last-Modified, getting 304 for
    unchanged files and 200 for replaced ones.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/media/"):
            response.headers["Cache-Control"] = "no-cache"
        return response


app.add_middleware(NoCacheMediaMiddleware)


@app.on_event("startup")
def bootstrap_schema() -> None:
    ensure_phase1_schema(DATABASE_URL)
    media_state = _media_storage_runtime_state()
    logger.info(
        "Media storage config backend=%s media_dir=%s exists=%s is_dir=%s writable=%s static_mount=%s",
        media_state["media_storage_backend"],
        media_state["media_dir"],
        media_state["media_dir_exists"],
        media_state["media_dir_is_directory"],
        media_state["media_dir_writable"],
        media_state["media_static_mount_enabled"],
    )


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", **_media_storage_runtime_state()}


app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(content.router, prefix="/api")
app.include_router(preferences.router, prefix="/api")
app.include_router(compilations.router, prefix="/api")
app.include_router(collection_cart.router, prefix="/api")
app.include_router(draft_books.router, prefix="/api")
app.include_router(metadata.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(email.router, prefix="/api")
app.include_router(ai_jobs.router, prefix="/api")
app.include_router(ai_generation.router, prefix="/api")

if MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS:
    app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
