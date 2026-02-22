import json
from pathlib import Path

from api.import_parser import (
    ExtractionRules,
    FieldMapping,
    GenericHTMLImporter,
    ImportConfig,
    LevelRule,
)
from api.json_importer import JSONImportConfig, JSONImporter
from api.pdf_importer import PDFImportConfig, PDFImportResponse, PDFExtractionRule, PDFImporter


class _FakeResponse:
    def __init__(self, content: bytes = b"", json_data=None, status_code: int = 200, headers=None):
        self.content = content
        self._json_data = json_data
        self.status_code = status_code
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP error")

    def json(self):
        return self._json_data


def _build_html_importer(html: str) -> GenericHTMLImporter:
    config = ImportConfig(
        book_name="Importer Test",
        schema_id=1,
        extraction_rules=ExtractionRules(
            url="https://example.com/source",
            hierarchy=[
                LevelRule(
                    level_name="Chapter",
                    selector=".chapter",
                    sequence_number=".seq",
                    fields={"title_english": ".title"},
                    has_content=False,
                    children=[
                        LevelRule(
                            level_name="Verse",
                            selector=".verse",
                            sequence_number=".vseq",
                            fields={"title_transliteration": ".vtitle"},
                            has_content=True,
                            content_mapping={"basic.text": ".text"},
                        )
                    ],
                )
            ],
        ),
    )
    importer = GenericHTMLImporter(config)
    from bs4 import BeautifulSoup

    importer.soup = BeautifulSoup(html, "html.parser")
    return importer


def test_import_parser_extract_value_and_content_mapping():
    html = """
    <div class='chapter'>
      <span class='seq'>Chapter 1</span>
      <h2 class='title'>Arjuna Vishada</h2>
      <a class='ref' href='https://example.com/ref'>Ref</a>
      <p class='verse'>
        <span class='vseq'>1</span>
        <span class='vtitle'>1.1</span>
        <span class='text'>Dharmakshetre...</span>
      </p>
    </div>
    """
    importer = _build_html_importer(html)
    chapter = importer.soup.select_one(".chapter")

    assert chapter is not None
    assert importer.extract_value(chapter, ".title") == "Arjuna Vishada"

    mapping = FieldMapping(selector=".ref", attribute="href")
    assert importer.extract_value(chapter, mapping) == "https://example.com/ref"

    content = importer.build_content_data(chapter, {"basic.title": ".title"})
    assert content == {"basic": {"title": "Arjuna Vishada"}}


def test_import_parser_build_tree_and_flatten_tree():
    html = """
    <div class='chapter'>
      <span class='seq'>1</span>
      <h2 class='title'>Chapter One</h2>
      <div class='verse'>
        <span class='vseq'>1</span>
        <span class='vtitle'>Verse 1</span>
        <span class='text'>Text 1</span>
      </div>
      <div class='verse'>
        <span class='vseq'>2</span>
        <span class='vtitle'>Verse 2</span>
        <span class='text'>Text 2</span>
      </div>
    </div>
    """
    importer = _build_html_importer(html)
    tree = importer.build_tree()
    assert len(tree) == 1
    assert tree[0]["level_name"] == "Chapter"
    assert len(tree[0]["children"]) == 2
    assert tree[0]["children"][0]["content_data"]["basic"]["text"] == "Text 1"

    flat = importer.flatten_tree(tree)
    assert len(flat) == 3
    assert all("children" not in node for node in flat)


def test_import_parser_fetch_and_parse_failure(monkeypatch):
    config = ImportConfig(
        book_name="Importer Test",
        schema_id=1,
        extraction_rules=ExtractionRules(
            url="https://bad.example.com",
            hierarchy=[LevelRule(level_name="Chapter", selector=".chapter")],
        ),
    )
    importer = GenericHTMLImporter(config)

    def _raise(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr("requests.get", _raise)
    assert importer.fetch_and_parse() is False


def test_json_importer_fetch_data_api_success(monkeypatch):
    config = JSONImportConfig(
        book_name="JSON Book",
        book_code="json-book",
        schema_id=1,
        source_attribution="API Source",
        json_source_url="https://example.com/data.json",
    )
    importer = JSONImporter(config)

    payload = [{"chapter": 1, "verses": [{"verse": 1, "slok": "text"}]}]

    def _fake_get(*args, **kwargs):
        return _FakeResponse(json_data=payload)

    monkeypatch.setattr("requests.get", _fake_get)
    assert importer.fetch_data() is True
    assert importer.data == payload


def test_json_importer_fetch_data_file_and_extract_structure(tmp_path: Path):
    source_file = tmp_path / "source.json"
    source_file.write_text(
        json.dumps({"chapters": [{"chapter": 1, "verses": [{"verse": 1, "slok": "x"}]}]}),
        encoding="utf-8",
    )

    config = JSONImportConfig(
        book_name="JSON File Book",
        book_code="json-file-book",
        schema_id=1,
        source_attribution="File Source",
        json_source_url=str(source_file),
        json_source_type="file",
    )
    importer = JSONImporter(config)
    assert importer.fetch_data() is True

    structure = importer.extract_structure()
    assert len(structure) == 1
    assert structure[0]["level_name"] == "Adhyaya"
    assert len(structure[0]["children"]) == 1


def test_json_importer_extract_structure_with_numeric_dict_keys():
    config = JSONImportConfig(
        book_name="JSON Dict Book",
        book_code="json-dict-book",
        schema_id=1,
        source_attribution="Dict Source",
        json_source_url="unused",
    )
    importer = JSONImporter(config)
    importer.data = {
        "1": {"name": "Ch1", "verses": [{"verse": 1, "slok": "a"}]},
        "2": {"name": "Ch2", "verses": [{"verse": 1, "slok": "b"}]},
    }

    structure = importer.extract_structure()
    assert [item["sequence_number"] for item in structure] == ["1", "2"]


def test_json_importer_import_from_json_failure_paths(monkeypatch):
    config = JSONImportConfig(
        book_name="JSON Fail Book",
        book_code="json-fail-book",
        schema_id=1,
        source_attribution="Fail Source",
        json_source_url="https://example.com/fail.json",
    )
    importer = JSONImporter(config)

    def _raise(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("requests.get", _raise)
    success, node_count, warnings = importer.import_from_json()
    assert success is False
    assert node_count == 0
    assert warnings


def test_json_importer_process_verse_none_when_missing_verse_key():
    config = JSONImportConfig(
        book_name="JSON Verse Book",
        book_code="json-verse-book",
        schema_id=1,
        source_attribution="Verse Source",
        json_source_url="unused",
    )
    importer = JSONImporter(config)
    assert importer._process_verse({"slok": "missing number"}, chapter_num=1) is None


def test_pdf_importer_fetch_and_extract_plain_text_file(tmp_path: Path):
    text_file = tmp_path / "input.txt"
    text_file.write_text("॥1-1॥\n॥1-2॥\n" + "x" * 120, encoding="utf-8")

    config = PDFImportConfig(
        book_name="PDF Text Book",
        book_code="pdf-text-book",
        schema_id=1,
        pdf_file_path=str(text_file),
        extraction_rules=[PDFExtractionRule(level_name="Shloka")],
    )
    importer = PDFImporter(config)

    assert importer.fetch_and_extract() is True
    assert importer.text_content is not None
    assert importer.pages


def test_pdf_importer_extract_and_flatten_tree():
    config = PDFImportConfig(
        book_name="PDF Tree Book",
        book_code="pdf-tree-book",
        schema_id=1,
        pdf_file_path="unused.txt",
        extraction_rules=[PDFExtractionRule(level_name="Shloka")],
    )
    importer = PDFImporter(config)
    importer.text_content = "॥1-1॥ some text ॥1-2॥ next ॥2-1॥ more"

    tree = importer.extract_chapters_and_verses()
    assert len(tree) >= 2
    assert tree[0]["level_name"] == "Adhyaya"

    flat = importer.flatten_tree(tree)
    assert flat
    assert all("parent_id" in item for item in flat)


def test_pdf_importer_import_from_pdf_and_failure(monkeypatch):
    config = PDFImportConfig(
        book_name="PDF Import Book",
        book_code="pdf-import-book",
        schema_id=1,
        pdf_file_path="unused.txt",
        extraction_rules=[PDFExtractionRule(level_name="Shloka")],
    )
    importer = PDFImporter(config)

    monkeypatch.setattr(importer, "fetch_and_extract", lambda: False)
    success, node_count, warnings = importer.import_from_pdf()
    assert success is False
    assert node_count == 0
    assert isinstance(warnings, list)


# Sanity construction test for response model coverage

def test_pdf_import_response_model_defaults():
    response = PDFImportResponse(success=True, nodes_created=3)
    assert response.success is True
    assert response.nodes_created == 3
    assert response.warnings == []
