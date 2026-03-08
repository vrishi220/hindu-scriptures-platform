import logging
import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from api import auth, content, search, users, preferences, compilations, collection_cart, draft_books, metadata, templates
from models.database import DATABASE_URL
from services.schema_bootstrap import ensure_phase1_schema

logger = logging.getLogger(__name__)

MEDIA_DIR = os.getenv("MEDIA_DIR", "media")
MEDIA_DIR_RESOLVED = os.path.abspath(MEDIA_DIR)
MEDIA_STORAGE_BACKEND = os.getenv("MEDIA_STORAGE_BACKEND", "local").strip().lower()
LOCAL_MEDIA_BACKENDS = {"local", "filesystem", "railway-volume"}
if MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS:
    os.makedirs(MEDIA_DIR, exist_ok=True)

app = FastAPI(title="Hindu Scriptures Platform", version="0.1.0")


@app.on_event("startup")
def bootstrap_schema() -> None:
    ensure_phase1_schema(DATABASE_URL)
    logger.info(
        "Media storage backend=%s media_dir=%s static_mount=%s",
        MEDIA_STORAGE_BACKEND,
        MEDIA_DIR_RESOLVED,
        MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS,
    )


@app.get("/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "media_storage_backend": MEDIA_STORAGE_BACKEND,
        "media_dir": MEDIA_DIR_RESOLVED,
        "media_static_mount_enabled": MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS,
    }


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

if MEDIA_STORAGE_BACKEND in LOCAL_MEDIA_BACKENDS:
    app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
