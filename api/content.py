import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from api.import_parser import ExtractionRules, GenericHTMLImporter, ImportConfig
from api.pdf_importer import PDFImporter, PDFImportConfig
from api.json_importer import JSONImporter, JSONImportConfig
from api.users import get_current_user, get_current_user_optional, require_permission
from models.book import Book
from models.content_node import ContentNode
from models.media_file import MediaFile
from models.schemas import (
    BookCreate,
    BookPublic,
    BookUpdate,
    ContentNodeCreate,
    ContentNodePublic,
    ContentNodeTree,
    ContentNodeUpdate,
    MediaFilePublic,
    ScriptureSchemaCreate,
    ScriptureSchemaPublic,
    ScriptureSchemaUpdate,
)
from models.scripture_schema import ScriptureSchema
from models.user import User
from services import get_db

router = APIRouter(prefix="/content", tags=["content"])

PUBLIC_READS_ENABLED = os.getenv("PUBLIC_READS_ENABLED", "false").lower() == "true"
MEDIA_DIR = os.getenv("MEDIA_DIR", "media")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_MEDIA_TYPES = {"audio", "video", "image"}


# Import request/response schemas
class ImportResponse(BaseModel):
    """Response from import operation."""
    success: bool
    book_id: int | None = None
    nodes_created: int = 0
    warnings: list[str] = []
    error: str | None = None


class InsertReferencesPayload(BaseModel):
    parent_node_id: int | None = None
    node_ids: list[int]


def require_view_permission(
    current_user: User | None = Depends(get_current_user_optional),
) -> User | None:
    # Schemas are public metadata - always allow viewing
    return current_user


@router.get("/schemas", response_model=list[ScriptureSchemaPublic])
def list_schemas(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ScriptureSchemaPublic]:
    _ = current_user
    schemas = db.query(ScriptureSchema).order_by(ScriptureSchema.id).all()
    return [ScriptureSchemaPublic.model_validate(item) for item in schemas]


@router.post(
    "/schemas",
    response_model=ScriptureSchemaPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_schema(
    payload: ScriptureSchemaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_contribute")),
) -> ScriptureSchemaPublic:
    _ = current_user
    schema = ScriptureSchema(
        name=payload.name,
        description=payload.description,
        levels=payload.levels,
    )
    db.add(schema)
    db.commit()
    db.refresh(schema)
    return ScriptureSchemaPublic.model_validate(schema)


@router.get("/schemas/{schema_id}", response_model=ScriptureSchemaPublic)
def get_schema(
    schema_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> ScriptureSchemaPublic:
    _ = current_user
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ScriptureSchemaPublic.model_validate(schema)


@router.patch("/schemas/{schema_id}", response_model=ScriptureSchemaPublic)
def update_schema(
    schema_id: int,
    payload: ScriptureSchemaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> ScriptureSchemaPublic:
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(schema, key, value)

    db.commit()
    db.refresh(schema)
    return ScriptureSchemaPublic.model_validate(schema)


@router.delete("/schemas/{schema_id}", response_model=dict)
def delete_schema(
    schema_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> dict:
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    db.delete(schema)
    db.commit()
    return {"message": "Deleted"}


@router.get("/books", response_model=list[BookPublic])
def list_books(
    db: Session = Depends(get_db),
) -> list[BookPublic]:
    """Public endpoint - list all books"""
    books = db.query(Book).order_by(Book.id).all()
    return [BookPublic.model_validate(item) for item in books]


@router.post("/books", response_model=BookPublic, status_code=status.HTTP_201_CREATED)
def create_book(
    payload: BookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_contribute")),
) -> BookPublic:
    _ = current_user
    book = Book(
        schema_id=payload.schema_id,
        book_name=payload.book_name,
        book_code=payload.book_code,
        language_primary=payload.language_primary,
        metadata_json=payload.metadata or {},
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return BookPublic.model_validate(book)


@router.get("/books/{book_id}", response_model=BookPublic)
def get_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> BookPublic:
    _ = current_user
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return BookPublic.model_validate(book)


@router.patch("/books/{book_id}", response_model=BookPublic)
def update_book(
    book_id: int,
    payload: BookUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> BookPublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "metadata":
            setattr(book, "metadata_json", value)
        else:
            setattr(book, key, value)

    db.commit()
    db.refresh(book)
    return BookPublic.model_validate(book)


@router.delete("/books/{book_id}", response_model=dict)
def delete_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> dict:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    db.delete(book)
    db.commit()
    return {"message": "Deleted"}


@router.get("/stats", response_model=dict)
def get_stats(
    db: Session = Depends(get_db),
) -> dict:
    """Public endpoint - no authentication required"""
    books_count = db.query(Book).count()
    # Count only leaf nodes (verses) - nodes that have content
    nodes_count = db.query(ContentNode).filter(ContentNode.has_content == True).count()
    users_count = db.query(User).count()
    return {
        "books_count": books_count,
        "nodes_count": nodes_count,
        "users_count": users_count,
    }


@router.get("/daily-verse", response_model=dict | None)
def get_daily_verse(
    mode: str = "daily",
    db: Session = Depends(get_db),
) -> dict | None:
    """
    Public endpoint - no authentication required
    mode: 'daily' for consistent daily verse (seeded by date), 'random' for truly random
    """
    try:
        from datetime import date
        
        # Get all verses with content
        verses_query = db.query(ContentNode).filter(ContentNode.has_content == True)
        
        if mode == "daily":
            # Use current date as seed for consistent daily verse
            today = date.today()
            seed = today.year * 10000 + today.month * 100 + today.day
            
            # Get total count
            total_verses = verses_query.count()
            if total_verses == 0:
                return None
            
            # Use seed to select a consistent verse for the day
            offset = seed % total_verses
            verse = verses_query.offset(offset).first()
        else:
            # Truly random verse
            verse = verses_query.order_by(func.random()).first()
        
        if not verse:
            return None
        
        book = db.query(Book).filter(Book.id == verse.book_id).first()
        
        # Extract content from content_data JSONB - handle nested structure
        content_text = ""
        sanskrit_text = ""
        transliteration_text = ""
        
        if verse.content_data and isinstance(verse.content_data, dict):
            # Try nested structure first (basic.sanskrit, translations.english, etc.)
            if "translations" in verse.content_data and isinstance(verse.content_data["translations"], dict):
                content_text = verse.content_data["translations"].get("english", "")
            
            if "basic" in verse.content_data and isinstance(verse.content_data["basic"], dict):
                basic = verse.content_data["basic"]
                if not content_text:
                    content_text = basic.get("translation", "")
                sanskrit_text = basic.get("sanskrit", "")
                transliteration_text = basic.get("transliteration", "")
            
            # Fallback to top-level fields
            if not content_text:
                content_text = (
                    verse.content_data.get("text_english") or
                    verse.content_data.get("text") or
                    verse.content_data.get("content") or
                    verse.content_data.get("english") or
                    verse.content_data.get("translation") or
                    ""
                )
        
        # Skip verses with placeholder content
        if content_text and ("placeholder" in content_text.lower() or "chapter" in content_text.lower() and "verse" in content_text.lower() and len(content_text) < 100):
            # Try to find another verse in random mode
            if mode == "random":
                # Recursively try to get another verse, with a limit
                attempts = 0
                while attempts < 10:
                    verse = verses_query.order_by(func.random()).first()
                    if verse:
                        content_text = ""
                        if verse.content_data and isinstance(verse.content_data, dict):
                            if "translations" in verse.content_data and isinstance(verse.content_data["translations"], dict):
                                content_text = verse.content_data["translations"].get("english", "")
                            if not content_text and "basic" in verse.content_data and isinstance(verse.content_data["basic"], dict):
                                basic = verse.content_data["basic"]
                                content_text = basic.get("translation", "")
                                sanskrit_text = basic.get("sanskrit", "")
                                transliteration_text = basic.get("transliteration", "")
                        
                        # Check if this verse has valid content
                        if content_text and not ("placeholder" in content_text.lower() and len(content_text) < 100):
                            book = db.query(Book).filter(Book.id == verse.book_id).first()
                            break
                    attempts += 1
        
        # If still no valid content, use sanskrit or transliteration as fallback
        if not content_text or len(content_text.strip()) < 5:
            content_text = sanskrit_text or transliteration_text or "Content not available"
        
        return {
            "id": verse.id,
            "title": verse.title_english or verse.title_transliteration or verse.title_sanskrit or f"{verse.level_name} {verse.sequence_number or verse.id}",
            "content": content_text,
            "book_name": book.book_name if book else "Scripture",
            "book_id": book.id if book else None,
            "node_id": verse.id,
        }
    except Exception as e:
        print(f"Error in get_daily_verse: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import", response_model=ImportResponse, status_code=status.HTTP_202_ACCEPTED)
def import_document(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_contribute")),
) -> ImportResponse:
    """
    Import a scripture document from HTML or PDF.
    Accepts unified import config with 'import_type' field.
    """
    try:
        import_type = payload.get("import_type", "html")
        
        if import_type == "html":
            return _import_html(payload, db, current_user)
        elif import_type == "pdf":
            return _import_pdf(payload, db, current_user)
        elif import_type == "json":
            return _import_json(payload, db, current_user)
        else:
            return ImportResponse(
                success=False,
                error=f"Unknown import_type: {import_type}"
            )
        
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            error=f"Import failed: {str(e)}"
        )


def _import_html(
    payload: dict,
    db: Session,
    current_user: User,
) -> ImportResponse:
    """Import from HTML using extraction rules."""
    config = ImportConfig(**payload)
    
    # Get schema
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema {config.schema_id} not found"
        )

    # Create or get book
    book_code = config.book_code or config.book_name.lower().replace(" ", "-")
    existing_book = db.query(Book).filter(
        Book.book_code == book_code,
        Book.schema_id == config.schema_id
    ).first()
    
    if existing_book:
        book = existing_book
        warnings = [f"Book {book_code} already exists, adding to it"]
    else:
        book = Book(
            schema_id=config.schema_id,
            book_name=config.book_name,
            book_code=book_code,
            language_primary=config.language_primary,
            metadata_json={
                "source_attribution": config.source_attribution,
                "original_source_url": config.original_source_url,
                "license_type": config.license_type,
            }
        )
        db.add(book)
        db.flush()
        warnings = []

    # Run importer
    importer = GenericHTMLImporter(config)
    if not importer.fetch_and_parse():
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            error="Failed to fetch and parse URL"
        )

    # Extract nodes
    nodes_tree = importer.build_tree()
    flat_nodes = importer.flatten_tree(nodes_tree)

    # Insert nodes
    nodes_created = _insert_content_nodes(
        nodes_tree, book, schema, config, current_user, db
    )
    db.commit()

    warnings.append(f"Created {nodes_created} nodes")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings
    )


def _import_pdf(
    payload: dict,
    db: Session,
    current_user: User,
) -> ImportResponse:
    """Import from PDF using extraction rules."""
    try:
        config = PDFImportConfig(**payload)
    except Exception as e:
        return ImportResponse(
            success=False,
            error=f"Invalid PDF config: {str(e)}"
        )
    
    # Get schema
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema {config.schema_id} not found"
        )

    # Create or get book
    book_code = config.book_code or config.book_name.lower().replace(" ", "-")
    existing_book = db.query(Book).filter(
        Book.book_code == book_code,
        Book.schema_id == config.schema_id
    ).first()
    
    if existing_book:
        book = existing_book
        warnings = [f"Book {book_code} already exists, adding to it"]
    else:
        book = Book(
            schema_id=config.schema_id,
            book_name=config.book_name,
            book_code=book_code,
            language_primary=config.language_primary,
            metadata_json={
                "source_attribution": config.source_attribution,
                "original_source_url": config.original_source_url,
            }
        )
        db.add(book)
        db.flush()
        warnings = []

    # Run importer to extract text and metadata
    importer = PDFImporter(config)
    success, node_count_from_import, pdf_warnings = importer.import_from_pdf()
    warnings.extend(pdf_warnings)
    
    if not success:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            warnings=warnings,
            error="Failed to extract PDF content"
        )

    # Extract nodes tree for database insertion
    nodes_tree = importer.extract_chapters_and_verses()
    
    if not nodes_tree:
        db.rollback()
        warnings.append("No content extracted from PDF")
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error="Extraction produced no nodes"
        )
    
    # Insert nodes into database
    try:
        nodes_created = _insert_content_nodes(
            nodes_tree, book, schema, config, current_user, db
        )
        db.commit()
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error=f"Failed to insert nodes: {str(e)}"
        )

    warnings.append(f"Created {nodes_created} nodes")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings
    )


def _import_json(
    payload: dict,
    db: Session,
    current_user: User,
) -> ImportResponse:
    """Import from JSON/API source."""
    config = JSONImportConfig(**payload)
    
    # Get schema
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema not found: {config.schema_id}"
        )
    
    # Create or get book
    book = db.query(Book).filter(Book.book_code == config.book_code).first()
    warnings = []
    
    if book:
        warnings.append(f"Book already exists: {book.book_name}")
    else:
        book = Book(
            schema_id=config.schema_id,
            book_name=config.book_name,
            book_code=config.book_code,
            language_primary=config.language_primary,
        )
        db.add(book)
        db.flush()
        warnings = []
    
    # Import using JSON importer
    importer = JSONImporter(config)
    success, node_count, import_warnings = importer.import_from_json()
    warnings.extend(import_warnings)
    
    if not success:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            warnings=warnings,
            error="Failed to import JSON content"
        )
    
    # Extract nodes tree for database insertion
    nodes_tree = importer.extract_structure()
    
    if not nodes_tree:
        db.rollback()
        warnings.append("No content extracted from JSON")
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error="Extraction produced no nodes"
        )
    
    # Insert nodes into database
    try:
        nodes_created = _insert_content_nodes(
            nodes_tree, book, schema, config, current_user, db
        )
        db.commit()
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error=f"Failed to insert nodes: {str(e)}"
        )

    warnings.append(f"Created {nodes_created} nodes")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings
    )


def _insert_content_nodes(
    nodes_tree: list,
    book: Book,
    schema: ScriptureSchema,
    config,
    current_user: User,
    db: Session,
) -> int:
    """Insert content nodes recursively into database."""
    nodes_created = 0
    level_lookup = {level: idx for idx, level in enumerate(schema.levels)}
    
    def insert_nodes(nodes: list, parent_id: int | None = None):
        nonlocal nodes_created
        for node_data in nodes:
            try:
                level_name = node_data.get("level_name", "")
                level_order = level_lookup.get(level_name, 0)
                
                content_node = ContentNode(
                    book_id=book.id,
                    parent_node_id=parent_id,
                    level_name=level_name,
                    level_order=level_order,
                    sequence_number=node_data.get("sequence_number", 1),
                    title_english=node_data.get("title_english"),
                    title_sanskrit=node_data.get("title_sanskrit"),
                    title_transliteration=node_data.get("title_transliteration"),
                    title_hindi=node_data.get("title_hindi"),
                    title_tamil=node_data.get("title_tamil"),
                    has_content=node_data.get("has_content", False),
                    content_data=node_data.get("content_data", {}),
                    source_attribution=node_data.get("source_attribution") or config.source_attribution,
                    original_source_url=node_data.get("original_source_url") or config.original_source_url,
                    tags=node_data.get("tags", []),
                    created_by=current_user.id,
                    last_modified_by=current_user.id,
                )
                db.add(content_node)
                db.flush()
                nodes_created += 1
                
                # Recursively insert children
                if node_data.get("children"):
                    insert_nodes(node_data["children"], content_node.id)
            except Exception as e:
                raise Exception(f"Error inserting {level_name}: {str(e)}")

    insert_nodes(nodes_tree)
    return nodes_created


@router.get("/nodes", response_model=list[ContentNodePublic])
def list_nodes(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
    q: str | None = None,  # Search query
    book_id: int | None = None,  # Filter by book
    limit: int = 100,
) -> list[ContentNodePublic]:
    """
    List content nodes with optional search and filtering.
    
    - q: Search query (searches in titles and content)
    - book_id: Filter by specific book
    - limit: Max results to return
    """
    _ = current_user
    query = db.query(ContentNode)
    
    # Search filter
    if q:
        search_term = f"%{q}%"
        query = query.filter(
            (ContentNode.title_english.ilike(search_term)) |
            (ContentNode.title_sanskrit.ilike(search_term)) |
            (ContentNode.title_transliteration.ilike(search_term)) |
            (ContentNode.content_data.cast(str).ilike(search_term))
        )
    
    # Book filter
    if book_id:
        query = query.filter(ContentNode.book_id == book_id)
    
    nodes = query.order_by(ContentNode.id).limit(limit).all()
    return [ContentNodePublic.model_validate(item) for item in nodes]


@router.get("/books/{book_id}/tree", response_model=list[ContentNodePublic])
def list_book_tree(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ContentNodePublic]:
    _ = current_user
    nodes = (
        db.query(ContentNode)
        .filter(ContentNode.book_id == book_id)
        .order_by(ContentNode.level_order)
        .all()
    )
    
    # Natural sort function for sequence numbers
    def natural_sort_key(node):
        seq = node.sequence_number
        if not seq:
            return (float('inf'),)
        try:
            parts = seq.split('.')
            return tuple(int(p) for p in parts)
        except (ValueError, AttributeError):
            return (float('inf'), str(seq))
    
    nodes = sorted(nodes, key=lambda n: (n.level_order, natural_sort_key(n)))
    
    return [ContentNodePublic.model_validate(item) for item in nodes]


@router.get("/books/{book_id}/tree/nested", response_model=list[ContentNodeTree])
def list_book_tree_nested(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ContentNodeTree]:
    _ = current_user
    nodes = (
        db.query(ContentNode)
        .filter(ContentNode.book_id == book_id)
        .order_by(ContentNode.level_order)
        .all()
    )
    
    # Natural sort function for sequence numbers like "1", "10", "1.34", "2.5"
    def natural_sort_key(node):
        seq = node.sequence_number
        if not seq:
            return (float('inf'),)  # Put nulls at the end
        
        # Split by dots and convert each part to integer for proper sorting
        try:
            parts = seq.split('.')
            return tuple(int(p) for p in parts)
        except (ValueError, AttributeError):
            # Fallback to string sorting if conversion fails
            return (float('inf'), str(seq))
    
    # Sort nodes by natural order within each level
    nodes = sorted(nodes, key=lambda n: (n.level_order, natural_sort_key(n)))
    
    node_map: dict[int, ContentNodeTree] = {}
    roots: list[ContentNodeTree] = []
    node_lookup = {n.id: n for n in nodes}

    for node in nodes:
        tree_node = ContentNodeTree.model_validate(node)
        tree_node.children = []
        node_map[node.id] = tree_node

    for node in nodes:
        tree_node = node_map[node.id]
        if node.parent_node_id and node.parent_node_id in node_map:
            # Check for cycles by tracing up max 100 levels
            current = node.parent_node_id
            path_set = {node.id}  # Track visited ids in this path
            cycle_detected = False
            for _ in range(100):
                if current is None:
                    break
                if current in path_set:
                    cycle_detected = True
                    break
                path_set.add(current)
                parent = node_lookup.get(current)
                current = parent.parent_node_id if parent else None
            
            # Only add child if no cycle detected
            if not cycle_detected:
                node_map[node.parent_node_id].children.append(tree_node)
            else:
                roots.append(tree_node)
        else:
            roots.append(tree_node)

    return roots


@router.post(
    "/nodes",
    response_model=ContentNodePublic,
    status_code=status.HTTP_201_CREATED,
)
def create_node(
    payload: ContentNodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_contribute")),
) -> ContentNodePublic:
    book = db.query(Book).filter(Book.id == payload.book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid book")

    # Validate hierarchy against schema if book has one
    if book.schema and book.schema.levels:
        schema_levels = book.schema.levels if isinstance(book.schema.levels, list) else []
        
        if schema_levels:
            # Check if level_name is valid in the schema
            if payload.level_name not in schema_levels:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid level '{payload.level_name}'. Valid levels: {', '.join(schema_levels)}"
                )

            # Get the index of this level in the schema
            level_index = schema_levels.index(payload.level_name)
            leaf_level = schema_levels[-1]

            # Content nodes (with content) can only be at leaf level
            if payload.has_content and payload.level_name != leaf_level:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Content items can only be placed at the '{leaf_level}' level"
                )

            # Check parent-child relationship in schema
            if payload.parent_node_id:
                parent = (
                    db.query(ContentNode)
                    .filter(ContentNode.id == payload.parent_node_id)
                    .first()
                )
                if not parent:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent"
                    )

                # Parent's child level must be next level in schema
                parent_level_index = schema_levels.index(parent.level_name) if parent.level_name in schema_levels else -1
                
                if parent_level_index >= 0:
                    expected_child_level_index = parent_level_index + 1
                    
                    # Parent cannot have children if it's at leaf level
                    if parent_level_index == len(schema_levels) - 1:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Cannot add children to '{parent.level_name}' level - it's the leaf level"
                        )
                    
                    # Child must be at the next level
                    if expected_child_level_index < len(schema_levels):
                        expected_child_level = schema_levels[expected_child_level_index]
                        if payload.level_name != expected_child_level:
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"'{payload.level_name}' cannot be a child of '{parent.level_name}'. Expected child level: '{expected_child_level}'"
                            )
            else:
                # Root level nodes must be at the first level in schema
                if level_index != 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Root level items must be at '{schema_levels[0]}' level, not '{payload.level_name}'"
                    )
    else:
        # No schema - basic parent validation only
        if payload.parent_node_id:
            parent = (
                db.query(ContentNode)
                .filter(ContentNode.id == payload.parent_node_id)
                .first()
            )
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent"
                )

    # Auto-calculate sequence number if not provided
    sequence_number = payload.sequence_number
    if sequence_number is None:
        # Find the maximum sequence number among siblings
        siblings_query = db.query(ContentNode).filter(
            ContentNode.book_id == payload.book_id,
            ContentNode.parent_node_id == payload.parent_node_id,
        )
        max_seq = db.query(func.max(ContentNode.sequence_number)).filter(
            ContentNode.book_id == payload.book_id,
            ContentNode.parent_node_id == payload.parent_node_id,
        ).scalar()
        sequence_number = (int(max_seq) if max_seq else 0) + 1

    node = ContentNode(
        book_id=payload.book_id,
        parent_node_id=payload.parent_node_id,
        referenced_node_id=payload.referenced_node_id,
        level_name=payload.level_name,
        level_order=payload.level_order,
        sequence_number=sequence_number,
        title_sanskrit=payload.title_sanskrit,
        title_transliteration=payload.title_transliteration,
        title_english=payload.title_english,
        title_hindi=payload.title_hindi,
        title_tamil=payload.title_tamil,
        has_content=payload.has_content,
        content_data=payload.content_data or {},
        summary_data=payload.summary_data or {},
        source_attribution=payload.source_attribution,
        license_type=payload.license_type,
        original_source_url=payload.original_source_url,
        tags=payload.tags or [],
        created_by=current_user.id,
        last_modified_by=current_user.id,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return ContentNodePublic.model_validate(node)


@router.get("/nodes/{node_id}", response_model=ContentNodePublic)
def get_node(
    node_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> ContentNodePublic:
    _ = current_user
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if node.referenced_node_id:
        source_node = node
        visited_ids: set[int] = set()

        while source_node.referenced_node_id:
            if source_node.id in visited_ids:
                break
            visited_ids.add(source_node.id)

            next_source = (
                db.query(ContentNode)
                .filter(ContentNode.id == source_node.referenced_node_id)
                .first()
            )
            if not next_source:
                break
            source_node = next_source

        if source_node and source_node.id != node.id:
            payload = ContentNodePublic.model_validate(node).model_dump()
            payload.update(
                {
                    "content_data": source_node.content_data,
                    "summary_data": source_node.summary_data,
                    "has_content": source_node.has_content,
                    "source_attribution": source_node.source_attribution,
                    "license_type": source_node.license_type,
                    "original_source_url": source_node.original_source_url,
                }
            )
            return ContentNodePublic.model_validate(payload)
    return ContentNodePublic.model_validate(node)


@router.patch("/nodes/{node_id}", response_model=ContentNodePublic)
def update_node(
    node_id: int,
    payload: ContentNodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> ContentNodePublic:
    from datetime import datetime
    
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    source_node = None
    if node.referenced_node_id:
        source_node = (
            db.query(ContentNode)
            .filter(ContentNode.id == node.referenced_node_id)
            .first()
        )
        if not source_node:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid referenced node",
            )

    updates = payload.model_dump(exclude_unset=True)
    edit_reason = updates.pop("edit_reason", None)  # Remove from updates dict
    
    if "parent_node_id" in updates and updates["parent_node_id"] is not None:
        parent = (
            db.query(ContentNode)
            .filter(ContentNode.id == updates["parent_node_id"])
            .first()
        )
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent"
            )

    content_keys = {
        "has_content",
        "content_data",
        "summary_data",
        "source_attribution",
        "license_type",
        "original_source_url",
        "metadata_json",
        "tags",
    }

    # Track version history for content changes
    content_changed = any(k in updates for k in content_keys)
    if content_changed:
        version_target = source_node if source_node is not None else node
        version_entry = {
            "edited_by": current_user.id,
            "edited_at": datetime.utcnow().isoformat(),
            "reason": edit_reason,
            "changes": {k: v for k, v in updates.items() if k in content_keys}
        }
        version_history = version_target.version_history or []
        version_history.append(version_entry)
        version_target.version_history = version_history

    for key, value in updates.items():
        if source_node is not None and key in content_keys:
            setattr(source_node, key, value)
        else:
            setattr(node, key, value)

    node.last_modified_by = current_user.id
    if source_node is not None:
        source_node.last_modified_by = current_user.id
    db.commit()
    db.refresh(node)
    if source_node is not None:
        db.refresh(source_node)
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": source_node.content_data,
                "summary_data": source_node.summary_data,
                "has_content": source_node.has_content,
                "source_attribution": source_node.source_attribution,
                "license_type": source_node.license_type,
                "original_source_url": source_node.original_source_url,
            }
        )
        return ContentNodePublic.model_validate(response_payload)

    return ContentNodePublic.model_validate(node)


@router.delete("/nodes/{node_id}", response_model=dict)
def delete_node(
    node_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    db.delete(node)
    db.commit()
    return {"message": "Deleted"}


@router.get("/nodes/{node_id}/media", response_model=list[MediaFilePublic])
def list_node_media(
    node_id: int,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[MediaFilePublic]:
    _ = current_user
    media = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id)
        .order_by(MediaFile.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [MediaFilePublic.model_validate(item) for item in media]


@router.post(
    "/nodes/{node_id}/media",
    response_model=MediaFilePublic,
    status_code=status.HTTP_201_CREATED,
)
def upload_node_media(
    node_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_contribute")),
) -> MediaFilePublic:
    _ = current_user
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    content_type = file.content_type or ""
    media_category = content_type.split("/")[0] if "/" in content_type else ""
    if media_category not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported media type"
        )

    suffix = Path(file.filename).suffix if file.filename else ""
    if not suffix and content_type:
        suffix = f".{content_type.split('/')[-1]}"

    target_dir = Path(MEDIA_DIR) / str(node_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{suffix}"
    target_path = target_dir / filename

    total_bytes = 0
    try:
        with open(target_path, "wb") as out_file:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if MAX_UPLOAD_BYTES and total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="File too large",
                    )
                out_file.write(chunk)
    finally:
        file.file.close()

    url = f"/media/{node_id}/{filename}"
    metadata = {
        "original_filename": file.filename,
        "content_type": content_type,
        "size_bytes": total_bytes,
    }

    media = MediaFile(
        node_id=node_id,
        media_type=media_category,
        url=url,
        metadata_json=metadata,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return MediaFilePublic.model_validate(media)


@router.delete("/nodes/{node_id}/media/{media_id}", response_model=dict)
def delete_node_media(
    node_id: int,
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> dict:
    _ = current_user
    media = (
        db.query(MediaFile)
        .filter(MediaFile.id == media_id, MediaFile.node_id == node_id)
        .first()
    )
    if not media:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    filename = Path(media.url).name
    target_path = Path(MEDIA_DIR) / str(node_id) / filename
    if target_path.exists():
        target_path.unlink()

    db.delete(media)
    db.commit()
    return {"message": "Deleted"}


@router.post("/books/{book_id}/insert-references", response_model=dict)
def insert_references(
    book_id: int,
    payload: InsertReferencesPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> dict:
    """
    Insert nodes from other books as references into the target book.
    References point to original content, so changes propagate automatically.
    """
    parent_node_id = payload.parent_node_id
    node_ids = payload.node_ids

    # Verify target book exists
    target_book = db.query(Book).filter(Book.id == book_id).first()
    if not target_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target book not found")

    # Verify parent node if specified
    if parent_node_id is not None:
        parent = db.query(ContentNode).filter(
            ContentNode.id == parent_node_id,
            ContentNode.book_id == book_id,
        ).first()
        if not parent:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent node not found")
        parent_level_order = parent.level_order
    else:
        parent_level_order = 0

    # Get schema to determine level structure
    schema = target_book.schema
    if not schema:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Book has no schema")

    created_refs = []

    for node_id in node_ids:
        # Get the source node
        source_node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
        if not source_node:
            continue

        # Calculate sequence number (max + 1)
        max_seq = (
            db.query(func.max(ContentNode.sequence_number))
            .filter(
                ContentNode.book_id == book_id,
                ContentNode.parent_node_id == parent_node_id,
            )
            .scalar()
        )
        sequence = (int(max_seq) if max_seq else 0) + 1

        # Create reference node
        ref_node = ContentNode(
            book_id=book_id,
            parent_node_id=parent_node_id,
            referenced_node_id=source_node.id,
            level_name=source_node.level_name,
            level_order=parent_level_order + 1,
            sequence_number=sequence,
            # Copy titles for display/search purposes
            title_sanskrit=source_node.title_sanskrit,
            title_transliteration=source_node.title_transliteration,
            title_english=source_node.title_english,
            title_hindi=source_node.title_hindi,
            title_tamil=source_node.title_tamil,
            has_content=False,  # References don't store content directly
            created_by=current_user.id,
            last_modified_by=current_user.id,
        )
        db.add(ref_node)
        db.flush()
        created_refs.append(ref_node.id)

    db.commit()

    return {
        "message": f"Created {len(created_refs)} reference(s)",
        "created_ids": created_refs,
    }

