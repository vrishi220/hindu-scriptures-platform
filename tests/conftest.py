"""Pytest configuration and fixtures for the test suite."""
import os
import pytest
import getpass
from sqlalchemy import text, create_engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import sessionmaker
from services.schema_bootstrap import ensure_phase1_schema

# Set up test database URL before importing models
# In CI: TEST_DATABASE_URL is set to postgres:postgres credentials (GitHub Actions)
# Locally: Use current user's credentials (since local PostgreSQL is owned by the user)
if "TEST_DATABASE_URL" in os.environ:
    TEST_DATABASE_URL = os.environ["TEST_DATABASE_URL"]
else:
    # For local development, use current user
    current_user = getpass.getuser()
    TEST_DATABASE_URL = f"postgresql+psycopg2://{current_user}@localhost/test_scriptures"


def _is_safe_test_database_url(database_url: str) -> bool:
    lower_url = database_url.lower()

    if lower_url.startswith("sqlite"):
        if ":memory:" in lower_url:
            return True
        db_name = lower_url.rsplit("/", 1)[-1].split("?", 1)[0]
        return db_name.startswith("test")

    try:
        parsed = make_url(database_url)
    except Exception:
        return False

    db_name = (parsed.database or "").lower()
    return db_name.startswith("test")

# Safety guard: never allow tests to run against non-test databases by default.
if (
    not _is_safe_test_database_url(TEST_DATABASE_URL)
    and os.getenv("ALLOW_NON_TEST_DB_FOR_PYTEST") != "1"
):
    raise RuntimeError(
        f"Refusing to run tests against non-test database URL: {TEST_DATABASE_URL}. "
        "Set TEST_DATABASE_URL to a database whose name starts with 'test' (e.g. test_scriptures). "
        "Override only if intentional with ALLOW_NON_TEST_DB_FOR_PYTEST=1."
    )
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("EMAIL_VERIFICATION_REQUIRED", "false")

from main import app
import models.database

# CRITICAL: Recreate the database engine with the correct TEST_DATABASE_URL
# This ensures all database operations use the test database
models.database.engine.dispose()  # Close old connections
models.database.engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
models.database.SessionLocal = sessionmaker(
    bind=models.database.engine, 
    autoflush=False, 
    autocommit=False
)

from models.database import SessionLocal
from fastapi.testclient import TestClient


@pytest.fixture(scope="session", autouse=True)
def bootstrap_phase1_schema():
    """Ensure required Phase 1 schema exists for local test DB."""
    try:
        ensure_phase1_schema(TEST_DATABASE_URL)
    except Exception as e:
        print(f"Warning: Failed to bootstrap Phase 1 schema: {e}")
        # Try manually creating the tables if bootstrap fails
        try:
            from sqlalchemy import create_engine, MetaData
            from models.database import Base
            
            # Create a fresh engine with the test database URL
            test_engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
            
            # Check if tables exist
            with test_engine.connect() as conn:
                result = conn.execute(text("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='user_preferences');"))
                table_exists = result.scalar()
            
            if not table_exists:
                print("Creating schema tables manually...")
                Base.metadata.create_all(bind=test_engine)
                print("Schema tables created successfully")
            
            test_engine.dispose()
        except Exception as e2:
            print(f"Warning: Failed to create tables manually: {e2}")


@pytest.fixture
def client():
    """Create a test client for the FastAPI application."""
    return TestClient(app, raise_server_exceptions=False)



@pytest.fixture
def sample_user_data():
    """Sample user data for testing."""
    return {
        "email": "test@example.com",
        "password": "TestPassword123!",
        "full_name": "Test User"
    }


@pytest.fixture
def sample_book_data():
    """Sample book data for testing."""
    return {
        "title": "Test Scripture",
        "description": "A test scripture",
        "author": "Test Author",
        "language": "en"
    }


@pytest.fixture
def sample_node_data():
    """Sample content node data for testing."""
    return {
        "title": "Chapter 1",
        "sequence_number": "1",
        "content": "Test content",
        "node_type": "chapter"
    }
