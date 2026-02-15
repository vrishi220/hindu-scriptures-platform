import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from api import auth, content, search, users

MEDIA_DIR = os.getenv("MEDIA_DIR", "media")
os.makedirs(MEDIA_DIR, exist_ok=True)

app = FastAPI(title="Hindu Scriptures Platform", version="0.1.0")


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(content.router, prefix="/api")

app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
