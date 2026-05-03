# Scriptle.org — AI Integration Roadmap
**Version:** 1.0  
**Date:** May 2, 2026  
**Based on:** architecture.md v1.0  
**Goal:** Extend Scriptle.org with AI capabilities without breaking existing features

---

## Table of Contents

1. [Architecture Assessment](#1-architecture-assessment)
2. [Issues to Fix Before AI Work Begins](#2-issues-to-fix-before-ai-work-begins)
3. [AI Integration Overview](#3-ai-integration-overview)
4. [Phase 1 — AI Content Generation](#4-phase-1--ai-content-generation)
5. [Phase 2 — Semantic Search & RAG](#5-phase-2--semantic-search--rag)
6. [Phase 3 — AI Research Assistant](#6-phase-3--ai-research-assistant)
7. [Phase 4 — MCP Server](#7-phase-4--mcp-server)
8. [Phase 5 — Advanced AI Features](#8-phase-5--advanced-ai-features)
9. [Data Model Extensions](#9-data-model-extensions)
10. [Cost Estimates](#10-cost-estimates)
11. [Technology Additions](#11-technology-additions)
12. [Learning Map — AI Concepts](#12-learning-map--ai-concepts)

---

## 1. Architecture Assessment

### What is Already Excellent

Your existing architecture is well-suited for AI integration. Here is what already works in your favor:

**Content model is AI-ready.**  
`content_data` JSONB with `translations`, `translation_variants`, `commentary_variants`, and `word_meanings` maps directly to what AI generates. No schema restructuring needed for basic AI output — just fill in the missing fields.

**Commentary registry is perfect.**  
`commentary_authors` → `commentary_works` → `commentary_entries` is exactly the right structure to register "HSP AI" as a commentary author and attach AI-generated commentary entries to any node. This is already built.

**Search infrastructure is partially there.**  
You have `TSVECTOR` GIN indexes on Sanskrit, transliteration, and English translation. This is keyword search. We will extend this with vector/semantic search (pgvector) for the RAG pipeline.

**Import/export JSON pipeline works.**  
You already demonstrated this with the Avadhuta Gita export. The `generate_content.py` script we built fills in JSONB fields and re-imports. No changes needed to the import system.

**Provenance tracking is built-in.**  
`provenance_records` already tracks source, license, and `inserted_by`. AI-generated content will use this same table with `inserted_by = "ai_pipeline"` and `license_type = "AI-GENERATED"`.

**Template system handles AI output naturally.**  
Liquid templates already render `content_data.translations`, `commentary_variants`, etc. When AI fills these fields, the templates render them automatically — no template changes needed for basic display.

**Multi-language architecture is correct.**  
`content_data.translations` is a JSONB map of `language_code → text`. AI generates into this map. User preferences already control which language is displayed.

---

### What Needs to Be Added

| Capability | What to Add |
|---|---|
| AI content generation | `generate_content.py` pipeline + `ai_jobs` table |
| Semantic search | pgvector extension + `node_embeddings` table |
| RAG query engine | `api/ai_search.py` FastAPI router |
| AI chat interface | `/ask` frontend page + streaming API |
| MCP server | Separate `mcp_server/` service |
| Research synthesis | AI-assisted draft book generation from search results |

---

## 2. Issues to Fix Before AI Work Begins

These are existing inconsistencies from `architecture.md §9` that should be resolved before building on top of them.

### 2.1 Viewer Permission Conflict (CRITICAL — Fix First)

**Problem:**  
`api/auth.py` grants `can_contribute: true` to all new Viewer-role users. The frontend admin panel sets it to `false`. This means viewers can currently create books in the backend even though the UI doesn't show this.

**Why it matters for AI:**  
AI-generated content and research projects will rely on the contribution workflow. If viewer permissions are ambiguous, AI features will behave inconsistently across roles.

**Fix:**  
Decide the canonical policy. Recommended: Viewers are read-only. Contributors and above can create books.

```python
# api/auth.py — DEFAULT_PERMISSIONS
# Change:
"can_contribute": True   # currently set for viewers
# To:
"can_contribute": False  # viewers are read-only
```

Also align `api/users.py` viewer role map and `web/src/app/admin/page.tsx` role template to match.

---

### 2.2 Moderator Role Not Wired (Fix Before Review Workflow)

**Problem:**  
`can_moderate: true` is set in the moderator role but no backend routes check it. Moderators behave identically to editors.

**Why it matters for AI:**  
The peer review/approval workflow for AI-generated content requires a distinct moderator/approver permission gate.

**Fix:**  
Define moderator actions: review AI-generated content, approve/reject AI commentary entries, publish user research projects.

```python
# Example: gate AI content approval on can_moderate
@router.post("/ai/commentary/{entry_id}/approve")
async def approve_ai_commentary(
    entry_id: int,
    user = Depends(require_permission("can_moderate"))
):
    ...
```

---

### 2.3 Monolithic `scriptures/page.tsx` (Refactor Before AI UI)

**Problem:**  
`web/src/app/scriptures/page.tsx` is 17,500 lines. Adding AI translation tabs, commentary display, and generation controls to this file will make it unmanageable.

**Fix (from your REFACTOR_ROADMAP):**  
Decompose before adding AI UI components. Minimum viable decomposition for AI work:

```
scriptures/page.tsx (slim coordinator)
  ├── components/ScripturesBrowse.tsx
  ├── components/ScripturesContent.tsx   ← AI translations live here
  ├── components/ScripturesCommentary.tsx ← AI commentary lives here
  └── hooks/useScripturesData.ts
```

---

### 2.4 `user_collections` Legacy Table (Cleanup)

**Problem:**  
`user_collections` and `collection_items` are superseded by `collection_carts` but still in schema. This creates confusion when building AI research project features that touch the basket.

**Fix:**  
Drop `user_collections` and `collection_items` in a migration. Nothing active depends on them.

```sql
DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS user_collections;
```

---

## 3. AI Integration Overview

### The Full AI Architecture (When Complete)

```
Scriptle.org
│
├── EXISTING (Phase 1 complete)
│   ├── Scripture browser, basket, draft books, PDF export
│   ├── Commentary registry (commentary_authors/works/entries)
│   ├── Metadata property system
│   └── Template system (Liquid)
│
├── PHASE 1 — AI Content Generation
│   ├── generate_content.py pipeline (already built)
│   ├── ai_jobs table (track generation status)
│   ├── Admin UI: generation dashboard
│   └── Commentary registry: "HSP AI" as registered author
│
├── PHASE 2 — Semantic Search (RAG Foundation)
│   ├── pgvector extension in PostgreSQL
│   ├── node_embeddings table
│   ├── embed_content.py pipeline
│   └── /api/search/semantic endpoint
│
├── PHASE 3 — AI Research Assistant
│   ├── /ask page: "Ask the Scriptures" chat UI
│   ├── /api/ai/ask endpoint (RAG query engine)
│   ├── Research project generation from search results
│   └── AI-assisted draft book synthesis
│
├── PHASE 4 — MCP Server
│   ├── mcp_server/ service
│   ├── Tools: get_verse, search_scriptures, get_commentary
│   └── External AI tools can query Scriptle
│
└── PHASE 5 — Advanced
    ├── Multi-language RAG (query in Tamil, get Sanskrit results)
    ├── Cross-scripture synthesis (dharma across all books)
    ├── AI research report generation (1000-page book synthesis)
    └── Contribution workflow for AI-generated content review
```

---

## 4. Phase 1 — AI Content Generation

**Goal:** Populate `content_data.translations`, `summary_data`, and commentary registry entries using Claude API.  
**Duration:** 1-2 weeks  
**Learning concepts:** Prompt engineering, structured outputs, tool use

---

### 4.1 Register "HSP AI" as a Commentary Author

Use your existing `commentary_authors` / `commentary_works` / `commentary_entries` tables. AI is just another author.

```sql
-- Run once as seed data
INSERT INTO commentary_authors (name, bio, metadata)
VALUES (
  'HSP AI',
  'AI-generated commentary by Anthropic Claude on behalf of the Hindu Scripture Platform.',
  '{"type": "ai", "model": "claude-sonnet-4", "language": "multi"}'
);

-- One work per language per book
INSERT INTO commentary_works (author_id, title, language, description, metadata)
VALUES
  (<hsp_ai_author_id>, 'AI Commentary — Bhagavad Gita (English)', 'english', 
   'AI-generated scholarly commentary on the Bhagavad Gita in English',
   '{"book_code": "BG", "generated_by": "claude-sonnet-4"}'),
  (<hsp_ai_author_id>, 'AI Commentary — Bhagavad Gita (Telugu)', 'telugu', ...),
  ...
```

Then `commentary_entries` are created per-node by the generation pipeline.

---

### 4.2 Upgrade generate_content.py — Tool Use Pattern

Replace JSON-prompt approach with Claude's tool use for guaranteed structured output.

```python
# api/pipelines/generate_content.py

TOOLS = [{
    "name": "save_shloka_content",
    "description": "Save generated multilingual content for a shloka",
    "input_schema": {
        "type": "object",
        "required": ["translation", "summary", "commentary", "word_meanings"],
        "properties": {
            "translation": {
                "type": "string",
                "description": "Full fluent translation in target language"
            },
            "summary": {
                "type": "string", 
                "description": "1-2 sentence essence of the verse"
            },
            "commentary": {
                "type": "string",
                "description": "3-5 sentence scholarly explanation"
            },
            "word_meanings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "sanskrit_word": {"type": "string"},
                        "transliteration": {"type": "string"},
                        "meaning": {"type": "string"}
                    }
                }
            }
        }
    }
}]

def generate_for_shloka(sanskrit, transliteration, language_name):
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        tools=TOOLS,
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": f"..."}]
    )
    # Claude is FORCED to call save_shloka_content with valid structure
    tool_use = next(b for b in response.content if b.type == "tool_use")
    return tool_use.input  # Guaranteed valid, no JSON parsing errors
```

---

### 4.3 Add `ai_jobs` Table

Track generation progress, costs, and status per book per language.

```sql
CREATE TABLE ai_jobs (
    id              SERIAL PRIMARY KEY,
    job_type        VARCHAR(50) NOT NULL,   -- 'generate_translation', 'generate_commentary', 'generate_embeddings'
    book_id         INTEGER REFERENCES books(id),
    language_code   VARCHAR(20),
    model           VARCHAR(100),           -- 'claude-sonnet-4-20250514'
    status          VARCHAR(20) DEFAULT 'pending', -- pending | running | completed | failed | paused
    
    total_nodes     INTEGER DEFAULT 0,
    processed_nodes INTEGER DEFAULT 0,
    failed_nodes    INTEGER DEFAULT 0,
    
    estimated_cost_usd  DECIMAL(10,4),
    actual_cost_usd     DECIMAL(10,4),
    
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    error_log       JSONB,                  -- [{node_id, error, timestamp}]
    metadata        JSONB,                  -- job-specific config
    
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT NOW()
);
```

---

### 4.4 Admin Generation Dashboard

New admin page: `/admin/ai-generation`

```
┌─────────────────────────────────────────────────────┐
│  AI Content Generation                               │
├─────────────────────────────────────────────────────┤
│  Book: [Bhagavad Gita ▼]  Language: [English ▼]     │
│  Estimated cost: ~$0.50   Nodes to process: 700      │
│                                                      │
│  [▶ Start]  [⏸ Pause]  [Export JSON]  [Import JSON] │
├─────────────────────────────────────────────────────┤
│  Progress: 342/700 ████████░░ 49%                   │
│                                                      │
│  ✅ Verse 1.1 — Generated                           │
│  ✅ Verse 1.2 — Generated                           │
│  ⏳ Verse 1.3 — Generating...                       │
│  ⬜ Verse 1.4 — Pending                             │
│                                                      │
│  [⚑ Flag for Review]  [✎ Edit]  [↺ Regenerate]     │
└─────────────────────────────────────────────────────┘
```

---

### 4.5 Marking AI Content — Provenance

Every AI-generated node gets a `provenance_record`:

```python
# After generating content for a node
await db.execute("""
    INSERT INTO provenance_records 
    (target_node_id, target_book_id, source_type, license_type, 
     inserted_by, metadata)
    VALUES 
    (:node_id, :book_id, 'ai_generated', 'AI-GENERATED',
     'ai_pipeline', :metadata)
""", {
    "node_id": node_id,
    "book_id": book_id,
    "metadata": json.dumps({
        "model": "claude-sonnet-4-20250514",
        "language": language_code,
        "generated_at": datetime.utcnow().isoformat(),
        "reviewed": False,
        "reviewer_id": None
    })
})
```

---

### Phase 1 Deliverables

| Deliverable | What Users Can Do |
|---|---|
| `generate_content.py` (tool-use version) | Admin runs pipeline, fills translations/commentaries |
| `ai_jobs` table | Track progress, cost, status |
| Admin generation dashboard | UI to trigger, monitor, pause generation |
| "HSP AI" in commentary registry | AI commentary shows as attributed author in UI |
| Provenance records for AI content | Every node shows AI attribution badge |

---

## 5. Phase 2 — Semantic Search & RAG

**Goal:** Enable semantic/conceptual search across all scriptures. Foundation for "Ask the Scriptures."  
**Duration:** 2-3 weeks  
**Learning concepts:** Embeddings, vector databases, RAG

---

### 5.1 Enable pgvector in Your Existing PostgreSQL

```sql
-- Run once
CREATE EXTENSION IF NOT EXISTS vector;
```

No new database needed. pgvector adds a `VECTOR` type to your existing Postgres.

---

### 5.2 Add `node_embeddings` Table

```sql
CREATE TABLE node_embeddings (
    id              SERIAL PRIMARY KEY,
    node_id         INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
    language_code   VARCHAR(20) NOT NULL,       -- 'english', 'sanskrit', 'telugu', etc.
    content_type    VARCHAR(50) NOT NULL,        -- 'translation', 'commentary', 'sanskrit'
    embedding       VECTOR(1536),               -- OpenAI text-embedding-3-small dimensions
    model           VARCHAR(100),               -- embedding model used
    created_at      TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(node_id, language_code, content_type)
);

-- IVFFlat index for fast approximate nearest neighbor search
CREATE INDEX idx_node_embeddings_vector 
ON node_embeddings 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

---

### 5.3 Embedding Pipeline

```python
# api/pipelines/embed_content.py
# Run AFTER generate_content.py has populated translations

import openai  # cheaper for embeddings than Claude
# OR use Anthropic's voyage-3 embeddings (better for multilingual)

EMBED_MODEL = "text-embedding-3-small"  # $0.02/million tokens

def embed_node(node: dict, language_code: str) -> list[float]:
    # What to embed: translation + summary + commentary combined
    content_parts = []
    
    translation = node["content_data"]["translations"].get(language_code, "")
    summary = node.get("summary_data", {}).get(language_code, "")
    
    if translation:
        content_parts.append(translation)
    if summary:
        content_parts.append(summary)
    
    # Also embed Sanskrit for cross-language matching
    sanskrit = node["content_data"]["basic"].get("sanskrit", "")
    if sanskrit:
        content_parts.append(sanskrit)
    
    combined = " ".join(content_parts)
    
    response = openai.embeddings.create(
        input=combined,
        model=EMBED_MODEL
    )
    return response.data[0].embedding
```

---

### 5.4 Semantic Search API Endpoint

```python
# api/ai_search.py — new FastAPI router

@router.post("/search/semantic")
async def semantic_search(
    query: str,
    language_code: str = "english",
    book_ids: list[int] = None,      # None = search all books
    limit: int = 20,
    db: Session = Depends(get_db)
):
    # 1. Embed the user's query
    query_embedding = embed_text(query, language_code)
    
    # 2. Build scope filter
    book_filter = ""
    if book_ids:
        book_filter = f"AND cn.book_id = ANY(ARRAY{book_ids})"
    
    # 3. Vector similarity search in pgvector
    results = db.execute("""
        SELECT 
            cn.id,
            cn.book_id,
            cn.level_name,
            cn.sequence_number,
            cn.content_data,
            b.book_name,
            1 - (ne.embedding <=> :query_embedding) AS similarity
        FROM node_embeddings ne
        JOIN content_nodes cn ON ne.node_id = cn.id
        JOIN books b ON cn.book_id = b.id
        WHERE ne.language_code = :language_code
        AND cn.has_content = true
        {book_filter}
        ORDER BY ne.embedding <=> :query_embedding
        LIMIT :limit
    """, {
        "query_embedding": query_embedding,
        "language_code": language_code,
        "limit": limit
    })
    
    return {
        "query": query,
        "language": language_code,
        "results": [format_result(r) for r in results]
    }
```

---

### 5.5 Cross-Language Search

A user searches in Tamil → finds verses whose English/Sanskrit embeddings match.

```python
# Embed query in multiple languages simultaneously
async def cross_language_search(query: str, limit: int = 20):
    # Embed the query once
    query_embedding = embed_text(query)
    
    # Search across ALL language embeddings
    results = db.execute("""
        SELECT DISTINCT ON (ne.node_id)
            ne.node_id,
            cn.book_id,
            b.book_name,
            cn.sequence_number,
            cn.content_data,
            1 - (ne.embedding <=> :embedding) AS similarity
        FROM node_embeddings ne
        JOIN content_nodes cn ON ne.node_id = cn.id
        JOIN books b ON cn.book_id = b.id
        ORDER BY ne.node_id, ne.embedding <=> :embedding
        LIMIT :limit
    """, {"embedding": query_embedding, "limit": limit})
```

---

### Phase 2 Deliverables

| Deliverable | What Users Can Do |
|---|---|
| pgvector enabled | Fast semantic search in Postgres |
| `node_embeddings` table | Every verse has vector representation |
| `embed_content.py` pipeline | Admin embeds all content after generation |
| `/api/search/semantic` endpoint | Semantic search across scriptures |
| Explorer upgrade | Semantic search results in existing Explorer page |

---

## 6. Phase 3 — AI Research Assistant

**Goal:** "Ask the Scriptures" chat interface. Users ask questions, AI answers grounded in Scriptle data only.  
**Duration:** 2-3 weeks  
**Learning concepts:** RAG query engine, agents, tool use at runtime

---

### 6.1 "Ask the Scriptures" — The RAG Query Engine

```python
# api/ai_ask.py

async def ask_scriptures(
    question: str,
    language_code: str = "english",
    scope: dict = None,  # {type: "all"|"book"|"selected", book_ids: [...]}
    stream: bool = True
):
    # STEP 1: Find relevant verses (RAG retrieval)
    relevant_nodes = await semantic_search(
        query=question,
        language_code=language_code,
        book_ids=scope.get("book_ids") if scope else None,
        limit=15
    )
    
    # STEP 2: Build context from retrieved verses
    context = build_scripture_context(relevant_nodes, language_code)
    
    # STEP 3: Ask Claude to answer using ONLY the retrieved context
    system_prompt = f"""You are a Hindu scripture scholar assistant for Scriptle.org.
    
Answer the user's question using ONLY the scripture verses provided below.
Do NOT use any knowledge outside these verses.
For every claim you make, cite the specific verse (book name + verse number).
If the answer is not found in the provided verses, say so clearly.

Language: {language_code}

SCRIPTURE CONTEXT:
{context}"""

    response = await claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        system=system_prompt,
        messages=[{"role": "user", "content": question}],
        stream=stream
    )
    
    return response
```

---

### 6.2 "Ask the Scriptures" Frontend Page

New page: `/ask`

```
┌─────────────────────────────────────────────────────┐
│  Ask the Scriptures                  [Scriptle.org]  │
├─────────────────────────────────────────────────────┤
│  Search scope: ○ All Scriptures  ○ Bhagavad Gita    │
│               ○ Ramayana         ○ Select books...  │
│  Language: [English ▼]                               │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │ In Ramayana, how many references mention      │  │
│  │ people eating meat?                    [Ask →] │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  Found 7 references in the Ramayana:                │
│                                                      │
│  1. Ayodhya Kanda 20.29 — "..."                     │
│     [View Verse] [Add to Basket]                    │
│                                                      │
│  2. Aranya Kanda 11.45 — "..."                      │
│     [View Verse] [Add to Basket]                    │
│                                                      │
│  Based on these verses, the Ramayana contains...    │
└─────────────────────────────────────────────────────┘
```

**Key UX detail:** Every cited verse has an `[Add to Basket]` button. User can add all relevant verses to basket and then create a research book from them. This connects the AI assistant directly to your existing basket → book workflow.

---

### 6.3 AI-Assisted Research Book Generation

When a user has assembled verses in their basket, AI helps organize and synthesize:

```
User basket: 50 verses on "dharma" from 5 books
                ↓
User clicks: "Generate Research Draft with AI"
                ↓
AI agent:
  1. Analyzes all 50 verses
  2. Groups them by sub-theme (dharma as duty, dharma as law, dharma as truth...)
  3. Writes connecting commentary between groups
  4. Suggests chapter structure for the draft book
  5. Creates draft book with AI-organized sections
                ↓
User reviews, edits, reorganizes
                ↓
Submits for peer review → Publishes
```

```python
# api/ai_draft.py

@router.post("/ai/drafts/generate-from-basket")
async def generate_draft_from_basket(
    research_topic: str,
    language_code: str,
    user = Depends(require_permission("can_contribute"))
):
    # Get user's basket contents
    basket = await get_user_basket(user.id)
    nodes = await get_basket_nodes(basket)
    
    # Ask Claude to organize and synthesize
    synthesis = await claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        tools=[organize_into_chapters_tool],
        system="You are organizing scripture verses into a coherent research book...",
        messages=[{
            "role": "user",
            "content": f"""Research topic: {research_topic}
            
Verses collected:
{format_nodes_for_synthesis(nodes)}

Organize these into a coherent chapter structure with:
1. Suggested chapter names and order
2. Which verses belong to each chapter
3. A brief connecting commentary for each chapter
4. An introduction for the whole book"""
        }]
    )
    
    # Create draft book structure from AI's organization
    draft = await create_draft_from_synthesis(synthesis, nodes, user.id)
    return {"draft_id": draft.id}
```

---

### Phase 3 Deliverables

| Deliverable | What Users Can Do |
|---|---|
| `/ask` page | Ask questions, get verse-grounded answers |
| [Add to Basket] on results | Direct pipeline from question → basket → book |
| AI draft generation from basket | AI organizes basket into structured research book |
| Streaming responses | Real-time answer generation (fast UX) |

---

## 7. Phase 4 — MCP Server

**Goal:** Expose Scriptle as an MCP server so any AI tool (Claude Desktop, Claude Code, external apps) can query your scripture data.  
**Duration:** 1-2 weeks  
**Learning concepts:** MCP protocol, tool design, API standardization

---

### 7.1 MCP Server Structure

```
mcp_server/
├── main.py          # MCP server entry point
├── tools/
│   ├── get_verse.py
│   ├── search_scriptures.py
│   ├── get_commentary.py
│   ├── list_books.py
│   └── get_chapter.py
└── requirements.txt
```

---

### 7.2 MCP Tools (wrapping your existing API)

```python
# mcp_server/main.py
from mcp.server import Server
from mcp.server.models import InitializationOptions
import httpx

SCRIPTLE_API = "https://www.scriptle.org/api"
app = Server("scriptle-mcp")

@app.tool()
async def get_verse(book_code: str, chapter: int, verse: int, language: str = "english") -> dict:
    """
    Fetch a specific verse from any Hindu scripture with all translations and commentary.
    Example: get_verse("BG", 2, 47, "english") → Bhagavad Gita 2.47
    """
    response = await httpx.get(
        f"{SCRIPTLE_API}/books/{book_code}/verse/{chapter}/{verse}",
        params={"language": language}
    )
    return response.json()

@app.tool()
async def search_scriptures(query: str, language: str = "english", book_code: str = None, limit: int = 10) -> list:
    """
    Semantic search across all Hindu scriptures (or a specific book).
    Returns relevant verses with translations, commentary, and citations.
    Example: search_scriptures("nature of the Self", "english", "upanishads")
    """
    response = await httpx.post(
        f"{SCRIPTLE_API}/search/semantic",
        json={"query": query, "language": language, "book_code": book_code, "limit": limit}
    )
    return response.json()

@app.tool()
async def get_commentary(book_code: str, chapter: int, verse: int, author_slug: str = None) -> list:
    """
    Get scholarly commentaries for a verse.
    author_slug can be: "adi_shankaracharya", "hsp_ai", "swami_sivananda", etc.
    """
    ...

@app.tool()
async def list_books(language: str = "english") -> list:
    """
    List all scriptures available on Scriptle.org with metadata.
    Returns: book name, code, language, verse count, available translations.
    """
    ...
```

### 7.3 What This Enables

Once your MCP server is live:
- **Claude Desktop users** can query Scriptle natively in their chats
- **Claude Code** can use Scriptle data while building scripture-related apps
- **External apps** can build on top of your data via standard protocol
- **Other AI platforms** (when they support MCP) can query Scriptle

---

## 8. Phase 5 — Advanced AI Features

**Goal:** Full research synthesis — users can generate comprehensive books on any topic across all scriptures.  
**Duration:** Ongoing  
**Learning concepts:** Long-context agents, memory, multi-step reasoning

---

### 8.1 Cross-Scripture Synthesis Agent

For the "research dharma across all scriptures" use case:

```
User: "Generate a comprehensive analysis of dharma across all scriptures"
        ↓
Agent plan:
  1. Search "dharma" semantically across all books (500+ results)
  2. Cluster results by sub-theme (agent reasoning)
  3. For each cluster, identify the most significant 5-10 verses
  4. Generate connecting analysis between scriptures
  5. Identify contradictions and harmonizations
  6. Build chapter outline (Introduction, Gita's view, Ramayana's view, 
     Upanishadic view, Synthesis, Conclusion)
  7. Draft each chapter using retrieved verses as foundation
  8. Create draft book in Scriptle
        ↓
User edits, approves, submits for review
        ↓
Published as derivative work on Scriptle
```

### 8.2 Multi-Language Research

User researches in Tamil → system searches across all languages → response in Tamil:

```python
# Multilingual RAG pipeline
async def multilingual_ask(question: str, response_language: str):
    
    # Search across all language embeddings
    results = await cross_language_search(question, limit=15)
    
    # Fetch content in response language (or English as fallback)
    context = build_context(results, preferred_language=response_language)
    
    # Ask Claude to respond in requested language
    system = f"Answer in {response_language}. Cite verses using their book/chapter/verse numbers."
    
    return await claude_stream(question, context, system)
```

### 8.3 Contribution Review Workflow (Wiring Existing Schema)

Your `contributions` table is already in the schema but not wired. This is the peer review pipeline for AI content:

```
AI generates commentary entry (status: "pending_review")
        ↓
Moderator sees queue at /admin/review
        ↓
Reviews verse + AI commentary
        ↓
Approves (status: "published") or Rejects with notes (status: "rejected")
        ↓
Approved commentary appears publicly, attributed to "HSP AI (Reviewed)"
```

---

## 9. Data Model Extensions

### New Tables to Add

```sql
-- 1. AI job tracking
CREATE TABLE ai_jobs (...);  -- see §4.3

-- 2. Vector embeddings
CREATE TABLE node_embeddings (...);  -- see §5.2

-- 3. AI search sessions (optional — analytics)
CREATE TABLE ai_search_sessions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),  -- NULL for anonymous
    question        TEXT,
    language_code   VARCHAR(20),
    scope           JSONB,              -- {type, book_ids}
    node_ids_cited  INTEGER[],          -- which verses were cited in response
    created_at      TIMESTAMP DEFAULT NOW()
);
```

### Extensions to Existing Tables

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Add AI review status to commentary_entries
ALTER TABLE commentary_entries 
ADD COLUMN ai_review_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN ai_reviewed_by INTEGER REFERENCES users(id),
ADD COLUMN ai_reviewed_at TIMESTAMP;

-- Add AI job reference to content_nodes
ALTER TABLE content_nodes
ADD COLUMN ai_generated_languages VARCHAR(20)[];  -- tracks which langs have AI content
```

### No Changes Needed

These existing structures work perfectly for AI:
- `content_data.translations` JSONB → AI fills in missing language keys
- `commentary_authors/works/entries` → AI registered as "HSP AI" author
- `provenance_records` → AI generation tracked here
- `collection_carts` → AI search results feed directly into basket
- `draft_books` → AI-organized research projects stored here
- `render_templates` → Liquid templates already render AI content correctly

---

## 10. Cost Estimates

### One-Time Generation Costs (Using Batch API — 50% discount)

| Scripture | Verses | 4 Languages | With Batch Discount |
|---|---|---|---|
| Bhagavad Gita | 700 | ~$30 | ~$15 |
| Avadhuta Gita | 288 | ~$12 | ~$6 |
| Ramayana | 24,000 | ~$1,000 | ~$500 |
| Mahabharata | 100,000 | ~$4,300 | ~$2,150 |
| All major Upanishads | ~1,500 | ~$65 | ~$33 |

**Optimization:** Use DeepL for Hindi/Tamil/Telugu translations ($0.03/1000 chars), Claude for English + commentary only. Cuts cost by 60-70%.

### Embedding Costs (One-time, using OpenAI text-embedding-3-small)

| Scripture | Vectors | Cost |
|---|---|---|
| All scriptures (estimated) | ~500,000 | ~$1.00 |

Essentially free.

### Ongoing RAG Query Costs (per month)

| Traffic | Cost |
|---|---|
| 500 queries/month | ~$2.50 |
| 5,000 queries/month | ~$25 |
| 50,000 queries/month | ~$250 |

**Cost control:** Cache popular queries (Redis or Postgres), pre-generate answers for top 100 common questions.

---

## 11. Technology Additions

| Addition | Purpose | Fits Into |
|---|---|---|
| `anthropic` Python SDK | Claude API calls | `api/pipelines/` |
| `pgvector` Postgres extension | Vector storage + search | Existing Postgres |
| `openai` Python SDK | Embeddings (cheaper than Claude) | `api/pipelines/` |
| `mcp` Python SDK | MCP server | New `mcp_server/` service |
| Redis (optional) | Cache popular RAG queries | New service |

**No new databases. No new infrastructure.** Everything runs in your existing Postgres + FastAPI + Next.js stack.

---

## 12. Learning Map — AI Concepts

Each phase teaches you a core AI engineering concept through building a real Scriptle feature.

| Phase | Feature Built | AI Concept Learned |
|---|---|---|
| 1 | Content generation pipeline | Prompt engineering, Tool use, Structured outputs |
| 2 | Semantic search | Embeddings, Vector databases, pgvector |
| 3a | Ask the Scriptures | RAG (Retrieval Augmented Generation) |
| 3b | AI draft generation | Agents, Multi-step reasoning |
| 4 | MCP server | MCP protocol, Tool standardization |
| 5a | Cross-scripture synthesis | Long-context agents, Memory |
| 5b | Multilingual RAG | Cross-lingual embeddings |
| 5c | Contribution review | Human-in-the-loop AI workflows |

---

## Recommended Build Order

### Week 1-2 (Start Here)
1. Fix Viewer permission inconsistency
2. Register "HSP AI" as commentary author (seed data)
3. Upgrade `generate_content.py` to tool-use pattern
4. Add `ai_jobs` table
5. Run generation for Bhagavad Gita in English
6. Verify AI commentary appears in existing UI via commentary registry

### Week 3-4
7. Enable pgvector in Postgres
8. Add `node_embeddings` table
9. Build `embed_content.py` pipeline
10. Add `/api/search/semantic` endpoint
11. Upgrade Explorer page to use semantic search

### Week 5-6
12. Build `/ask` page (Ask the Scriptures)
13. Add `[Add to Basket]` on search results
14. Wire AI draft generation from basket

### Week 7-8
15. Build MCP server (wraps existing API)
16. Test with Claude Desktop

### Ongoing
17. Add more scriptures + languages
18. Build cross-scripture synthesis agent
19. Wire contribution review workflow
20. Add multilingual RAG

---

*This roadmap is based on `architecture.md v1.0` dated May 2, 2026.*  
*Generated in consultation with Scriptle.org founder.*
