"use client";

import { useState, useEffect } from "react";

type BasketItem = {
  node_id: number;
  title?: string;
  book_name?: string;
  level_name?: string;
  order: number;
};

type Schema = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
};

type Book = {
  id: number;
  book_name: string;
  schema_id?: number | null;
};

type OrganizedNode = {
  id: string; // Temporary ID for organization
  type: "content" | "placeholder"; // content = from basket, placeholder = new organizational node
  node_id?: number; // If type=content
  title: string;
  target_level: string; // Which level this should be in the book
  target_level_order: number;
  children: OrganizedNode[];
  sequence_number: number;
};

type BasketPanelProps = {
  items: BasketItem[];
  onRemoveItem: (nodeId: number) => void;
  onClearBasket: () => void;
  onItemsAdded?: () => void;
};

export default function BasketPanel({
  items,
  onRemoveItem,
  onClearBasket,
  onItemsAdded,
}: BasketPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddToBook, setShowAddToBook] = useState(false);
  const [showOrganizer, setShowOrganizer] = useState(false);
  const [mode, setMode] = useState<"select" | "create">("select");
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookCode, setBookCode] = useState("");
  const [languagePrimary, setLanguagePrimary] = useState("sanskrit");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [organizedTree, setOrganizedTree] = useState<OrganizedNode[]>([]);
  const [targetBookId, setTargetBookId] = useState<number | null>(null);
  const [targetSchemaLevels, setTargetSchemaLevels] = useState<string[]>([]);

  const loadSchemas = async () => {
    try {
      const response = await fetch("/api/schemas", { credentials: "include" });
      if (response.ok) {
        const data = (await response.json()) as Schema[];
        setSchemas(data);
      }
    } catch {
      // Ignore errors
    }
  };

  const loadBooks = async () => {
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      if (response.ok) {
        const data = (await response.json()) as Book[];
        setBooks(data);
      }
    } catch {
      // Ignore errors
    }
  };

  const handleAddToBookClick = async () => {
    setShowAddToBook(true);
    setMode("select");
    setMessage(null);
    await Promise.all([loadSchemas(), loadBooks()]);
  };

  const initializeOrganizer = (schemaLevels: string[], bookId: number) => {
    // Initialize tree with basket items as flat list at leaf level
    const leafLevel = schemaLevels[schemaLevels.length - 1];
    const leafLevelOrder = schemaLevels.length;
    
    const initialTree: OrganizedNode[] = items.map((item, index) => ({
      id: `content-${item.node_id}`,
      type: "content",
      node_id: item.node_id,
      title: item.title || `Node ${item.node_id}`,
      target_level: leafLevel,
      target_level_order: leafLevelOrder,
      children: [],
      sequence_number: index + 1,
    }));

    setOrganizedTree(initialTree);
    setTargetSchemaLevels(schemaLevels);
    setTargetBookId(bookId);
    setShowAddToBook(false);
    setShowOrganizer(true);
  };

  const addOrganizationalNode = (level: string, levelOrder: number, title: string) => {
    const newNode: OrganizedNode = {
      id: `placeholder-${Date.now()}`,
      type: "placeholder",
      title,
      target_level: level,
      target_level_order: levelOrder,
      children: [],
      sequence_number: organizedTree.length + 1,
    };
    setOrganizedTree([...organizedTree, newNode]);
  };

  const moveNodeUnderParent = (nodeId: string, parentId: string | null) => {
    // Move a node to be a child of another node (or root if parentId is null)
    const cloneTree = JSON.parse(JSON.stringify(organizedTree)) as OrganizedNode[];
    
    // Find and remove the node from wherever it is
    let movedNode: OrganizedNode | null = null;
    const removeNode = (nodes: OrganizedNode[]): OrganizedNode[] => {
      return nodes.filter(node => {
        if (node.id === nodeId) {
          movedNode = node;
          return false;
        }
        node.children = removeNode(node.children);
        return true;
      });
    };
    const newTree = removeNode(cloneTree);

    if (!movedNode) return;

    // Add to parent or root
    if (parentId === null) {
      newTree.push(movedNode);
    } else {
      const addToParent = (nodes: OrganizedNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === parentId) {
            node.children.push(movedNode!);
            return true;
          }
          if (addToParent(node.children)) return true;
        }
        return false;
      };
      addToParent(newTree);
    }

    setOrganizedTree(newTree);
  };

  const handleCreateNewBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchema) return;

    setLoading(true);
    setMessage("Creating book...");

    try {
      const schema = schemas.find(s => s.id === selectedSchema);
      if (!schema) throw new Error("Schema not found");

      // Create the book
      const response = await fetch("/api/books", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema_id: selectedSchema,
          book_name: bookName,
          book_code: bookCode || null,
          language_primary: languagePrimary,
          metadata: {},
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create book");
      }

      const newBook = await response.json();
      setMessage(`✓ Book created. Now organize your content...`);
      
      // Open organizer with the new book
      setTimeout(() => {
        setLoading(false);
        initializeOrganizer(schema.levels, newBook.id);
      }, 800);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to create book"}`);
      setLoading(false);
    }
  };

  const handleAddToExistingBook = async () => {
    if (!selectedBook) return;

    const book = books.find(b => b.id === selectedBook);
    if (!book) return;

    setLoading(true);
    setMessage("Loading book schema...");

    try {
      // Fetch the book details to get its schema
      const response = await fetch(`/api/books/${selectedBook}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch book details");
      }

      const bookDetails = await response.json();
      const schema = bookDetails.schema;

      if (!schema || !schema.levels) {
        throw new Error("Book schema not found");
      }

      setMessage("Opening organizer...");
      setTimeout(() => {
        setLoading(false);
        initializeOrganizer(schema.levels, selectedBook);
      }, 500);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to load book"}`);
      setLoading(false);
    }
  };

  const createOrganizedTree = async () => {
    if (!targetBookId) return;

    setLoading(true);
    setMessage("Adding content to book...");

    try {
      await addOrganizedNodesToBook(targetBookId, organizedTree);
      
      setMessage(`✓ Added ${items.length} items to book`);
      
      // Clear basket and close organizer after success
      setTimeout(() => {
        onClearBasket();
        setShowOrganizer(false);
        setMessage(null);
        if (onItemsAdded) onItemsAdded();
      }, 1500);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to add items"}`);
    } finally {
      setLoading(false);
    }
  };

  const addOrganizedNodesToBook = async (
    bookId: number,
    tree: OrganizedNode[],
    parentNodeId: number | null = null
  ): Promise<void> => {
    for (const node of tree) {
      let createdNodeId: number | null = null;

      if (node.type === "content" && node.node_id) {
        // Fetch original node content
        const nodeResponse = await fetch(`/api/nodes/${node.node_id}`, {
          credentials: "include",
        });

        if (!nodeResponse.ok) continue;

        const originalNode = await nodeResponse.json();

        // Create new node in target book
        const createResponse = await fetch("/api/nodes", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_id: bookId,
            parent_node_id: parentNodeId,
            level_name: node.target_level,
            level_order: node.target_level_order,
            sequence_number: node.sequence_number,
            title_sanskrit: originalNode.title_sanskrit,
            title_transliteration: originalNode.title_transliteration,
            title_english: originalNode.title_english,
            title_hindi: originalNode.title_hindi,
            title_tamil: originalNode.title_tamil,
            has_content: originalNode.has_content,
            content_data: originalNode.content_data || {},
            summary_data: originalNode.summary_data || {},
            source_attribution: originalNode.source_attribution,
            license_type: originalNode.license_type || "CC-BY-SA-4.0",
            original_source_url: originalNode.original_source_url,
            tags: originalNode.tags || [],
          }),
        });

        if (createResponse.ok) {
          const created = await createResponse.json();
          createdNodeId = created.id;
        }
      } else if (node.type === "placeholder") {
        // Create organizational node (chapter, part, etc.)
        const createResponse = await fetch("/api/nodes", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_id: bookId,
            parent_node_id: parentNodeId,
            level_name: node.target_level,
            level_order: node.target_level_order,
            sequence_number: node.sequence_number,
            title_english: node.title,
            has_content: false,
            content_data: {},
            summary_data: {},
            license_type: "CC-BY-SA-4.0",
            tags: [],
          }),
        });

        if (createResponse.ok) {
          const created = await createResponse.json();
          createdNodeId = created.id;
        }
      }

      // Recursively create children
      if (node.children.length > 0 && createdNodeId) {
        await addOrganizedNodesToBook(bookId, node.children, createdNodeId);
      }
    }
  };

  if (items.length === 0 && !isExpanded) {
    return null;
  }

  return (
    <>
      {/* Floating Basket Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-medium text-white shadow-lg transition hover:shadow-xl"
        >
          <span>🧺 Basket</span>
          {items.length > 0 && (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[color:var(--accent)]">
              {items.length}
            </span>
          )}
        </button>
      </div>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="fixed bottom-24 right-6 z-40 w-96 rounded-2xl border border-black/10 bg-white/95 shadow-2xl backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-black/10 p-4">
            <h3 className="font-[var(--font-display)] text-lg text-[color:var(--deep)]">
              Basket ({items.length})
            </h3>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-xl text-zinc-400 hover:text-zinc-600"
            >
              ✕
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto p-4">
            {items.length === 0 ? (
              <p className="text-center text-sm text-zinc-500">
                Your basket is empty
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <div
                    key={item.node_id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-black/10 bg-white/80 p-3"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[color:var(--deep)]">
                        {item.title || `Node ${item.node_id}`}
                      </div>
                      {item.book_name && (
                        <div className="text-xs text-zinc-500">
                          {item.book_name}
                          {item.level_name && ` • ${item.level_name}`}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onRemoveItem(item.node_id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t border-black/10 p-4">
              <div className="flex gap-2">
                <button
                  onClick={handleAddToBookClick}
                  disabled={loading}
                  className="flex-1 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:shadow-lg disabled:opacity-50"
                >
                  Add to Book
                </button>
                <button
                  onClick={onClearBasket}
                  disabled={loading}
                  className="rounded-lg border border-red-500/30 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add to Book Modal */}
      {showAddToBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                Add Basket Items to Book
              </h2>
              <button
                onClick={() => {
                  setShowAddToBook(false);
                  setMessage(null);
                }}
                disabled={loading}
                className="text-2xl text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            {message && (
              <div className={`mb-4 rounded-lg p-3 text-sm ${
                message.startsWith("✓")
                  ? "bg-emerald-50 text-emerald-700"
                  : message.startsWith("✗")
                  ? "bg-red-50 text-red-700"
                  : "bg-blue-50 text-blue-700"
              }`}>
                {message}
              </div>
            )}

            {/* Mode Selection */}
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setMode("select")}
                disabled={loading}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  mode === "select"
                    ? "border border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                    : "border border-black/10 bg-white text-zinc-700 hover:border-[color:var(--accent)]"
                }`}
              >
                Add to Existing Book
              </button>
              <button
                onClick={() => setMode("create")}
                disabled={loading}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  mode === "create"
                    ? "border border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                    : "border border-black/10 bg-white text-zinc-700 hover:border-[color:var(--accent)]"
                }`}
              >
                Create New Book
              </button>
            </div>

            {/* Add to Existing Book */}
            {mode === "select" && (
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Select Book
                </label>
                <select
                  value={selectedBook || ""}
                  onChange={(e) => setSelectedBook(Number(e.target.value))}
                  disabled={loading}
                  className="mb-4 w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                >
                  <option value="">Choose a book...</option>
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.book_name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddToExistingBook}
                  disabled={!selectedBook || loading}
                  className="w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-medium text-white transition hover:shadow-lg disabled:opacity-50"
                >
                  {loading ? "Adding..." : "Add Items to Book"}
                </button>
              </div>
            )}

            {/* Create New Book */}
            {mode === "create" && !selectedSchema && (
              <div>
                <p className="mb-4 text-sm text-zinc-600">
                  Select a schema that defines the structure:
                </p>
                <div className="grid max-h-96 gap-3 overflow-y-auto">
                  {schemas.map((schema) => (
                    <button
                      key={schema.id}
                      onClick={() => setSelectedSchema(schema.id)}
                      disabled={loading}
                      className="rounded-2xl border border-black/10 bg-white/90 p-4 text-left transition hover:border-[color:var(--accent)] hover:shadow-md"
                    >
                      <div className="font-semibold text-[color:var(--deep)]">
                        {schema.name}
                      </div>
                      {schema.description && (
                        <div className="mt-1 text-xs text-zinc-600">
                          {schema.description}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {schema.levels.map((level, idx) => (
                          <span
                            key={idx}
                            className="rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs text-zinc-600"
                          >
                            {level}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "create" && selectedSchema && (
              <form onSubmit={handleCreateNewBook} className="flex flex-col gap-4">
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-blue-700">
                    Selected Schema
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold text-blue-900">
                      {schemas.find((s) => s.id === selectedSchema)?.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedSchema(null)}
                      disabled={loading}
                      className="text-xs text-blue-700 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Book Name *
                  </label>
                  <input
                    type="text"
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    disabled={loading}
                    required
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder="e.g., My Selected Verses"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Book Code (optional)
                  </label>
                  <input
                    type="text"
                    value={bookCode}
                    onChange={(e) => setBookCode(e.target.value)}
                    disabled={loading}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder="e.g., my-verses"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Primary Language
                  </label>
                  <select
                    value={languagePrimary}
                    onChange={(e) => setLanguagePrimary(e.target.value)}
                    disabled={loading}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="sanskrit">Sanskrit</option>
                    <option value="hindi">Hindi</option>
                    <option value="tamil">Tamil</option>
                    <option value="english">English</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-medium text-white transition hover:shadow-lg disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create Book & Organize Items"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Content Organizer Modal */}
      {showOrganizer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex h-[80vh] w-full max-w-5xl flex-col rounded-3xl border border-black/10 bg-white/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/10 p-6">
              <div>
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Organize Content
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Arrange items hierarchically before adding to book
                </p>
              </div>
              <button
                onClick={() => {
                  setShowOrganizer(false);
                  setMessage(null);
                }}
                disabled={loading}
                className="text-2xl text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            {message && (
              <div className={`mx-6 mt-4 rounded-lg p-3 text-sm ${
                message.startsWith("✓")
                  ? "bg-emerald-50 text-emerald-700"
                  : message.startsWith("✗")
                  ? "bg-red-50 text-red-700"
                  : "bg-blue-50 text-blue-700"
              }`}>
                {message}
              </div>
            )}

            <div className="flex flex-1 gap-6 overflow-hidden p-6">
              {/* Left: Organization Tree */}
              <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/90">
                <div className="border-b border-black/10 p-4">
                  <h3 className="font-medium text-[color:var(--deep)]">
                    Content Structure
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    {organizedTree.length} items • Schema: {targetSchemaLevels.join(" → ")}
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {organizedTree.length === 0 ? (
                    <p className="text-center text-sm text-zinc-500">
                      No items to organize
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {organizedTree.map((node) => (
                        <OrganizedNodeItem
                          key={node.id}
                          node={node}
                          depth={0}
                          availableLevels={targetSchemaLevels}
                          onRemove={() => {
                            setOrganizedTree(prev => prev.filter(n => n.id !== node.id));
                          }}
                          onChangelevel={(newLevel) => {
                            const levelOrder = targetSchemaLevels.indexOf(newLevel) + 1;
                            setOrganizedTree(prev =>
                              prev.map(n =>
                                n.id === node.id
                                  ? { ...n, target_level: newLevel, target_level_order: levelOrder }
                                  : n
                              )
                            );
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Tools */}
              <div className="w-80 flex flex-col gap-4">
                <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                  <h4 className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
                    Add Organizational Node
                  </h4>
                  <p className="mb-3 text-xs text-zinc-600">
                    Create chapters, parts, or sections to organize content
                  </p>
                  <div className="flex flex-col gap-2">
                    {targetSchemaLevels.slice(0, -1).map((level, index) => (
                      <button
                        key={level}
                        onClick={() => {
                          const title = prompt(`Enter title for ${level}:`);
                          if (title) {
                            addOrganizationalNode(level, index + 1, title);
                          }
                        }}
                        disabled={loading}
                        className="rounded-lg border border-blue-500/30 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                      >
                        + Add {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                  <h4 className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
                    Quick Tips
                  </h4>
                  <ul className="space-y-2 text-xs text-zinc-600">
                    <li>• Create organizational nodes first (chapters, parts)</li>
                    <li>• Drag items under organizational nodes (coming soon)</li>
                    <li>• Change item levels using the dropdown</li>
                    <li>• All items will be added to the book when you finalize</li>
                  </ul>
                </div>

                <button
                  onClick={createOrganizedTree}
                  disabled={loading || organizedTree.length === 0}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500 px-4 py-3 font-medium text-white transition hover:bg-emerald-600 hover:shadow-lg disabled:opacity-50"
                >
                  {loading ? "Adding to Book..." : "Finalize & Add to Book"}
                </button>

                <button
                  onClick={() => setShowOrganizer(false)}
                  disabled={loading}
                  className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Helper component to render organized nodes
function OrganizedNodeItem({
  node,
  depth,
  availableLevels,
  onRemove,
  onChangelevel,
}: {
  node: OrganizedNode;
  depth: number;
  availableLevels: string[];
  onRemove: () => void;
  onChangelevel: (level: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div style={{ marginLeft: `${depth * 20}px` }}>
      <div className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${
        node.type === "placeholder"
          ? "border-blue-500/30 bg-blue-50"
          : "border-black/10 bg-white/80"
      }`}>
        {node.children.length > 0 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-zinc-500"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        )}
        <div className="flex-1">
          <div className="font-medium text-zinc-900">{node.title}</div>
          <div className="text-xs text-zinc-500">
            {node.type === "placeholder" ? "Organizational Node" : "Content"} • {node.target_level}
          </div>
        </div>
        <select
          value={node.target_level}
          onChange={(e) => onChangelevel(e.target.value)}
          className="rounded border border-black/10 px-2 py-1 text-xs outline-none"
        >
          {availableLevels.map(level => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
        <button
          onClick={onRemove}
          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          ✕
        </button>
      </div>
      {isExpanded && node.children.length > 0 && (
        <div className="mt-1">
          {node.children.map(child => (
            <OrganizedNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              availableLevels={availableLevels}
              onRemove={() => {}}
              onChangelevel={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
