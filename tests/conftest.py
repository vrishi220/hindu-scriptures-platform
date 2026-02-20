"""Pytest configuration and fixtures for the test suite."""
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from services.schema_bootstrap import ensure_phase1_schema

# Set up test database URL before importing models
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg2://localhost/test_scriptures"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from main import app
from models.database import SessionLocal


@pytest.fixture(scope="session", autouse=True)
def bootstrap_phase1_schema():
    """Ensure required Phase 1 schema exists for local test DB."""
    try:
        ensure_phase1_schema(TEST_DATABASE_URL)
    except Exception as e:
        print(f"Warning: Failed to bootstrap Phase 1 schema: {e}")
        # Try manually creating the tables if bootstrap fails
        try:
            db = SessionLocal()
            # Check if tables exist
            result = db.execute(text("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='user_preferences');"))
            if not result.scalar():
                print("Creating user_preferences table manually...")
                from sqlalchemy import MetaData
                from models.database import Base, engine
                Base.metadata.create_all(bind=engine)
            db.close()
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
        "password": "testpassword123",
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
