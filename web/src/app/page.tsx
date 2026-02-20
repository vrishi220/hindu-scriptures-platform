"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShoppingBasket } from "lucide-react";
import { contentPath } from "../lib/apiPaths";
import BasketPanel from "../components/BasketPanel";

type SearchNode = {
  id: number;
  book_id: number;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  level_name: string;
  sequence_number?: number | null;
  content_data?: {
    basic?: {
      sanskrit?: string;
      transliteration?: string;
    };
    translations?: {
      english?: string;
    };
  };
};

type SearchResult = {
  node: SearchNode;
  snippet?: string | null;
};

type SearchResponse = {
  query: string;
  total: number;
  results: SearchResult[];
};

type BookOption = {
  id: number;
  book_name: string;
  schema?: {
    id: number;
    name: string;
    description?: string | null;
    levels: string[];
  } | null;
};

type TreeNode = {
  id: number;
  level_name: string;
  sequence_number?: number | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TreeNode[];
};

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [bookId, setBookId] = useState("");
  const [levelName, setLevelName] = useState("");
  const [hasContent, setHasContent] = useState(false);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const treeCacheRef = useRef<Map<string, TreeNode[]>>(new Map());
  const [cachedTreeBooks, setCachedTreeBooks] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<{
    books_count: number;
    nodes_count: number;
    users_count: number;
  } | null>(null);
  const [dailyVerse, setDailyVerse] = useState<{
    id: number;
    title: string;
    content: string;
    book_name: string;
    book_id: number;
    node_id?: number;
  } | null>(null);
  const [verseMode, setVerseMode] = useState<"daily" | "random">("daily");
  const [basketItems, setBasketItems] = useState<Array<{
    node_id: number;
    title?: string;
    book_name?: string;
    level_name?: string;
    order: number;
  }>>([]);

  // Load basket from localStorage
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("scriptle-basket");
      const parsed = JSON.parse(raw || "[]") as typeof basketItems;
      if (Array.isArray(parsed)) {
        setBasketItems(parsed);
      }
    } catch {
      setBasketItems([]);
    }
  }, []);

  // Save basket to localStorage
  useEffect(() => {
    window.localStorage.setItem("scriptle-basket", JSON.stringify(basketItems));
  }, [basketItems]);

  const addToBasket = (nodeId: number, title: string, bookName?: string, levelName?: string) => {
    setBasketItems((prev) => {
      // Avoid duplicates
      if (prev.some((item) => item.node_id === nodeId)) {
        return prev;
      }
      return [
        ...prev,
        {
          node_id: nodeId,
          title,
          book_name: bookName,
          level_name: levelName,
          order: prev.length + 1,
        },
      ];
    });
  };

  const removeFromBasket = (nodeId: number) => {
    setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
  };

  const clearBasket = () => {
    setBasketItems([]);
  };

  const loadBooks = async () => {
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as BookOption[];
      setBooks(data);
    } catch {
      setBooks([]);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch("/api/stats", { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as {
        books_count: number;
        nodes_count: number;
        users_count: number;
      };
      setStats(data);
    } catch {
      // Ignore errors
    }
  };

  const loadDailyVerse = async (mode: "daily" | "random" = "daily") => {
    try {
      const response = await fetch(`/api/daily-verse?mode=${mode}`, { credentials: "include" });
      if (!response.ok) {
        console.error("Failed to load verse:", response.status);
        // Set a sentinel value to indicate no content
        setDailyVerse({ id: 0, title: "", content: "", book_name: "", book_id: 0 });
        return;
      }
      const data = (await response.json()) as {
        id: number;
        title: string;
        content: string;
        book_name: string;
        book_id: number;
        node_id?: number;
      } | null;
      
      // If no verse found, set empty state
      if (!data) {
        setDailyVerse({ id: 0, title: "", content: "", book_name: "", book_id: 0 });
      } else {
        setDailyVerse(data);
      }
    } catch (err) {
      console.error("Error loading verse:", err);
      setDailyVerse({ id: 0, title: "", content: "", book_name: "", book_id: 0 });
    }
  };

  const loadAuthStatus = async () => {
    try {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        setAuthStatus(detail?.detail || "Not authenticated");
        setAuthEmail(null);
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        return;
      }
      const data = (await response.json()) as {
        email?: string;
        role?: string;
        permissions?: {
          can_admin?: boolean;
          can_contribute?: boolean;
          can_edit?: boolean;
        } | null;
      };
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
    } catch (err) {
      console.error("Auth check error:", err);
      setAuthStatus("Auth check failed");
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
    }
  };


  useEffect(() => {
    const init = async () => {
      await Promise.all([
        loadBooks(),
        loadAuthStatus(),
        loadStats(),
        loadDailyVerse("daily"),
      ]);
      
      // Restore search state from URL after books are loaded
      const urlQuery = searchParams.get("q");
      const urlBookId = searchParams.get("book_id");
      const urlLevelName = searchParams.get("level_name");
      const urlHasContent = searchParams.get("has_content");
      
      if (urlQuery) {
        setQuery(urlQuery);
        if (urlBookId) setBookId(urlBookId);
        if (urlLevelName) setLevelName(urlLevelName);
        if (urlHasContent) setHasContent(urlHasContent === "true");
        // Run search after state is set
        setTimeout(() => {
          runSearch(urlQuery, urlBookId || "", urlLevelName || "", urlHasContent === "true");
        }, 50);
      }
    };
    
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore scroll position after results are loaded
  useEffect(() => {
    if (results.length > 0) {
      const savedScrollY = sessionStorage.getItem("searchScrollY");
      if (savedScrollY) {
        // Use requestAnimationFrame to ensure DOM is fully rendered
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo(0, parseInt(savedScrollY, 10));
            sessionStorage.removeItem("searchScrollY");
          });
        });
      }
    }
  }, [results]);

  const runSearch = async (term: string, searchBookId?: string, searchLevelName?: string, searchHasContent?: boolean) => {
    const searchTerm = term || query;
    const finalBookId = searchBookId !== undefined ? searchBookId : bookId;
    const finalLevelName = searchLevelName !== undefined ? searchLevelName : levelName;
    const finalHasContent = searchHasContent !== undefined ? searchHasContent : hasContent;
    
    if (!searchTerm.trim()) {
      setResults([]);
      setTotal(0);
      // Clear URL params
      router.push("/", { scroll: false });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: searchTerm,
        limit: "10",
      });
      if (finalBookId.trim()) {
        params.set("book_id", finalBookId.trim());
      }
      if (finalLevelName.trim()) {
        params.set("level_name", finalLevelName.trim());
      }
      if (finalHasContent) {
        params.set("has_content", "true");
      }

      const response = await fetch(`/api/search?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Search failed. Try again.");
      }
      const data = (await response.json()) as SearchResponse;
      setResults(data.results || []);
      setTotal(data.total || 0);
      
      // Load trees for all books in results for breadcrumb rendering
      if (data.results && data.results.length > 0) {
        await loadTreeForBooksInResults(data.results);
      }
      
      // Update URL with search params
      const urlParams = new URLSearchParams({ q: searchTerm });
      if (finalBookId.trim()) urlParams.set("book_id", finalBookId.trim());
      if (finalLevelName.trim()) urlParams.set("level_name", finalLevelName.trim());
      if (finalHasContent) urlParams.set("has_content", "true");
      router.push(`/?${urlParams.toString()}`, { scroll: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(query);
  };

  const quickSearch = (term: string) => {
    setQuery(term);
    setTimeout(() => runSearch(term), 0);
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return text ? { detail: text } : null;
        })) as { detail?: string; message?: string } | null;
        const detail = payload?.detail || payload?.message || "Login failed";
        throw new Error(`Login failed (${response.status}): ${detail}`);
      }
      setAuthMessage("Logged in. Refreshing book list...");
      setEmail("");
      setPassword("");
      setShowLogin(false);
      await loadBooks();
      await loadAuthStatus();
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    }
  };

  const loadTree = async (selectedId: string) => {
    if (!selectedId) {
      setTreeData([]);
      setTreeError(null);
      return;
    }
    // Check cache first
    if (treeCacheRef.current.has(selectedId)) {
      setTreeData(treeCacheRef.current.get(selectedId) || []);
      setTreeError(null);
      return;
    }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const response = await fetch(`/api/books/${selectedId}/tree`, {
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(payload?.detail || "Tree fetch failed");
      }
      const data = (await response.json()) as TreeNode[];
      // Cache the tree data
      treeCacheRef.current.set(selectedId, data);
      setCachedTreeBooks(prev => new Set([...prev, selectedId]));
      setTreeData(data);
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : "Tree fetch failed");
    } finally {
      setTreeLoading(false);
    }
  };

  const getTreeForBook = (bookIdStr: string): TreeNode[] => {
    return treeCacheRef.current.get(bookIdStr) || [];
  };

  const loadTreeForBooksInResults = async (resultsList: SearchResult[]) => {
    if (!resultsList || resultsList.length === 0) return;
    
    // Get unique book IDs from results
    const uniqueBookIds = new Set<string>();
    resultsList.forEach(result => {
      uniqueBookIds.add(result.node.book_id.toString());
    });

    // Load trees for any books we don't have cached yet
    for (const bookIdStr of uniqueBookIds) {
      if (!treeCacheRef.current.has(bookIdStr)) {
        try {
          const response = await fetch(`/api/books/${bookIdStr}/tree`, {
            credentials: "include",
          });
          if (response.ok) {
            const data = (await response.json()) as TreeNode[];
            treeCacheRef.current.set(bookIdStr, data);
            setCachedTreeBooks(prev => new Set([...prev, bookIdStr]));
          }
        } catch (err) {
          console.error(`Failed to load tree for book ${bookIdStr}:`, err);
        }
      }
    }
  };

  const formatValue = (value: unknown) => {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return value.toString();
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "[object]";
      }
    }
    return "";
  };

  // Helper function to build breadcrumb path for a node from tree
  const buildNodePath = (nodeId: number, nodes: TreeNode[]): TreeNode[] => {
    const path: TreeNode[] = [];
    
    const findNode = (id: number, nodeList: TreeNode[]): TreeNode | null => {
      for (const node of nodeList) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findNode(id, node.children);
          if (found) return found;
        }
      }
      return null;
    };

    // Build path from root to target node
    const buildFullPath = (id: number, nodeList: TreeNode[], currentPath: TreeNode[] = []): TreeNode[] | null => {
      for (const node of nodeList) {
        if (node.id === id) {
          return [...currentPath, node];
        }
        if (node.children) {
          const result = buildFullPath(id, node.children, [...currentPath, node]);
          if (result) return result;
        }
      }
      return null;
    };

    const fullPath = buildFullPath(nodeId, nodes);
    return fullPath || [];
  };

  const renderBreadcrumb = (result: SearchResult, bookName?: string) => {
    const bookBookId = result.node.book_id;
    const currentBook = books.find(b => b.id === bookBookId);
    // Use cached tree for the result's book
    const treeForBook = getTreeForBook(bookBookId.toString());

    let pathNodes: TreeNode[] = [];
    if (treeForBook.length > 0) {
      pathNodes = buildNodePath(result.node.id, treeForBook);
    }

    return (
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        <span className="font-medium">{bookName || currentBook?.book_name || "Book"}</span>
        {pathNodes.length > 0 && (
          <>
            <span className="text-zinc-400">/</span>
            {pathNodes.map((node, idx) => (
              <div key={`${node.id}-crumb`} className="flex items-center gap-1.5">
                <span className="text-zinc-500">
                  {node.title_english || node.title_sanskrit || node.title_transliteration || `${node.level_name} ${node.sequence_number || ''}`}
                </span>
                {idx < pathNodes.length - 1 && <span className="text-zinc-400">/</span>}
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.id} className="mt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className="rounded-full border border-black/10 bg-white/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500"
            style={{ marginLeft: `${depth * 12}px` }}
          >
            {formatValue(node.level_name) || "Level"}
          </span>
          {node.sequence_number !== null && node.sequence_number !== undefined && (
            <span className="text-xs text-zinc-500">#{node.sequence_number}</span>
          )}
          <button
            type="button"
            onClick={() => {
              window.location.href = "/scriptures";
            }}
            className="flex items-center gap-2 rounded-lg border-2 border-black/20 bg-blue-50 px-3 py-2 text-sm font-medium text-[color:var(--deep)] transition hover:border-[color:var(--accent)] hover:shadow-md"
          >
            <span>
              {formatValue(node.title_english) ||
                formatValue(node.title_sanskrit) ||
                formatValue(node.title_transliteration) ||
                `Verse ${node.sequence_number || node.id}`}
            </span>
            <span className="text-xs opacity-60">→</span>
          </button>
          {canContribute && (node.level_name?.toUpperCase() === "BOOK" || node.level_name?.toUpperCase() === "CHAPTER") && (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/contribute";
              }}
              title={`Add ${node.level_name?.toUpperCase() === "BOOK" ? "Chapter" : "Verse"}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-green-500/30 bg-green-50 text-sm text-green-700 transition hover:border-green-500/60 hover:shadow-md"
            >
              +
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/contribute";
              }}
              title="Edit"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-50 text-sm text-blue-700 transition hover:border-blue-500/60 hover:shadow-md"
            >
              ✎
            </button>
          )}
          {canAdmin && (
            <button
              type="button"
              onClick={async () => {
                if (window.confirm("Delete this node? This cannot be undone.")) {
                  try {
                    await fetch(contentPath(`/nodes/${node.id}`), {
                      method: "DELETE",
                      credentials: "include",
                    });
                    // Refresh the tree
                    if (bookId) {
                      loadTree(bookId);
                    }
                  } catch {
                    alert("Failed to delete");
                  }
                }
              }}
              title="Delete"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/30 bg-red-50 text-sm text-red-700 transition hover:border-red-500/60 hover:shadow-md"
            >
              🗑
            </button>
          )}
        </div>
        {node.children && node.children.length > 0 && (
          <div className="ml-3 border-l border-black/10 pl-3">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  const handleLogout = async () => {
    setAuthMessage(null);
    setAuthStatus(null);
    setAuthEmail(null);
    setCanAdmin(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      await loadAuthStatus();
      await loadBooks();
    }
  };

  return (
    <div className="grainy-bg min-h-screen">
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-20 px-6 pb-20 pt-10 sm:px-10">
        <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-6 order-2 lg:order-1">
            <h2 className="font-[var(--font-display)] text-4xl leading-tight text-[color:var(--deep)] sm:text-5xl">
              Search, reflect, discuss, and compose
            </h2>
            <p className="max-w-xl text-lg text-zinc-700">
              A new editorial platform for scripture library.
            </p>

            <div
              id="search"
              className="rounded-3xl border border-black/10 bg-white/70 p-4 shadow-lg"
            >
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search shloka, theme, or phrase"
                    className="flex-1 rounded-2xl border border-black/10 bg-white/90 px-4 py-3 text-sm text-zinc-800 outline-none ring-0 focus:border-[color:var(--accent)]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="rounded-2xl bg-[color:var(--accent)] px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[color:var(--clay)]"
                    >
                      {loading ? "Searching" : "Search"}
                    </button>
                    {(query || bookId || levelName || hasContent || results.length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setBookId("");
                          setLevelName("");
                          setHasContent(false);
                          setResults([]);
                          setTotal(0);
                          setError(null);
                          router.push("/", { scroll: false });
                        }}
                        className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-zinc-600 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        title="Clear search"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Book
                    </span>
                    <select
                      value={bookId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setBookId(value);
                        // Clear level name when book changes, as it may not be valid for the new book
                        setLevelName("");
                        loadTree(value);
                      }}
                      className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    >
                      <option value="">All books</option>
                      {books.map((book) => (
                        <option key={book.id} value={book.id.toString()}>
                          {book.book_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Level name
                    </span>
                    <select
                      value={levelName}
                      onChange={(event) => setLevelName(event.target.value)}
                      className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    >
                      <option value="">All levels</option>
                      {bookId && (() => {
                        const selectedBook = books.find(b => b.id.toString() === bookId);
                        if (selectedBook?.schema?.levels) {
                          return selectedBook.schema.levels.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ));
                        }
                        return null;
                      })()}
                      {!bookId && (() => {
                        const allLevels = new Set<string>();
                        books.forEach(book => {
                          book.schema?.levels?.forEach(level => allLevels.add(level));
                        });
                        return Array.from(allLevels).sort().map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ));
                      })()}
                    </select>
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={hasContent}
                      onChange={(event) => setHasContent(event.target.checked)}
                      className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)]"
                    />
                    Has content only
                  </label>
                </div>
              </form>
              {(error || results.length > 0) && (
                <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-zinc-500">
                    <span>Results</span>
                    <span>{total} found</span>
                  </div>
                  {error ? (
                    <p className="mt-3 text-sm text-[color:var(--accent)]">{error}</p>
                  ) : (
                    <div className="mt-4 grid gap-4">
                      {results.map((result) => {
                        // Build the destination URL with search context
                        const searchContext = new URLSearchParams();
                        searchContext.set("q", query);
                        if (bookId) searchContext.set("book_id", bookId);
                        if (levelName) searchContext.set("level_name", levelName);
                        if (hasContent) searchContext.set("has_content", "true");
                        
                        const destinationUrl = `/scriptures?book=${result.node.book_id}&node=${result.node.id}&from=search&searchContext=${encodeURIComponent(searchContext.toString())}`;
                        const bookName = books.find(b => b.id === result.node.book_id)?.book_name;
                        
                        return (
                        <div
                          key={result.node.id}
                          className="block rounded-2xl border border-black/5 bg-[color:var(--sand)] p-4 transition hover:border-[color:var(--accent)] hover:shadow-md"
                        >
                          {renderBreadcrumb(result, bookName)}
                          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                            <span>{result.node.level_name}</span>
                            {result.node.sequence_number !== null &&
                              result.node.sequence_number !== undefined && (
                                <span>#{result.node.sequence_number}</span>
                              )}
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <h4 className="font-[var(--font-display)] text-lg text-[color:var(--deep)]">
                                {result.node.title_english ||
                                  result.node.title_sanskrit ||
                                  result.node.title_transliteration ||
                                  "Untitled"}
                              </h4>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const bookName = books.find(b => b.id === result.node.book_id)?.book_name;
                                  addToBasket(
                                    result.node.id,
                                    result.node.title_english || result.node.title_sanskrit || `Node ${result.node.id}`,
                                    bookName,
                                    result.node.level_name
                                  );
                                }}
                                title="Add to basket"
                                className="rounded-lg border border-emerald-500/30 bg-emerald-50 px-2 py-2 text-emerald-700 transition hover:bg-emerald-100"
                              >
                                <ShoppingBasket size={16} />
                              </button>
                              <a
                                href={destinationUrl}
                                onClick={() => {
                                  const scrollY = window.scrollY;
                                  sessionStorage.setItem("searchScrollY", scrollY.toString());
                                }}
                                className="rounded-lg border border-blue-500/30 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                              >
                                View
                              </a>
                            </div>
                          </div>
                          {result.snippet ? (
                            <p
                              className="mt-2 text-sm text-zinc-700"
                              dangerouslySetInnerHTML={{ __html: result.snippet }}
                            />
                          ) : (
                            <p className="mt-2 text-sm text-zinc-700">
                              {result.node.content_data?.translations?.english ||
                                "No snippet available."}
                            </p>
                          )}
                          <div className="mt-3 text-xs text-[color:var(--accent)] hover:underline">
                            View details →
                          </div>
                        </div>
                      )})}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6 order-1 lg:order-2">
            <div className="rounded-[28px] border border-black/10 bg-white/80 p-6">
              <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Library at a glance
              </h4>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                {[
                  { label: "Books", value: stats?.books_count?.toLocaleString() || "—" },
                  { label: "Verses", value: stats?.nodes_count?.toLocaleString() || "—" },
                  { label: "Contributors", value: stats?.users_count?.toLocaleString() || "—" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-2xl bg-[color:var(--paper)] p-4">
                    <p className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                      {stat.value}
                    </p>
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {verseMode === "daily" ? "Daily Verse" : "Random Verse"}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVerseMode("daily");
                      loadDailyVerse("daily");
                    }}
                    className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] transition ${
                      verseMode === "daily"
                        ? "bg-[color:var(--accent)] text-white"
                        : "border border-black/10 bg-white/80 text-zinc-600 hover:border-[color:var(--accent)]"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVerseMode("random");
                      loadDailyVerse("random");
                    }}
                    className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] transition ${
                      verseMode === "random"
                        ? "bg-[color:var(--accent)] text-white"
                        : "border border-black/10 bg-white/80 text-zinc-600 hover:border-[color:var(--accent)]"
                    }`}
                  >
                    Random
                  </button>
                </div>
              </div>
              {!dailyVerse ? (
                <>
                  <h3 className="mt-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    Loading...
                  </h3>
                  <p className="mt-3 text-sm text-zinc-600">
                    Fetching a verse from the library...
                  </p>
                </>
              ) : dailyVerse.id === 0 ? (
                <>
                  <h3 className="mt-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    No verses yet
                  </h3>
                  <p className="mt-3 text-sm text-zinc-600">
                    Add content to your books to see a verse here.
                  </p>
                  <div className="mt-6 rounded-2xl border border-black/5 bg-[color:var(--sand)] p-4 text-sm text-[color:var(--deep)]">
                    <p className="text-sm text-zinc-700">
                      Visit the <a href="/scriptures" className="text-[color:var(--accent)] hover:underline">Scriptures</a> page to browse books, or go to <a href="/explorer" className="text-[color:var(--accent)] hover:underline">Explorer</a> to start building your collection.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="mt-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {dailyVerse.book_name}
                  </h3>
                  <p className="mt-3 text-sm text-zinc-600">
                    {verseMode === "daily" 
                      ? "Today's verse from the library."
                      : "A randomly selected verse."}
                  </p>
                  <div className="mt-6 rounded-2xl border border-black/5 bg-[color:var(--sand)] p-4 text-sm text-[color:var(--deep)]">
                    <p className="font-semibold">{dailyVerse.title}</p>
                    <p className="mt-2 text-sm text-zinc-700">
                      {dailyVerse.content || "Content not available"}
                    </p>
                    {dailyVerse.book_id > 0 && dailyVerse.node_id && (
                      <a
                        href={`/scriptures?book=${dailyVerse.book_id}&node=${dailyVerse.node_id}`}
                        className="mt-3 inline-block text-xs text-[color:var(--accent)] hover:underline"
                      >
                        Read more →
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Floating Basket Panel */}
      <BasketPanel
        items={basketItems}
        onRemoveItem={removeFromBasket}
        onClearBasket={clearBasket}
        onItemsAdded={() => {
          // Refresh or handle after items are added to book
        }}
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}> 
      <HomeContent />
    </Suspense>
  );
}
