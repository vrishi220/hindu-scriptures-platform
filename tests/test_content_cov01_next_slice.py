from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import status

import api.content as content_api
from models.book import Book
from models.content_node import ContentNode
from models.database import SessionLocal
from models.import_job import ImportJob
from models.scripture_schema import ScriptureSchema
from models.user import User
from services.media_storage import LocalMediaStorage


def _register_and_login(client):
    suffix = uuid4().hex[:8]
    email = f"cov01_{suffix}@example.com"
    password = "StrongPass123!"

    register_response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "username": f"cov01_{suffix}",
            "full_name": "COV01 User",
        },
    )
    assert register_response.status_code == status.HTTP_201_CREATED

    # Grant import permission so the user can reach the import endpoint
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.permissions = {**(user.permissions or {}), "can_import": True}
            db.commit()
    finally:
        db.close()

    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == status.HTTP_200_OK
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_schema(db, name_prefix: str = "COV01 Schema") -> ScriptureSchema:
    schema = ScriptureSchema(
        name=f"{name_prefix} {uuid4().hex[:8]}",
        description="Coverage schema",
        levels=["Chapter", "Verse"],
    )
    db.add(schema)
    db.commit()
    db.refresh(schema)
    return schema


def _create_user(db, name_prefix: str = "cov01") -> User:
    suffix = uuid4().hex[:8]
    user = User(
        email=f"{name_prefix}_{suffix}@example.com",
        username=f"{name_prefix}_{suffix}",
        password_hash="test-hash",
        full_name="COV01 User",
        role="editor",
        permissions={
            "can_view": True,
            "can_contribute": True,
            "can_import": True,
            "can_edit": True,
            "can_moderate": False,
            "can_admin": False,
        },
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestContentCoverageNextSliceCOV01:
    def test_media_bank_upload_preserves_filename_in_storage_path(self, client, tmp_path, monkeypatch):
        original_storage = content_api.MEDIA_STORAGE
        monkeypatch.setattr(content_api, "MEDIA_STORAGE", LocalMediaStorage(root_dir=tmp_path))
        try:
            headers = _register_and_login(client)

            db = SessionLocal()
            try:
                user = db.query(User).filter(User.email.isnot(None)).order_by(User.id.desc()).first()
                assert user is not None
                user.role = "admin"
                user.permissions = {
                    "can_view": True,
                    "can_contribute": True,
                    "can_edit": True,
                    "can_moderate": True,
                    "can_admin": True,
                }
                db.commit()
            finally:
                db.close()

            response = client.post(
                "/api/content/media-bank/assets",
                headers=headers,
                files={"file": ("Lotus Image 01.png", b"png-data", "image/png")},
            )

            assert response.status_code == status.HTTP_201_CREATED
            payload = response.json()
            assert payload["metadata_json"]["original_filename"] == "Lotus Image 01.png"
            assert payload["metadata_json"]["display_name"] == "Lotus Image 01.png"
            assert payload["url"].endswith("/media/bank/Lotus-Image-01.png")
            assert (tmp_path / Path("bank/Lotus-Image-01.png")).exists()

            second_response = client.post(
                "/api/content/media-bank/assets",
                headers=headers,
                files={"file": ("Lotus Image 01.png", b"png-data-2", "image/png")},
            )

            assert second_response.status_code == status.HTTP_201_CREATED
            second_payload = second_response.json()
            assert second_payload["url"].endswith("/media/bank/Lotus-Image-01-2.png")
            assert (tmp_path / Path("bank/Lotus-Image-01-2.png")).exists()
        finally:
            monkeypatch.setattr(content_api, "MEDIA_STORAGE", original_storage)

    def test_find_inflight_duplicate_import_job_ignores_stale_running_job(self):
        db = SessionLocal()
        try:
            user = _create_user(db, "cov01_stale_duplicate")
            stale_job = ImportJob(
                job_id=str(uuid4()),
                status="running",
                requested_by=user.id,
                canonical_json_url="https://example.com/canonical.json",
                canonical_book_code="cov01-stale-book",
                payload_json={
                    "schema_version": "hsp-book-json-v1",
                    "canonical_json_url": "https://example.com/canonical.json",
                },
                progress_message="Importing nodes",
                progress_current=2900,
                progress_total=29084,
                created_at=datetime.now(timezone.utc) - timedelta(minutes=10),
                updated_at=datetime.now(timezone.utc) - timedelta(minutes=10),
            )
            db.add(stale_job)
            db.commit()

            duplicate = content_api._find_inflight_duplicate_import_job(
                {
                    "schema_version": "hsp-book-json-v1",
                    "canonical_json_url": "https://example.com/canonical.json",
                },
                db,
            )

            assert duplicate is None

            db.refresh(stale_job)
            assert stale_job.status == "failed"
            assert stale_job.error is not None
            assert "Please retry the import" in stale_job.error
        finally:
            db.close()

    def test_get_import_job_status_marks_stale_job_failed(self):
        db = SessionLocal()
        try:
            user = _create_user(db, "cov01_stale_status")
            stale_job = ImportJob(
                job_id=str(uuid4()),
                status="running",
                requested_by=user.id,
                canonical_json_url="https://example.com/status.json",
                canonical_book_code="cov01-status-book",
                payload_json={
                    "schema_version": "hsp-book-json-v1",
                    "canonical_json_url": "https://example.com/status.json",
                },
                progress_message="Importing nodes",
                progress_current=2900,
                progress_total=29084,
                created_at=datetime.now(timezone.utc) - timedelta(minutes=10),
                updated_at=datetime.now(timezone.utc) - timedelta(minutes=10),
            )
            db.add(stale_job)
            db.commit()

            status_response = content_api.get_import_job_status(
                stale_job.job_id,
                db=db,
                current_user=user,
            )

            assert status_response.status == "failed"
            assert status_response.error is not None
            assert "Please retry the import" in status_response.error

            db.refresh(stale_job)
            assert stale_job.status == "failed"
        finally:
            db.close()

    def test_import_canonical_json_force_reimport_replaces_existing_nodes(self):
        db = SessionLocal()
        try:
            schema = _create_schema(db, "COV01 Canonical Replace")
            user = SimpleNamespace(id=1)

            initial_payload = {
                "schema_version": "hsp-book-json-v1",
                "schema": {
                    "id": schema.id,
                    "name": schema.name,
                    "levels": schema.levels,
                },
                "book": {
                    "book_name": "Canonical Replace Book",
                    "book_code": f"canonical-replace-{uuid4().hex[:6]}",
                    "language_primary": "sanskrit",
                },
                "nodes": [
                    {
                        "node_id": 1,
                        "level_name": "Chapter",
                        "level_order": 0,
                        "sequence_number": "1",
                        "title_english": "Chapter 1",
                        "has_content": False,
                    },
                    {
                        "node_id": 2,
                        "parent_node_id": 1,
                        "level_name": "Verse",
                        "level_order": 1,
                        "sequence_number": "1",
                        "title_english": "Verse 1",
                        "has_content": True,
                        "content_data": {"text": "Original"},
                    },
                ],
            }

            initial_result = content_api._import_canonical_json_v1(initial_payload, db, user)
            assert initial_result.success is True
            assert initial_result.book_id is not None

            replaced_payload = {
                "schema_version": "hsp-book-json-v1",
                "force_reimport": True,
                "schema": {
                    "id": schema.id,
                    "name": schema.name,
                    "levels": schema.levels,
                },
                "book": {
                    "book_name": "Canonical Replace Book",
                    "book_code": initial_payload["book"]["book_code"],
                    "language_primary": "sanskrit",
                },
                "nodes": [
                    {
                        "node_id": 1,
                        "level_name": "Chapter",
                        "level_order": 0,
                        "sequence_number": "2",
                        "title_english": "Replacement Chapter",
                        "has_content": False,
                    }
                ],
            }

            replaced_result = content_api._import_canonical_json_v1(replaced_payload, db, user)
            assert replaced_result.success is True
            assert replaced_result.book_id == initial_result.book_id
            assert replaced_result.nodes_created == 1
            assert any("Replaced 2 existing nodes" in warning for warning in replaced_result.warnings)

            nodes = (
                db.query(ContentNode)
                .filter(ContentNode.book_id == initial_result.book_id)
                .order_by(ContentNode.id.asc())
                .all()
            )
            assert len(nodes) == 1
            assert nodes[0].title_english == "Replacement Chapter"
        finally:
            db.close()

    def test_import_canonical_json_allow_existing_content_appends_nodes(self):
        db = SessionLocal()
        try:
            schema = _create_schema(db, "COV01 Canonical Append")
            user = SimpleNamespace(id=1)
            book_code = f"canonical-append-{uuid4().hex[:6]}"

            initial_payload = {
                "schema_version": "hsp-book-json-v1",
                "schema": {
                    "id": schema.id,
                    "name": schema.name,
                    "levels": schema.levels,
                },
                "book": {
                    "book_name": "Canonical Append Book",
                    "book_code": book_code,
                    "language_primary": "sanskrit",
                },
                "nodes": [
                    {
                        "node_id": 1,
                        "level_name": "Chapter",
                        "level_order": 0,
                        "sequence_number": "1",
                        "title_english": "Original Chapter",
                        "has_content": False,
                    }
                ],
            }

            initial_result = content_api._import_canonical_json_v1(initial_payload, db, user)
            assert initial_result.success is True

            append_payload = {
                "schema_version": "hsp-book-json-v1",
                "allow_existing_content": True,
                "schema": {
                    "id": schema.id,
                    "name": schema.name,
                    "levels": schema.levels,
                },
                "book": {
                    "book_name": "Canonical Append Book",
                    "book_code": book_code,
                    "language_primary": "sanskrit",
                },
                "nodes": [
                    {
                        "node_id": 10,
                        "level_name": "Chapter",
                        "level_order": 0,
                        "sequence_number": "2",
                        "title_english": "Appended Chapter",
                        "has_content": False,
                    }
                ],
            }

            append_result = content_api._import_canonical_json_v1(append_payload, db, user)
            assert append_result.success is True
            assert append_result.nodes_created == 1
            assert any("Appending imported nodes" in warning for warning in append_result.warnings)

            nodes = (
                db.query(ContentNode)
                .filter(ContentNode.book_id == initial_result.book_id)
                .order_by(ContentNode.sequence_number.asc())
                .all()
            )
            assert len(nodes) == 2
            assert [node.title_english for node in nodes] == ["Original Chapter", "Appended Chapter"]
        finally:
            db.close()

    def test_import_canonical_json_honors_book_variant_authors_registry(self):
        db = SessionLocal()
        try:
            schema = _create_schema(db, "COV01 Canonical Variant Registry")
            user = SimpleNamespace(id=1)
            book_code = f"canonical-registry-{uuid4().hex[:6]}"

            payload = {
                "schema_version": "hsp-book-json-v1",
                "schema": {
                    "id": schema.id,
                    "name": schema.name,
                    "levels": schema.levels,
                },
                "book": {
                    "book_name": "Canonical Registry Book",
                    "book_code": book_code,
                    "language_primary": "sanskrit",
                    "variant_authors": {
                        "sac": "Swami Chinmayananda",
                        "hic": "Sri Madhavacharya",
                    },
                },
                "nodes": [
                    {
                        "node_id": 1,
                        "level_name": "Chapter",
                        "level_order": 0,
                        "sequence_number": "1",
                        "title_english": "Chapter 1",
                        "has_content": False,
                    },
                    {
                        "node_id": 2,
                        "parent_node_id": 1,
                        "level_name": "Verse",
                        "level_order": 1,
                        "sequence_number": "1",
                        "title_english": "Verse 1",
                        "has_content": True,
                        "content_data": {
                            "translation_variants": [
                                {
                                    "author_slug": "sac",
                                    "author": "Swami Chinmayananda",
                                    "language": "en",
                                    "field": "et",
                                    "text": "Translation text",
                                }
                            ]
                        },
                    },
                ],
            }

            result = content_api._import_canonical_json_v1(payload, db, user)
            assert result.success is True
            assert result.book_id is not None

            book = db.query(Book).filter(Book.id == result.book_id).first()
            assert book is not None
            assert book.variant_authors == {
                "sac": "Swami Chinmayananda",
                "hic": "Sri Madhavacharya",
            }
        finally:
            db.close()

    def test_import_endpoint_unknown_type_returns_structured_failure(self, client):
        headers = _register_and_login(client)
        response = client.post(
            "/api/content/import",
            json={"import_type": "unsupported-importer"},
            headers=headers,
        )
        assert response.status_code == status.HTTP_202_ACCEPTED
        payload = response.json()
        assert payload["success"] is False
        assert "Unknown import_type" in payload["error"]

    def test_import_pdf_invalid_config_returns_validation_error(self):
        db = SessionLocal()
        try:
            result = content_api._import_pdf(
                payload={},
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert result.success is False
            assert result.error is not None
            assert "Invalid PDF config" in result.error
        finally:
            db.close()

    def test_import_pdf_missing_schema_returns_not_found_error(self):
        db = SessionLocal()
        try:
            payload = {
                "book_name": "Missing Schema PDF",
                "book_code": f"missing-schema-pdf-{uuid4().hex[:6]}",
                "schema_id": 999999,
                "pdf_file_path": "/tmp/does-not-matter.pdf",
                "extraction_rules": [],
            }
            result = content_api._import_pdf(
                payload=payload,
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert result.success is False
            assert result.error == "Schema 999999 not found"
        finally:
            db.close()

    def test_import_pdf_handles_importer_failure_path(self, monkeypatch):
        class FakePDFImporter:
            def __init__(self, config):
                self.config = config

            def import_from_pdf(self):
                return False, 0, ["parse warning"]

            def extract_chapters_and_verses(self):
                return []

        monkeypatch.setattr(content_api, "PDFImporter", FakePDFImporter)

        db = SessionLocal()
        try:
            schema = _create_schema(db, "COV01 PDF Failure")
            payload = {
                "book_name": "PDF Failure Book",
                "book_code": f"pdf-failure-{uuid4().hex[:6]}",
                "schema_id": schema.id,
                "pdf_file_path": "/tmp/fake.pdf",
                "extraction_rules": [],
            }
            result = content_api._import_pdf(
                payload=payload,
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert result.success is False
            assert result.error == "Failed to extract PDF content"
            assert "parse warning" in result.warnings
        finally:
            db.close()

    def test_import_pdf_handles_no_nodes_and_insert_exception(self, monkeypatch):
        class FakePDFImporterNoNodes:
            def __init__(self, config):
                self.config = config

            def import_from_pdf(self):
                return True, 1, []

            def extract_chapters_and_verses(self):
                return []

        class FakePDFImporterWithNodes:
            def __init__(self, config):
                self.config = config

            def import_from_pdf(self):
                return True, 1, []

            def extract_chapters_and_verses(self):
                return [{"level_name": "Chapter", "sequence_number": "1", "children": []}]

        db = SessionLocal()
        try:
            schema = _create_schema(db, "COV01 PDF No Nodes")
            payload = {
                "book_name": "PDF No Nodes Book",
                "book_code": f"pdf-no-nodes-{uuid4().hex[:6]}",
                "schema_id": schema.id,
                "pdf_file_path": "/tmp/fake.pdf",
                "extraction_rules": [],
            }

            monkeypatch.setattr(content_api, "PDFImporter", FakePDFImporterNoNodes)
            no_nodes_result = content_api._import_pdf(
                payload=payload,
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert no_nodes_result.success is False
            assert no_nodes_result.error == "Extraction produced no nodes"

            monkeypatch.setattr(content_api, "PDFImporter", FakePDFImporterWithNodes)

            def _raise_insert(*args, **kwargs):
                raise Exception("insert boom")

            monkeypatch.setattr(content_api, "_insert_content_nodes", _raise_insert)
            insert_fail_payload = {
                "book_name": "PDF Insert Fail Book",
                "book_code": f"pdf-insert-fail-{uuid4().hex[:6]}",
                "schema_id": schema.id,
                "pdf_file_path": "/tmp/fake.pdf",
                "extraction_rules": [],
            }
            insert_fail_result = content_api._import_pdf(
                payload=insert_fail_payload,
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert insert_fail_result.success is False
            assert "Failed to insert nodes" in insert_fail_result.error
        finally:
            db.close()

    def test_import_json_missing_schema_and_failure_paths(self, monkeypatch):
        class FakeJSONImporterFailure:
            def __init__(self, config):
                self.config = config

            def import_from_json(self):
                return False, 0, ["json warning"]

            def extract_structure(self):
                return []

        class FakeJSONImporterNoNodes:
            def __init__(self, config):
                self.config = config

            def import_from_json(self):
                return True, 1, []

            def extract_structure(self):
                return []

        db = SessionLocal()
        try:
            missing_schema_payload = {
                "book_name": "JSON Missing Schema",
                "book_code": f"json-missing-schema-{uuid4().hex[:6]}",
                "schema_id": 999999,
                "source_attribution": "API",
                "json_source_url": "https://example.com/data.json",
            }
            missing_schema = content_api._import_json(
                payload=missing_schema_payload,
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert missing_schema.success is False
            assert "Schema not found" in (missing_schema.error or "")

            schema = _create_schema(db, "COV01 JSON Paths")
            payload = {
                "book_name": "JSON Path Book",
                "book_code": f"json-path-{uuid4().hex[:6]}",
                "schema_id": schema.id,
                "source_attribution": "API",
                "json_source_url": "https://example.com/data.json",
            }

            monkeypatch.setattr(content_api, "JSONImporter", FakeJSONImporterFailure)
            fail_result = content_api._import_json(
                payload=payload,
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert fail_result.success is False
            assert (fail_result.error or "").startswith("Failed to import JSON content")

            monkeypatch.setattr(content_api, "JSONImporter", FakeJSONImporterNoNodes)
            no_nodes_result = content_api._import_json(
                payload={
                    "book_name": "JSON No Nodes",
                    "book_code": f"json-no-nodes-{uuid4().hex[:6]}",
                    "schema_id": schema.id,
                    "source_attribution": "API",
                    "json_source_url": "https://example.com/data.json",
                },
                db=db,
                current_user=SimpleNamespace(id=1),
            )
            assert no_nodes_result.success is False
            assert no_nodes_result.error == "Extraction produced no nodes"
        finally:
            db.close()
