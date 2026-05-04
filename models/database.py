import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://localhost/scriptures_db",
)


class Base(DeclarativeBase):
    pass


# pool_size: connections per worker; max_overflow allows burst headroom.
# With 4 uvicorn workers + background import threads, 5 per worker is sufficient.
_DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))
_DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "10"))

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=_DB_POOL_SIZE,
    max_overflow=_DB_MAX_OVERFLOW,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
