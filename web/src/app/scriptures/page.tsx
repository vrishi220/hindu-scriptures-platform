"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { contentPath } from "../../lib/apiPaths";

type BookOption = {
  id: number;
  book_name: string;
  schema_id?: number | null;
};

type BookDetails = {
  id: number;
  book_name: string;
  schema_id: number | null;
  schema?: {
    id: number;
    name: string;
    levels: string[];
  } | null;
};

type SchemaOption = {
  id: number;
  name: string;
  description: string | null;
  levels: string[];
};

type TreeNode = {
  id: number;
  level_name: string;
  level_order?: number;
  sequence_number?: string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TreeNode[];
};

type NodeContent = {
  id: number;
  level_name: string;
  level_order?: number;
  sequence_number?: string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content: boolean;
  content_data?: {
    basic?: {
      sanskrit?: string;
      transliteration?: string;
      translation?: string;
    };
    translations?: {
      english?: string;
    };
  } | null;
  tags?: string[] | null;
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

const parseSequenceNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = value.toString().match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
};

const getSequenceSortValue = (node: TreeNode) => {
  const direct = parseSequenceNumber(node.sequence_number);
  if (direct !== null) return direct;
  const titleCandidate =
    node.title_english || node.title_sanskrit || node.title_transliteration;
  const titleSeq = titleCandidate ? parseSequenceNumber(titleCandidate) : null;
  if (titleSeq !== null) return titleSeq;
  return node.id;
};

const formatSequenceDisplay = (value: unknown, isLeaf: boolean) => {
  const parsed = parseSequenceNumber(value);
  if (parsed === null) return "";
  if (!isLeaf) return parsed.toString();
  return parsed.toString();
};

function ScripturesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookId, setBookId] = useState("");
  const [currentBook, setCurrentBook] = useState<BookDetails | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [urlInitialized, setUrlInitialized] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<TreeNode[]>([]);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<"book" | "node" | "leaf" | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [nodeContent, setNodeContent] = useState<NodeContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [actionNode, setActionNode] = useState<TreeNode | null>(null);
  const [action, setAction] = useState<"add" | "edit" | null>(null);
  const [searchReturnUrl, setSearchReturnUrl] = useState<string | null>(null);
  const lastTreeBookId = useRef<string | null>(null);
  const lastAutoSelectNodeId = useRef<number | null>(null);
  const lastLoadedNodeId = useRef<number | null>(null);
  const activeTreeRequestId = useRef(0);
  const activeTreeAbortController = useRef<AbortController | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"tree" | "content">("tree");
  const [formData, setFormData] = useState({
    levelName: "",
    titleSanskrit: "",
    titleTransliteration: "",
    titleEnglish: "",
    sequenceNumber: "",
    hasContent: true,
    contentSanskrit: "",
    contentTransliteration: "",
    contentEnglish: "",
    tags: "",
  });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [schemas, setSchemas] = useState<SchemaOption[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
  const [bookFormData, setBookFormData] = useState({
    bookName: "",
    bookCode: "",
    languagePrimary: "sanskrit",
  });
  const [bookSubmitting, setBookSubmitting] = useState(false);

  const loadAuth = async () => {
    try {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) {
        setAuthEmail(null);
        setAuthStatus("Not authenticated");
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
    } catch {
      setAuthStatus("Auth check failed");
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
    }
  };

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    if (selectedId) {
      setMobilePanel("content");
    }
  }, [selectedId]);

  // Sync state from URL parameters (supports back/forward navigation)
  useEffect(() => {
    const bookParam = searchParams.get("book") || "";
    const fromSearch = searchParams.get("from");
    const searchContext = searchParams.get("searchContext");
    
    // Store search return URL if came from search
    if (fromSearch === "search" && searchContext) {
      const returnUrl = `/?${searchContext}`;
      setSearchReturnUrl(returnUrl);
    } else {
      setSearchReturnUrl(null);
    }

    if (!bookParam) {
      if (bookId) setBookId("");
      if (!urlInitialized) setUrlInitialized(true);
      return;
    }

    if (bookParam !== bookId) {
      setBookId(bookParam);
    }

    if (!urlInitialized) setUrlInitialized(true);
  }, [searchParams.get("book"), searchParams.get("from"), searchParams.get("searchContext"), bookId, urlInitialized]);

  // Watch for book ID changes and load tree with optional node auto-selection
  useEffect(() => {
    if (!bookId || !urlInitialized) return;

    const nodeParam = searchParams.get("node");
    const nodeId = nodeParam ? parseInt(nodeParam, 10) : undefined;

    if (lastTreeBookId.current !== bookId) {
      lastTreeBookId.current = bookId;
      lastAutoSelectNodeId.current = nodeId ?? null;
      loadTree(bookId, nodeId);
      return;
    }

    if (nodeId) {
      const path = findPath(treeData, nodeId);
      if (path) {
        if (selectedId !== nodeId || nodeContent?.id !== nodeId) {
          applySelection(nodeId, path);
        }
        lastAutoSelectNodeId.current = nodeId;
        return;
      }

      if (lastAutoSelectNodeId.current !== nodeId) {
        lastAutoSelectNodeId.current = nodeId;
        loadTree(bookId, nodeId);
      }
      return;
    }

    lastAutoSelectNodeId.current = null;
    if (selectedId) {
      setSelectedId(null);
      setBreadcrumb([]);
      setNodeContent(null);
    }
  }, [bookId, urlInitialized, searchParams.get("node"), selectedId, nodeContent?.id]);

  useEffect(() => {
    const loadBooks = async () => {
      try {
        const response = await fetch("/api/books", {
          credentials: "include",
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as BookOption[];
        setBooks(data);
      } catch {
        setBooks([]);
      }
    };
    loadBooks();
  }, []);

  const loadTree = async (selectedId: string, autoSelectNodeId?: number) => {
    activeTreeAbortController.current?.abort();
    const abortController = new AbortController();
    activeTreeAbortController.current = abortController;
    const requestId = activeTreeRequestId.current + 1;
    activeTreeRequestId.current = requestId;

    if (!selectedId) {
      setTreeData([]);
      setTreeError(null);
      setExpandedIds(new Set());
      setSelectedId(null);
      setBreadcrumb([]);
      setCurrentBook(null);
      return;
    }

    setTreeLoading(true);
    setTreeError(null);
    try {
        const detailsResponse = await fetch(`/api/books/${selectedId}`, {
          credentials: "include",
          signal: abortController.signal,
        });
        if (requestId !== activeTreeRequestId.current) return;
        if (detailsResponse.ok) {
          const detailsData = (await detailsResponse.json()) as BookDetails;
          if (requestId !== activeTreeRequestId.current) return;
          setCurrentBook(detailsData);
        } else {
          setCurrentBook(null);
        }

      const response = await fetch(`/api/books/${selectedId}/tree`, {
        credentials: "include",
          signal: abortController.signal,
      });
        if (requestId !== activeTreeRequestId.current) return;
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(payload?.detail || "Tree fetch failed");
      }
      const data = (await response.json()) as TreeNode[];
        if (requestId !== activeTreeRequestId.current) return;
      setTreeData(data);
      setExpandedIds(new Set());
      
      // Auto-select node if provided in params
      if (autoSelectNodeId) {
        const path = findPath(data, autoSelectNodeId);
        if (path) {
          applySelection(autoSelectNodeId, path, true);
        }
      } else {
        setSelectedId(null);
        setBreadcrumb([]);
        setExpandedIds(new Set());
      }
      
      setUrlInitialized(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeTreeRequestId.current) return;
      setTreeError(err instanceof Error ? err.message : "Tree fetch failed");
      setUrlInitialized(true);
    } finally {
      if (requestId === activeTreeRequestId.current) {
        setTreeLoading(false);
      }
    }
  };

  const findPath = (nodes: TreeNode[], targetId: number): TreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return [node];
      }
      if (node.children && node.children.length > 0) {
        const childPath = findPath(node.children, targetId);
        if (childPath) {
          return [node, ...childPath];
        }
      }
    }
    return null;
  };

  const toggleNode = (nodeId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const loadNodeContent = async (nodeId: number, force = false) => {
    if (!force && contentLoading && lastLoadedNodeId.current === nodeId) return;
    if (!force && !contentLoading && nodeContent?.id === nodeId) return;
    lastLoadedNodeId.current = nodeId;
    setContentLoading(true);
    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}`), {
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as NodeContent;
        setNodeContent(data);
      } else {
        setNodeContent(null);
      }
    } catch (err) {
      console.error("Content load error:", err);
      setNodeContent(null);
    } finally {
      setContentLoading(false);
    }
  };

  const scrollToNode = (nodeId: number) => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`tree-node-${nodeId}`);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  };

  const applySelection = (
    nodeId: number,
    path: TreeNode[],
    scroll = false,
    skipLoad = false
  ) => {
    setSelectedId(nodeId);
    setBreadcrumb(path);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      path.forEach((node) => next.add(node.id));
      return next;
    });
    if (!skipLoad) {
      loadNodeContent(nodeId);
    }
    if (scroll) {
      scrollToNode(nodeId);
    }
  };

  const selectNode = (nodeId: number, syncUrl = true) => {
    const path = findPath(treeData, nodeId);
    if (path) {
      applySelection(nodeId, path, false, syncUrl);
    } else {
      setSelectedId(nodeId);
      setBreadcrumb([]);
      if (!syncUrl) {
        loadNodeContent(nodeId);
      }
    }
    
    // Update URL with current selection
    if (syncUrl && bookId) {
      router.push(`/scriptures?book=${bookId}&node=${nodeId}`, { scroll: false });
    }
  };

  const loadSchemas = async () => {
    try {
      const response = await fetch(contentPath("/schemas"), {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as SchemaOption[];
        setSchemas(data);
      }
    } catch {
      // Ignore errors
    }
  };

  const loadBooksRefresh = async () => {
    try {
      const response = await fetch("/api/books", {
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as BookOption[];
        setBooks(data);
      }
    } catch {
      // Ignore errors
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchema) return;

    setBookSubmitting(true);
    try {
      const payload = {
        schema_id: selectedSchema,
        book_name: bookFormData.bookName,
        book_code: bookFormData.bookCode || null,
        language_primary: bookFormData.languagePrimary,
        metadata: {},
      };

      const response = await fetch("/api/books", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const newBook = (await response.json()) as BookOption;
        // Close modal and reset form
        setShowCreateBook(false);
        setSelectedSchema(null);
        setBookFormData({
          bookName: "",
          bookCode: "",
          languagePrimary: "sanskrit",
        });
        // Refresh books list and select the new book
        await loadBooksRefresh();
        setBookId(newBook.id.toString());
        router.push(`/scriptures?book=${newBook.id}`, { scroll: false });
        loadTree(newBook.id.toString());
      } else {
        const errData = await response.json();
        alert(errData.detail || "Failed to create book");
      }
    } catch (err) {
      console.error("Error creating book:", err);
      alert("Failed to create book");
    } finally {
      setBookSubmitting(false);
    }
  };

  const findNodeById = (nodes: TreeNode[], id: number): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children && node.children.length > 0) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const buildFormDataFromNode = (node: NodeContent) => {
    const contentBasic = node.content_data?.basic;
    const contentTranslations = node.content_data?.translations;
    const englishTranslation =
      contentTranslations?.english || contentBasic?.translation || "";
    const hasContent = Boolean(
      node.has_content ||
        contentBasic?.sanskrit ||
        contentBasic?.transliteration ||
        contentBasic?.translation ||
        contentTranslations?.english
    );

    return {
      levelName: node.level_name || "",
      titleSanskrit: node.title_sanskrit || "",
      titleTransliteration: node.title_transliteration || "",
      titleEnglish: node.title_english || "",
      sequenceNumber: node.sequence_number !== null && node.sequence_number !== undefined
        ? node.sequence_number.toString()
        : "",
      hasContent,
      contentSanskrit: contentBasic?.sanskrit || "",
      contentTransliteration: contentBasic?.transliteration || "",
      contentEnglish: englishTranslation,
      tags: node.tags?.join(", ") || "",
    };
  };

  const normalizeLevelName = (value: string) => value.trim().toLowerCase();

  const isLeafLevelName = (levelName: string): boolean => {
    const schemaLevels = currentBook?.schema?.levels;
    if (!schemaLevels || schemaLevels.length === 0 || !levelName) {
      return false;
    }
    const lastLevel = schemaLevels[schemaLevels.length - 1];
    return normalizeLevelName(lastLevel) === normalizeLevelName(levelName);
  };

  const getLevelIndexFromName = (levelName: string, schemaLevels: string[]) => {
    if (!levelName) return -1;
    const normalized = normalizeLevelName(levelName);
    return schemaLevels.findIndex(
      (level) => normalizeLevelName(level) === normalized
    );
  };

  const getNextLevelName = (parentNode: TreeNode): string => {
    if (!currentBook?.schema?.levels) {
      return ""; // No schema, can't determine
    }

    const schemaLevels = currentBook.schema.levels;

    // If parent is BOOK, return first level
    if (parentNode.level_name?.toUpperCase() === "BOOK") {
      return schemaLevels[0] || "";
    }

    // Prefer level_name to locate next level; fall back to level_order
    const levelIndex = getLevelIndexFromName(parentNode.level_name, schemaLevels);
    if (levelIndex >= 0 && levelIndex + 1 < schemaLevels.length) {
      return schemaLevels[levelIndex + 1];
    }

    const parentLevelOrder = parentNode.level_order || 0;
    const nextLevelIndex = parentLevelOrder; // level_order 1 = index 0

    if (nextLevelIndex < schemaLevels.length) {
      return schemaLevels[nextLevelIndex];
    }

    return ""; // Beyond defined levels
  };

  const canAddChild = (node: TreeNode): boolean => {
    if (!currentBook?.schema?.levels) {
      return false; // No schema, don't show add button
    }

    const schemaLevels = currentBook.schema.levels;

    // If it's a BOOK node, can add first level
    if (node.level_name?.toUpperCase() === "BOOK") {
      return schemaLevels.length > 0;
    }

    const levelIndex = getLevelIndexFromName(node.level_name, schemaLevels);
    if (levelIndex >= 0) {
      return levelIndex + 1 < schemaLevels.length;
    }

    // Fall back to level_order check
    const parentLevelOrder = node.level_order || 0;
    const nextLevelIndex = parentLevelOrder + 1;

    return nextLevelIndex < schemaLevels.length;
  };

  const getSiblings = (): TreeNode[] => {
    if (breadcrumb.length <= 1) {
      // Current node is root or no parent
      return treeData;
    }
    const parent = breadcrumb[breadcrumb.length - 2];
    const siblings = parent.children || [];
    // Sort by sequence_number for consistent ordering
    return [...siblings].sort((a, b) => {
      const seqA = getSequenceSortValue(a);
      const seqB = getSequenceSortValue(b);
      return seqA - seqB;
    });
  };

  // Get all nodes in the tree flattened in depth-first order
  const getAllNodesInOrder = (): TreeNode[] => {
    const nodes: TreeNode[] = [];
    const traverse = (node: TreeNode) => {
      nodes.push(node);
      if (node.children && node.children.length > 0) {
        // Sort children by sequence_number for consistent ordering
        const sorted = [...node.children].sort((a, b) => {
          const seqA = getSequenceSortValue(a);
          const seqB = getSequenceSortValue(b);
          return seqA - seqB;
        });
        sorted.forEach((child) => traverse(child));
      }
    };
    const sortedRoots = [...treeData].sort((a, b) => {
      const seqA = getSequenceSortValue(a);
      const seqB = getSequenceSortValue(b);
      return seqA - seqB;
    });
    sortedRoots.forEach((root) => traverse(root));
    return nodes;
  };

  const getPreviousSibling = (): TreeNode | null => {
    if (!selectedId) return null;
    const allNodes = getAllNodesInOrder();
    const currentIndex = allNodes.findIndex((n) => n.id === selectedId);
    if (currentIndex <= 0) return null;
    return allNodes[currentIndex - 1];
  };

  const getNextSibling = (): TreeNode | null => {
    if (!selectedId) return null;
    const allNodes = getAllNodesInOrder();
    const currentIndex = allNodes.findIndex((n) => n.id === selectedId);
    if (currentIndex < 0 || currentIndex >= allNodes.length - 1) return null;
    return allNodes[currentIndex + 1];
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionNode || !action) return;

    setSubmitting(true);
    setActionMessage(null);
    try {
      const contentData: Record<string, unknown> = {};
      if (formData.hasContent) {
        contentData.basic = {
          sanskrit: formData.contentSanskrit || undefined,
          transliteration: formData.contentTransliteration || undefined,
          translation: formData.contentEnglish || undefined,
        };
        contentData.translations = {
          english: formData.contentEnglish || undefined,
        };
      }

      // Calculate level_order based on parent node
      let levelOrder = 1;
      if (action === "add" && actionNode) {
        // When adding a child node
        if (actionNode.level_name?.toUpperCase() === "BOOK") {
          // Adding to book root, this is level 1
          levelOrder = 1;
        } else if (actionNode.level_order !== undefined) {
          // Use parent's level_order + 1
          levelOrder = actionNode.level_order + 1;
        } else {
          // Fallback based on level name
          if (actionNode.level_name?.toUpperCase() === "CHAPTER") {
            levelOrder = 2;
          } else {
            levelOrder = 3;
          }
        }
      }

      const basePayload = {
        level_name: formData.levelName,
        sequence_number: formData.sequenceNumber || null,
        title_sanskrit: formData.titleSanskrit || null,
        title_transliteration: formData.titleTransliteration || null,
        title_english: formData.titleEnglish || null,
        has_content: formData.hasContent,
        content_data: Object.keys(contentData).length > 0 ? contentData : null,
        tags: formData.tags ? formData.tags.split(",").map((t) => t.trim()) : [],
      };

      const payload =
        action === "add"
          ? {
              ...basePayload,
              book_id: parseInt(bookId, 10),
              parent_node_id: actionNode.level_name === "BOOK" ? null : actionNode.id,
              level_order: levelOrder,
            }
          : basePayload;

      const response = await fetch(
        action === "add" ? contentPath("/nodes") : contentPath(`/nodes/${actionNode.id}`),
        {
          method: action === "add" ? "POST" : "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        const updatedNodeId = action === "add" ? null : actionNode.id;
        const wasEdit = action === "edit";
        // Reset form and close modal
        setAction(null);
        setActionNode(null);
        setActionMessage(null);
        setFormData({
          levelName: "",
          titleSanskrit: "",
          titleTransliteration: "",
          titleEnglish: "",
          sequenceNumber: "",
          hasContent: false,
          contentSanskrit: "",
          contentTransliteration: "",
          contentEnglish: "",
          tags: "",
        });
        // Refresh tree without losing context
        if (bookId) {
          setTreeLoading(true);
          try {
            const response = await fetch(`/api/books/${bookId}/tree`, {
              credentials: "include",
            });
            if (response.ok) {
              const data = (await response.json()) as TreeNode[];
              setTreeData(data);
              setExpandedIds((prev) => new Set(prev));
              if (selectedId) {
                const path = findPath(data, selectedId);
                if (path) {
                  setBreadcrumb(path);
                }
              }
            }
          } finally {
            setTreeLoading(false);
          }
        }
        if (wasEdit && updatedNodeId) {
          await loadNodeContent(updatedNodeId, true);
        }
      } else {
        const errorText = await response.text();
        const errData = errorText
          ? (() => {
              try {
                return JSON.parse(errorText);
              } catch {
                return errorText;
              }
            })()
          : null;
        const detail =
          typeof errData === "string"
            ? errData
            : errData?.detail || response.statusText;
        setActionMessage(`Save failed (${response.status}): ${detail}`);
        console.error("Error response:", errData || response.statusText);
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Save failed.");
      console.error("Error submitting form:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    // Sort nodes by sequence_number
    const sorted = [...nodes].sort((a, b) => {
      const seqA = parseSequenceNumber(a.sequence_number) ?? Infinity;
      const seqB = parseSequenceNumber(b.sequence_number) ?? Infinity;
      return seqA - seqB;
    });
    
    return sorted.map((node) => (
      <div key={node.id} className="mt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {node.children && node.children.length > 0 && (
            <button
              type="button"
              onClick={() => toggleNode(node.id)}
              className="h-6 w-6 rounded-full border border-black/10 bg-white/80 text-xs text-zinc-500 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              style={{ marginLeft: `${depth * 12}px` }}
            >
              {expandedIds.has(node.id) ? "-" : "+"}
            </button>
          )}
          <button
            type="button"
            onClick={() => selectNode(node.id)}
            title={`${formatValue(node.level_name) || "Level"} ${
              formatSequenceDisplay(
                node.sequence_number ?? node.id,
                !node.children || node.children.length === 0
              ) || node.id
            }`}
            id={`tree-node-${node.id}`}
            className={`flex items-center gap-2 px-1 text-sm font-medium transition ${
              selectedId === node.id
                ? "text-[color:var(--accent)]"
                : "text-[color:var(--deep)] hover:text-[color:var(--accent)]"
            }`}
          >
            <span>
              {(() => {
                const isLeaf = !node.children || node.children.length === 0;
                const displaySeq =
                  formatSequenceDisplay(node.sequence_number ?? node.id, isLeaf) ||
                  node.id.toString();
                const titleText =
                  formatValue(node.title_english) ||
                  formatValue(node.title_sanskrit) ||
                  formatValue(node.title_transliteration);
                if (isLeaf) {
                  return titleText
                    ? titleText
                    : `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
                }
                if (titleText) {
                  return `${displaySeq}. ${titleText}`;
                }
                if (node.children && node.children.length > 0) {
                  return `${displaySeq}. Untitled`;
                }
                return `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
              })()}
            </span>
          </button>
          {canContribute && canAddChild(node) && (
            <button
              type="button"
              onClick={() => {
                const nextLevel = getNextLevelName(node);
                const defaultHasContent = isLeafLevelName(nextLevel);
                setActionNode(node);
                setFormData({
                  levelName: nextLevel,
                  titleSanskrit: "",
                  titleTransliteration: "",
                  titleEnglish: "",
                  sequenceNumber: "",
                  hasContent: defaultHasContent,
                  contentSanskrit: "",
                  contentTransliteration: "",
                  contentEnglish: "",
                  tags: "",
                });
                setAction("add");
              }}
              title={`Add ${getNextLevelName(node)}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-green-500/30 bg-green-50 text-sm text-green-700 transition hover:border-green-500/60 hover:shadow-md"
            >
              +
            </button>
          )}
        </div>
        {node.children && node.children.length > 0 && expandedIds.has(node.id) && (
          <div className="ml-3 border-l border-black/10 pl-3">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      router.push("/");
    } catch {
      router.push("/");
    }
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
      setAuthMessage("Logged in.");
      setEmail("");
      setPassword("");
      setShowLogin(false);
      await loadAuth();
      // Re-initialize from URL after successful login
      setUrlInitialized(false);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    }
  };

  const selectedTreeNode = selectedId ? findNodeById(treeData, selectedId) : null;
  const isLeafSelected = Boolean(
    selectedTreeNode && (!selectedTreeNode.children || selectedTreeNode.children.length === 0)
  );
  const isCopyMessage = authMessage === "Link copied.";

  return (
    <div className="grainy-bg min-h-screen">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 pt-8 sm:gap-10 sm:px-6 sm:pb-20 sm:pt-12">
        {searchReturnUrl && (
          <div className="flex items-center gap-2">
            <a
              href={searchReturnUrl}
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--accent)] bg-white px-4 py-2 text-sm font-medium text-[color:var(--accent)] transition hover:bg-[color:var(--accent)] hover:text-white"
            >
              ← Back to Search Results
            </a>
          </div>
        )}
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Library</p>
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
            Scripture browser
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Explore the canon by book. Select a scripture to see its nested structure.
          </p>
        </header>

        <section className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-lg sm:rounded-[32px] sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Book
              </span>
              <select
                value={bookId}
                onChange={(event) => {
                  const value = event.target.value;
                  setBookId(value);
                  // Update URL without node param when changing books
                  if (value) {
                    router.push(`/scriptures?book=${value}`, { scroll: false });
                  } else {
                    router.push("/scriptures", { scroll: false });
                  }
                  setSelectedId(null);
                  setBreadcrumb([]);
                }}
                className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
              >
                <option value="">Select a book</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id.toString()}>
                    {book.book_name}
                  </option>
                ))}
              </select>
            </label>
            {bookId && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/scriptures?book=${bookId}`;
                    navigator.clipboard.writeText(url);
                    setAuthMessage("Link copied.");
                    setCopyTarget("book");
                    setTimeout(() => {
                      setAuthMessage(null);
                      setCopyTarget(null);
                    }, 2000);
                  }}
                  title="Copy book link"
                  className="rounded-full border border-blue-500/30 bg-blue-50/50 px-3 py-1 text-xs uppercase tracking-[0.2em] text-blue-700 transition hover:border-blue-500/60 hover:bg-blue-50"
                >
                  🔗
                </button>
                {isCopyMessage && copyTarget === "book" && !showLogin && (
                  <div className="rounded-full bg-blue-500 px-3 py-1 text-[10px] text-white shadow">
                    {authMessage}
                  </div>
                )}
              </div>
            )}
            {canContribute && (
              <button
                type="button"
                onClick={() => {
                  loadSchemas();
                  setShowCreateBook(true);
                }}
                className="rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-700 transition hover:border-emerald-500/60 hover:shadow-sm"
              >
                + Create Book
              </button>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 lg:hidden">
            <button
              type="button"
              onClick={() => setMobilePanel("tree")}
              aria-pressed={mobilePanel === "tree"}
              className={`rounded-full border px-3 py-1 transition ${
                mobilePanel === "tree"
                  ? "border-[color:var(--accent)] text-[color:var(--accent)]"
                  : "border-black/10 bg-white/80"
              }`}
            >
              Tree
            </button>
            <button
              type="button"
              onClick={() => setMobilePanel("content")}
              aria-pressed={mobilePanel === "content"}
              className={`rounded-full border px-3 py-1 transition ${
                mobilePanel === "content"
                  ? "border-[color:var(--accent)] text-[color:var(--accent)]"
                  : "border-black/10 bg-white/80"
              }`}
            >
              Details
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-3 lg:h-[calc(100vh-280px)]">
            {/* Tree Section */}
            <div
              className={`lg:col-span-1 min-h-0 rounded-2xl border border-black/10 bg-white/90 p-4 lg:flex lg:h-full lg:flex-col ${
                mobilePanel === "tree" ? "block" : "hidden"
              } lg:block`}
            >
              <div className="sticky top-0 z-10 bg-white/90 pb-3">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-zinc-500">
                  <span>
                    {books.find(b => b.id.toString() === bookId)?.book_name || "Nested tree"}
                  </span>
                  <div className="flex items-center gap-2">
                    {treeLoading && <span>Loading</span>}
                  </div>
                </div>
                {bookId && (
                  <div className="mt-2 flex items-center gap-2">
                    {canContribute && currentBook?.schema && (
                      <button
                        type="button"
                        onClick={() => {
                          // Create a virtual "book" node to use as parent
                          const virtualBook: TreeNode = {
                            id: parseInt(bookId, 10),
                            level_name: "BOOK",
                            level_order: 0,
                            sequence_number: undefined,
                            title_english: books.find(b => b.id.toString() === bookId)?.book_name,
                          };
                          const firstLevel = currentBook.schema?.levels[0] || "";
                          const defaultHasContent = isLeafLevelName(firstLevel);
                          setActionNode(virtualBook);
                          setFormData({
                            levelName: firstLevel,
                            titleSanskrit: "",
                            titleTransliteration: "",
                            titleEnglish: "",
                            sequenceNumber: "",
                            hasContent: defaultHasContent,
                            contentSanskrit: "",
                            contentTransliteration: "",
                            contentEnglish: "",
                            tags: "",
                          });
                          setAction("add");
                        }}
                        title={`Add ${currentBook.schema?.levels[0] || "Node"}`}
                        className="rounded-full border border-green-500/30 bg-green-50 px-2 py-1 text-xs text-green-700 transition hover:border-green-500/60 hover:shadow-md"
                      >
                        + Add
                      </button>
                    )}
                    {currentBook?.schema?.levels && currentBook.schema.levels.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIds(new Set(treeData.map((node) => node.id)))
                          }
                          className="rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          Expand all
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedIds(new Set())}
                          className="rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          Collapse all
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {treeError && (
                  <p className="mt-3 text-sm text-[color:var(--accent)]">{treeError}</p>
                )}
                {!treeLoading && !treeError && treeData.length === 0 && bookId && (
                  <p className="mt-3 text-sm text-zinc-600">No nodes yet.</p>
                )}
                {!treeLoading && !treeError && treeData.length > 0 && (
                  <div className="mt-4">{renderTree(treeData)}</div>
                )}
              </div>
            </div>

            {/* Content Section */}
            <div
              className={`lg:col-span-2 min-h-0 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-lg sm:p-6 lg:h-full lg:overflow-y-auto lg:overscroll-contain ${
                mobilePanel === "content" ? "block" : "hidden"
              } lg:block`}
            >
              {breadcrumb.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
                  <div className="flex flex-wrap items-center gap-2">
                    {breadcrumb.map((node, index) => (
                      <span key={node.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => selectNode(node.id)}
                          className={`rounded-full border border-black/10 px-3 py-1 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] ${
                            selectedId === node.id
                              ? "bg-[color:var(--sand)] text-[color:var(--accent)]"
                              : "bg-white/80"
                          }`}
                        >
                          {(() => {
                            const isLeaf = !node.children || node.children.length === 0;
                            const displaySeq =
                              formatSequenceDisplay(
                                node.sequence_number || node.id,
                                isLeaf
                              ) || node.id;
                            const titleText =
                              formatValue(node.title_english) ||
                              formatValue(node.title_sanskrit) ||
                              formatValue(node.title_transliteration);
                            if (isLeaf) {
                              return titleText
                                ? titleText
                                : `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
                            }
                            return titleText || `Verse ${displaySeq}`;
                          })()}
                        </button>
                        {index < breadcrumb.length - 1 && <span>/</span>}
                      </span>
                    ))}
                  </div>
                  {selectedId && !isLeafSelected && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
                          navigator.clipboard.writeText(url);
                          setAuthMessage("Link copied.");
                          setCopyTarget("node");
                          setTimeout(() => {
                            setAuthMessage(null);
                            setCopyTarget(null);
                          }, 2000);
                        }}
                        title="Copy shareable link"
                        className="ml-auto rounded-full border border-blue-500/30 bg-blue-50/50 p-1 text-blue-700 transition hover:border-blue-500/60 hover:bg-blue-50"
                      >
                        🔗
                      </button>
                      {isCopyMessage && copyTarget === "node" && !showLogin && (
                        <div className="ml-2 rounded-full bg-blue-500 px-3 py-1 text-xs text-white shadow">
                          {authMessage}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {selectedId && nodeContent ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                      {(() => {
                        const displaySeq =
                          formatSequenceDisplay(
                            nodeContent.sequence_number ?? nodeContent.id,
                            Boolean(nodeContent.has_content)
                          ) || nodeContent.id;
                        return `${formatValue(nodeContent.level_name) || "Level"} ${displaySeq}`;
                      })()}
                    </h2>
                    <div className="flex items-center gap-2">
                      {contentLoading && (
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                          Loading...
                        </span>
                      )}
                      <div className="flex items-center gap-1 border-l pl-2 border-black/10">
                        <button
                          type="button"
                          onClick={() => {
                            const prev = getPreviousSibling();
                            if (prev) selectNode(prev.id);
                          }}
                          disabled={!getPreviousSibling()}
                          title="Previous item"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/30 bg-zinc-50/80 text-sm text-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-zinc-500/60 hover:enabled:shadow-md"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const next = getNextSibling();
                            if (next) selectNode(next.id);
                          }}
                          disabled={!getNextSibling()}
                          title="Next item"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/30 bg-zinc-50/80 text-sm text-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-zinc-500/60 hover:enabled:shadow-md"
                        >
                          →
                        </button>
                      </div>
                      {isLeafSelected && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
                              navigator.clipboard.writeText(url);
                              setAuthMessage("Link copied.");
                              setCopyTarget("leaf");
                              setTimeout(() => {
                                setAuthMessage(null);
                                setCopyTarget(null);
                              }, 2000);
                            }}
                            title="Copy shareable link"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-50 text-sm text-blue-700 transition hover:border-blue-500/60 hover:shadow-md"
                          >
                            🔗
                          </button>
                          {isCopyMessage && copyTarget === "leaf" && !showLogin && (
                            <div className="rounded-full bg-blue-500 px-3 py-1 text-xs text-white shadow">
                              {authMessage}
                            </div>
                          )}
                        </>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!nodeContent) return;
                            const foundNode = findNodeById(treeData, selectedId);
                            const fallbackNode: TreeNode = foundNode || {
                              id: nodeContent.id,
                              level_name: nodeContent.level_name,
                              level_order: nodeContent.level_order,
                              sequence_number: nodeContent.sequence_number ?? null,
                              title_english: nodeContent.title_english ?? null,
                              title_sanskrit: nodeContent.title_sanskrit ?? null,
                              title_transliteration: nodeContent.title_transliteration ?? null,
                              children: [],
                            };
                            setActionNode(fallbackNode);
                            setFormData(buildFormDataFromNode(nodeContent));
                            setAction("edit");
                          }}
                          title="Edit"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-50 text-sm text-blue-700 transition hover:border-blue-500/60 hover:shadow-md"
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
                                await fetch(contentPath(`/nodes/${selectedId}`), {
                                  method: "DELETE",
                                  credentials: "include",
                                });
                                setSelectedId(null);
                                setNodeContent(null);
                                if (bookId) loadTree(bookId);
                              } catch {
                                alert("Failed to delete");
                              }
                            }
                          }}
                          title="Delete"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/30 bg-red-50 text-sm text-red-700 transition hover:border-red-500/60 hover:shadow-md"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-6">
                    {/* Titles (hide for verses) */}
                    {!nodeContent.has_content && (
                      <div className="flex flex-col gap-2">
                        {nodeContent.title_sanskrit && (
                          <div className="text-xl font-medium text-zinc-900">
                            {formatValue(nodeContent.title_sanskrit)}
                          </div>
                        )}
                        {nodeContent.title_transliteration && (
                          <div className="text-lg italic text-zinc-700">
                            {formatValue(nodeContent.title_transliteration)}
                          </div>
                        )}
                        {nodeContent.title_english && (
                          <div className="text-lg text-zinc-700">
                            {formatValue(nodeContent.title_english)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Content Data */}
                    {nodeContent.has_content && nodeContent.content_data && (
                      <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-white/90 p-4">
                        {nodeContent.content_data.basic?.sanskrit && (
                          <div>
                            <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Sanskrit
                            </div>
                            <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-900">
                              {formatValue(nodeContent.content_data.basic.sanskrit)}
                            </div>
                          </div>
                        )}
                        {nodeContent.content_data.basic?.transliteration && (
                          <div>
                            <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Transliteration
                            </div>
                            <div className="whitespace-pre-wrap text-base italic leading-relaxed text-zinc-700">
                              {formatValue(nodeContent.content_data.basic.transliteration)}
                            </div>
                          </div>
                        )}
                        {(nodeContent.content_data.translations?.english ||
                          nodeContent.content_data.basic?.translation) && (
                          <div>
                            <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                              English Translation
                            </div>
                            <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                              {formatValue(
                                nodeContent.content_data.translations?.english ||
                                  nodeContent.content_data.basic?.translation
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tags */}
                    {nodeContent.tags && nodeContent.tags.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                          Tags
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {nodeContent.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="rounded-full border border-black/10 bg-white/90 px-3 py-1 text-xs text-zinc-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </>
              ) : selectedId && !contentLoading && !nodeContent ? (
                <p className="text-sm text-zinc-600">
                  Unable to load content for this node.
                </p>
              ) : !selectedId ? (
                <p className="text-sm text-zinc-400">
                  Select a node to view details
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Create Book Modal */}
        {showCreateBook && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Create New Book
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateBook(false);
                    setSelectedSchema(null);
                    setBookFormData({
                      bookName: "",
                      bookCode: "",
                      languagePrimary: "sanskrit",
                    });
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              {!selectedSchema ? (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-zinc-600">
                    Select a schema that defines the structure of your scripture:
                  </p>
                  <div className="grid gap-3">
                    {schemas.map((schema) => (
                      <button
                        key={schema.id}
                        type="button"
                        onClick={() => setSelectedSchema(schema.id)}
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
                  {schemas.length === 0 && (
                    <p className="text-sm text-zinc-500">No schemas available</p>
                  )}
                </div>
              ) : (
                <form onSubmit={handleCreateBook} className="flex flex-col gap-4">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-blue-700">
                      Selected Schema
                    </div>
                    <div className="mt-1 font-semibold text-blue-900">
                      {schemas.find((s) => s.id === selectedSchema)?.name}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Book Name *
                    </label>
                    <input
                      type="text"
                      value={bookFormData.bookName}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, bookName: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="e.g., Bhagavad Gita"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Book Code
                    </label>
                    <input
                      type="text"
                      value={bookFormData.bookCode}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, bookCode: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="e.g., GITA_V1"
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Primary Language
                    </label>
                    <select
                      value={bookFormData.languagePrimary}
                      onChange={(e) =>
                        setBookFormData({ ...bookFormData, languagePrimary: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    >
                      <option value="sanskrit">Sanskrit</option>
                      <option value="hindi">Hindi</option>
                      <option value="tamil">Tamil</option>
                      <option value="telugu">Telugu</option>
                      <option value="english">English</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedSchema(null)}
                      className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={bookSubmitting}
                      className="flex-1 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
                    >
                      {bookSubmitting ? "Creating..." : "Create Book"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Action Modal */}
        {action && actionNode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 overflow-y-auto">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 shadow-2xl my-8 flex flex-col max-h-[calc(100vh-4rem)]">
              <div className="flex-shrink-0 p-6 pb-4 border-b border-black/10">
                <div className="flex items-center justify-between">
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {action === "add" 
                      ? `Add ${formData.levelName || "New Node"}` 
                      : "Edit Node"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setAction(null);
                      setActionNode(null);
                      setActionMessage(null);
                    }}
                    className="text-2xl text-zinc-400 hover:text-zinc-600"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <form onSubmit={handleModalSubmit} className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Level Name
                      {action === "add" && <span className="ml-1 text-[10px]">(from schema)</span>}
                    </label>
                    {action === "add" ? (
                      <input
                        type="text"
                        value={formData.levelName}
                        className="mt-1 w-full rounded-lg border border-black/10 bg-gray-100 px-3 py-2 text-sm text-gray-700 cursor-not-allowed outline-none"
                        placeholder="e.g., Kanda, Sarga, Shloka"
                        required
                        readOnly
                      />
                    ) : (
                      <select
                        value={formData.levelName}
                        onChange={(e) =>
                          setFormData({ ...formData, levelName: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        required
                      >
                        <option value="">Select level</option>
                        {currentBook?.schema?.levels?.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Sequence Number
                    </label>
                    <input
                      type="number"
                      value={formData.sequenceNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, sequenceNumber: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="Auto-calculated if empty"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Title (English)
                  </label>
                  <input
                    type="text"
                    value={formData.titleEnglish}
                    onChange={(e) =>
                      setFormData({ ...formData, titleEnglish: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder="English title"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Sanskrit)
                    </label>
                    <input
                      type="text"
                      value={formData.titleSanskrit}
                      onChange={(e) =>
                        setFormData({ ...formData, titleSanskrit: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="Sanskrit title"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Transliteration)
                    </label>
                    <input
                      type="text"
                      value={formData.titleTransliteration}
                      onChange={(e) =>
                        setFormData({ ...formData, titleTransliteration: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="Transliteration"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.hasContent}
                      onChange={(e) =>
                        setFormData({ ...formData, hasContent: e.target.checked })
                      }
                      className="rounded border-black/10"
                    />
                    <span className="text-sm text-zinc-600">Add content now</span>
                  </label>
                </div>

                {formData.hasContent && (
                  <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-blue-50/30 p-3">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Sanskrit Text
                      </label>
                      <textarea
                        value={formData.contentSanskrit}
                        onChange={(e) =>
                          setFormData({ ...formData, contentSanskrit: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="Sanskrit text"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Transliteration
                      </label>
                      <textarea
                        value={formData.contentTransliteration}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            contentTransliteration: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="Transliteration"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        English Translation
                      </label>
                      <textarea
                        value={formData.contentEnglish}
                        onChange={(e) =>
                          setFormData({ ...formData, contentEnglish: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="English translation"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Tags (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={formData.tags}
                        onChange={(e) =>
                          setFormData({ ...formData, tags: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="tag1, tag2, tag3"
                      />
                    </div>
                  </div>
                )}
                </div>

                <div className="flex-shrink-0 p-6 pt-4 border-t border-black/10">
                  {actionMessage && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {actionMessage}
                    </div>
                  )}
                  <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
                  >
                    {submitting ? "Submitting..." : action === "add" ? "Create" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAction(null);
                      setActionNode(null);
                      setActionMessage(null);
                    }}
                    className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                  >
                    Cancel
                  </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ScripturesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ScripturesContent />
    </Suspense>
  );
}
