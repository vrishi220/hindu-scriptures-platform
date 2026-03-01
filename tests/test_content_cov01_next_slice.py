from types import SimpleNamespace
from uuid import uuid4

from fastapi import status

import api.content as content_api
from models.database import SessionLocal
from models.scripture_schema import ScriptureSchema


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


class TestContentCoverageNextSliceCOV01:
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
            assert fail_result.error == "Failed to import JSON content"

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
