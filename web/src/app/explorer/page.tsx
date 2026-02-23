"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, ShoppingBasket, X } from "lucide-react";
import { contentPath } from "../../lib/apiPaths";
import { getMe, invalidateMeCache } from "../../lib/authClient";

type Schema = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
};

type Book = {
  id: number;
  book_name: string;
  book_code: string;
  schema_id: number;
  language_primary: string;
};

type ContentNode = {
  id: number;
  book_id: number;
  parent_node_id: number | null;
  level_name: string;
  level_order: number;
  sequence_number: number | null;
  title_english: string | null;
  title_hindi: string | null;
  title_sanskrit: string | null;
  title_transliteration: string | null;
  title_tamil: string | null;
  content_text: string | null;
  content_data: Record<string, unknown> | null;
  has_content: boolean;
  children?: ContentNode[];
};

type LevelFilter = {
  level_order: number;
  level_name: string;
  selected_node_id: number | null;
  nodes: Array<{ id: number; title: string }>;
};

type DraftBook = {
  id: number;
  title: string;
  description?: string | null;
  section_structure: Record<string, unknown>;
};

type LicensePolicyIssue = {
  source_node_id: number;
  license_type: string;
  policy_action: "warn" | "block";
};

type LicensePolicyReport = {
  status: "pass" | "warn" | "block";
  warning_issues: LicensePolicyIssue[];
  blocked_issues: LicensePolicyIssue[];
};

export default function ExplorerPage() {
  type DraftSection = "front" | "body" | "back";
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<number | null>(null);
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [tree, setTree] = useState<ContentNode[]>([]);
  const [levelFilters, setLevelFilters] = useState<LevelFilter[]>([]);
  const [selectedNode, setSelectedNode] = useState<ContentNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{node: ContentNode, snippet: string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedNodes, setPickedNodes] = useState<ContentNode[]>([]);
  const [pickedSections, setPickedSections] = useState<Record<number, DraftSection>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [targetBookId, setTargetBookId] = useState<number | null>(null);
  const [targetParentId, setTargetParentId] = useState<number | null>(null);
  const [insertLoading, setInsertLoading] = useState(false);
  const [insertMessage, setInsertMessage] = useState<string | null>(null);
  const [insertMessageType, setInsertMessageType] = useState<"success" | "error" | null>(null);
  const [draftSyncLoading, setDraftSyncLoading] = useState(false);
  const [draftSyncMessage, setDraftSyncMessage] = useState<string | null>(null);
  const [draftSyncMessageType, setDraftSyncMessageType] = useState<"success" | "error" | null>(null);
  const [linkedDraftId, setLinkedDraftId] = useState<number | null>(null);
  const [lastSyncedDraftId, setLastSyncedDraftId] = useState<number | null>(null);
  const [collectPolicyReport, setCollectPolicyReport] = useState<LicensePolicyReport | null>(null);
  const [collectPolicyLoading, setCollectPolicyLoading] = useState(false);
  const [collectPolicyError, setCollectPolicyError] = useState<string | null>(null);
  const [highlightedPickedNodeId, setHighlightedPickedNodeId] = useState<number | null>(null);
  const pickedNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [canAdmin, setCanAdmin] = useState(false);


  const loadAuthStatus = async () => {
    try {
      const data = await getMe();
      if (!data) {
        setAuthEmail(null);
        setAuthStatus("Not authenticated");
        setCanAdmin(false);
        return;
      }
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
    } catch {
      setAuthStatus("Auth check failed");
      setCanAdmin(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      invalidateMeCache();
      await loadAuthStatus();
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Login failed");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      invalidateMeCache();
      await loadAuthStatus();
    }
  };

  const loadSchemas = async () => {
    try {
      const response = await fetch(contentPath("/schemas"), {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        setSchemas(data);
      }
    } catch {
      // Ignore
    }
  };

  const loadAllBooks = async (): Promise<Book[]> => {
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      if (response.ok) {
        const all = (await response.json()) as Book[];
        setAllBooks(all);
        return all;
      }
    } catch {
      // Ignore
    }
    setAllBooks([]);
    return [];
  };

  const loadBooksBySchema = async (schemaId: number) => {
    try {
      const all = allBooks.length > 0 ? allBooks : await loadAllBooks();
      setBooks(all.filter((b) => b.schema_id === schemaId));
    } catch {
      setBooks([]);
    }
  };

  const loadBookTree = async (bookId: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/books/${bookId}/tree`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setTree(data);
        initializeLevelFilters(data);
      }
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchemas();
    loadAuthStatus();
    loadAllBooks();
  }, []);

  useEffect(() => {
    if (selectedSchemaId) {
      loadBooksBySchema(selectedSchemaId);
      // Clear selected node and book when schema changes
      setSelectedNode(null);
      setSelectedBookId(null);
      setLevelFilters([]);
    } else {
      setBooks([]);
      setSelectedBookId(null);
      setSelectedNode(null);
      setLevelFilters([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchemaId]);

  // Auto-select first book when books are loaded
  useEffect(() => {
    if (books.length > 0 && !selectedBookId) {
      setSelectedBookId(books[0].id);
    }
  }, [books, selectedBookId]);

  useEffect(() => {
    if (selectedBookId) {
      loadBookTree(selectedBookId);
    } else {
      setTree([]);
      setLevelFilters([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookId]);

  useEffect(() => {
    if (pickedNodes.length === 0) {
      setCollectPolicyReport(null);
      setCollectPolicyError(null);
      setCollectPolicyLoading(false);
      return;
    }

    const controller = new AbortController();
    const evaluateCollectPolicy = async () => {
      setCollectPolicyLoading(true);
      setCollectPolicyError(null);

      try {
        const response = await fetch("/api/content/license-policy-check", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node_ids: pickedNodes.map((node) => node.id) }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | LicensePolicyReport
          | { detail?: string }
          | null;

        if (!response.ok) {
          throw new Error((payload as { detail?: string } | null)?.detail || "Failed to evaluate licenses");
        }

        setCollectPolicyReport(payload as LicensePolicyReport);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        setCollectPolicyError(error instanceof Error ? error.message : "Failed to evaluate licenses");
        setCollectPolicyReport(null);
      } finally {
        if (!controller.signal.aborted) {
          setCollectPolicyLoading(false);
        }
      }
    };

    void evaluateCollectPolicy();
    return () => controller.abort();
  }, [pickedNodes]);

  const initializeLevelFilters = (nodes: ContentNode[]) => {
    const schema = schemas.find((s) => s.id === selectedSchemaId);
    if (!schema) return;

    // Only create filters for non-leaf levels (all except the last level)
    const navigableLevels = schema.levels.slice(0, -1);
    
    const filters: LevelFilter[] = navigableLevels.map((level, idx) => ({
      level_order: idx,
      level_name: level,
      selected_node_id: null,
      nodes: [],
    }));

    // Populate first level
    if (nodes.length > 0) {
      filters[0].nodes = nodes.map((n) => ({
        id: n.id,
        title: n.title_english || n.title_sanskrit || n.title_hindi || n.title_transliteration || n.title_tamil || `${n.level_name} ${n.sequence_number || ""}`.trim(),
      }));
    }

    setLevelFilters(filters);
  };

  const handleLevelSelect = (levelOrder: number, nodeId: number) => {
    // Clear the selected node when changing levels
    setSelectedNode(null);
    // Clear search results when navigating
    setSearchResults([]);
    setSearchQuery("");
    
    const updated = [...levelFilters];
    updated[levelOrder].selected_node_id = nodeId;

    // Clear subsequent levels
    for (let i = levelOrder + 1; i < updated.length; i++) {
      updated[i].selected_node_id = null;
      updated[i].nodes = [];
    }

    // Find the selected node and populate next level
    const findNodeAndPopulateNext = (nodes: ContentNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          if (node.children && levelOrder + 1 < updated.length) {
            updated[levelOrder + 1].nodes = node.children.map((c) => ({
              id: c.id,
              title: c.title_english || c.title_sanskrit || c.title_hindi || c.title_transliteration || c.title_tamil || `${c.level_name} ${c.sequence_number || ""}`.trim(),
            }));
          }
          // If this is a leaf node with content, set it as selected
          if (node.has_content) {
            setSelectedNode(node);
          }
          return true;
        }
        if (node.children && findNodeAndPopulateNext(node.children)) {
          return true;
        }
      }
      return false;
    };

    findNodeAndPopulateNext(tree);
    setLevelFilters(updated);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !selectedBookId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        book_id: selectedBookId.toString(),
      });
      const response = await fetch(`/api/search?${params}`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results || []);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePickNode = (node: ContentNode) => {
    if (!pickedNodes.find((n) => n.id === node.id)) {
      setPickedNodes([...pickedNodes, node]);
      setPickedSections((prev) => ({ ...prev, [node.id]: "body" }));
    }
  };

  const handleRemovePicked = (nodeId: number) => {
    setPickedNodes(pickedNodes.filter((n) => n.id !== nodeId));
    setPickedSections((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  };

  const handlePickedSectionChange = (nodeId: number, section: DraftSection) => {
    setPickedSections((prev) => ({ ...prev, [nodeId]: section }));
  };

  const handleMovePicked = (nodeId: number, direction: "up" | "down") => {
    setPickedNodes((prev) => {
      const index = prev.findIndex((node) => node.id === nodeId);
      if (index < 0) return prev;

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const scrollToPickedNode = (nodeId: number) => {
    const target = pickedNodeRefs.current[nodeId];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setHighlightedPickedNodeId(nodeId);
    window.setTimeout(() => {
      setHighlightedPickedNodeId((current) => (current === nodeId ? null : current));
    }, 1400);
  };

  const getNodeTitle = (node: ContentNode): string =>
    node.title_english ||
    node.title_sanskrit ||
    node.title_hindi ||
    node.title_transliteration ||
    node.title_tamil ||
    `${node.level_name} ${node.sequence_number || ""}`.trim();

  const normalizeSectionStructure = (raw: Record<string, unknown> | null | undefined) => {
    const parsed = raw && typeof raw === "object" ? raw : {};
    return {
      front: Array.isArray(parsed.front) ? [...parsed.front] : [],
      body: Array.isArray(parsed.body) ? [...parsed.body] : [],
      back: Array.isArray(parsed.back) ? [...parsed.back] : [],
    };
  };

  const syncPickedNodesToDraft = async (
    nodes: ContentNode[],
    sections: Record<number, DraftSection>
  ): Promise<number | null> => {
    const now = new Date().toISOString();

    const createDraftPayload = {
      title: `Explorer Draft${selectedBook ? ` — ${selectedBook.book_name}` : ""}`,
      description: "Auto-synced from Explorer picked references",
      section_structure: {
        front: [] as Array<Record<string, unknown>>,
        body: [] as Array<Record<string, unknown>>,
        back: [] as Array<Record<string, unknown>>,
      },
    };

    const buildEntry = (node: ContentNode, order: number) => ({
      node_id: node.id,
      source_type: "library_reference",
      source_book_id: node.book_id,
      level_name: node.level_name,
      title: getNodeTitle(node),
      order,
      added_at: now,
    });

    let draftId = linkedDraftId;
    let existingDraft: DraftBook | null = null;

    if (draftId) {
      const existingResponse = await fetch(`/api/draft-books/${draftId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (existingResponse.ok) {
        existingDraft = (await existingResponse.json()) as DraftBook;
      } else {
        draftId = null;
      }
    }

    if (!draftId) {
      nodes.forEach((node, index) => {
        const section = sections[node.id] || "body";
        createDraftPayload.section_structure[section].push(buildEntry(node, index + 1));
      });

      const createResponse = await fetch("/api/draft-books", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createDraftPayload),
      });

      if (!createResponse.ok) {
        const payload = (await createResponse.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Failed to create draft sync");
      }

      const created = (await createResponse.json()) as DraftBook;
      setLinkedDraftId(created.id);
      return created.id;
    }

    const normalized = normalizeSectionStructure(existingDraft?.section_structure);

    nodes.forEach((node) => {
      const section = sections[node.id] || "body";
      const sectionItems = normalized[section];
      const alreadyExists = sectionItems.some((item) => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as { node_id?: unknown; source_book_id?: unknown };
        return candidate.node_id === node.id && candidate.source_book_id === node.book_id;
      });

      if (!alreadyExists) {
        sectionItems.push(buildEntry(node, sectionItems.length + 1));
      }
    });

    const patchResponse = await fetch(`/api/draft-books/${draftId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section_structure: normalized }),
    });

    if (!patchResponse.ok) {
      const payload = (await patchResponse.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(payload?.detail || "Failed to update draft sync");
    }

    return draftId;
  };

  const handleInsertReferences = async () => {
    if (!targetBookId || pickedNodes.length === 0) return;
    
    setInsertLoading(true);
    setInsertMessage(null);
    setInsertMessageType(null);
    
    try {
      const response = await fetch(`/api/books/${targetBookId}/insert-references`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_node_id: targetParentId,
          node_ids: pickedNodes.map((n) => n.id),
          section_assignments: pickedNodes.reduce<Record<string, DraftSection>>((acc, node) => {
            acc[String(node.id)] = pickedSections[node.id] || "body";
            return acc;
          }, {}),
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || "Insert failed");
      }

      const syncedDraftId = await syncPickedNodesToDraft(pickedNodes, pickedSections);
      setLastSyncedDraftId(syncedDraftId);
      
      setInsertMessage(
        syncedDraftId
          ? `Successfully inserted ${pickedNodes.length} reference(s) and synced to Draft #${syncedDraftId}`
          : `Successfully inserted ${pickedNodes.length} reference(s)`
      );
      setInsertMessageType("success");
      setPickedNodes([]);
      setPickedSections({});
      setTimeout(() => {
        setShowInsertModal(false);
        setInsertMessage(null);
        setInsertMessageType(null);
        setTargetBookId(null);
        setTargetParentId(null);
      }, 2000);
    } catch (error) {
      setInsertMessage(
        error instanceof Error ? error.message : "Insert failed"
      );
      setInsertMessageType("error");
    } finally {
      setInsertLoading(false);
    }
  };

  const handleSyncToDraft = async () => {
    if (pickedNodes.length === 0) {
      setDraftSyncMessage("Pick at least one item first.");
      setDraftSyncMessageType("error");
      return;
    }

    setDraftSyncLoading(true);
    setDraftSyncMessage(null);
    setDraftSyncMessageType(null);

    try {
      const syncedDraftId = await syncPickedNodesToDraft(pickedNodes, pickedSections);
      setLastSyncedDraftId(syncedDraftId);
      setDraftSyncMessage(
        syncedDraftId
          ? `Synced ${pickedNodes.length} item(s) to Draft #${syncedDraftId}`
          : `Synced ${pickedNodes.length} item(s) to draft`
      );
      setDraftSyncMessageType("success");
    } catch (error) {
      setDraftSyncMessage(error instanceof Error ? error.message : "Failed to sync to draft");
      setDraftSyncMessageType("error");
    } finally {
      setDraftSyncLoading(false);
    }
  };


  const countDescendants = (node: ContentNode): number => {
    if (!node.children || node.children.length === 0) {
      return 0;
    }
    let count = node.children.length;
    for (const child of node.children) {
      count += countDescendants(child);
    }
    return count;
  };

  const buildNodePathExplorer = (nodeId: number, nodes: ContentNode[]): ContentNode[] => {
    const buildFullPath = (id: number, nodeList: ContentNode[], currentPath: ContentNode[] = []): ContentNode[] | null => {
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

  const renderBreadcrumbExplorer = (resultNode: ContentNode) => {
    const pathNodes = buildNodePathExplorer(resultNode.id, tree);

    return (
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        {pathNodes.length > 0 ? (
          pathNodes.map((node, idx) => (
            <div key={`${node.id}-crumb`} className="flex items-center gap-1.5">
              <span className="text-zinc-500 font-medium">
                {node.title_english || node.title_sanskrit || node.title_hindi || node.title_transliteration || node.title_tamil || `${node.level_name} ${node.sequence_number || ''}`}
              </span>
              {idx < pathNodes.length - 1 && <span className="text-zinc-400">/</span>}
            </div>
          ))
        ) : (
          <span className="text-zinc-400 italic">Path unavailable</span>
        )}
      </div>
    );
  };


  const getNodeText = (node: ContentNode): string => {
    if (!node.content_data) return "";
    const data = node.content_data;
    
    if (typeof data === "object" && !Array.isArray(data)) {
      // Check nested structures first
      if (data.basic && typeof data.basic === "object") {
        const basic = data.basic as Record<string, unknown>;
        return (
          (basic.transliteration as string) ||
          (basic.sanskrit as string) ||
          (basic.text as string) ||
          (basic.english as string) ||
          ""
        );
      }
      if (data.translations && typeof data.translations === "object") {
        const translations = data.translations as Record<string, unknown>;
        return (translations.english as string) || "";
      }

      // Direct text fields
      const text =
        (data.text_english as string) ||
        (data.text as string) ||
        (data.content as string) ||
        (data.english as string) ||
        (data.translation as string) ||
        (data.text_transliteration as string) ||
        (data.text_sanskrit as string);

      if (text) return text;

      // Last resort: find any string value with reasonable length
      for (const value of Object.values(data)) {
        if (typeof value === "string" && value.length > 20) {
          return value;
        }
      }
    }
    return "";
  };

  const getFilteredTree = (): ContentNode[] => {
    const schema = schemas.find((s) => s.id === selectedSchemaId);
    if (!schema) return [];

    // If no level is selected, return empty
    const selectedLevels = levelFilters
      .filter((f) => f.selected_node_id)
      .sort((a, b) => a.level_order - b.level_order);

    if (selectedLevels.length === 0) return [];

    // Find the deepest selected node
    const deepestLevel = selectedLevels[selectedLevels.length - 1];
    const foundNode = tree.find((n) => n.id === deepestLevel.selected_node_id);

    if (!foundNode) return [];

    // Collect all nodes with content (summaries and verses)
    const collectContentNodes = (node: ContentNode): ContentNode[] => {
      const results: ContentNode[] = [];
      
      // Include this node if it has content
      if (node.has_content) {
        results.push(node);
      }
      
      // Also include any children with content
      if (node.children && node.children.length > 0) {
        results.push(...node.children.flatMap(collectContentNodes));
      }
      
      return results;
    };

    return collectContentNodes(foundNode);
  };

  const getNodeSummary = (node: ContentNode): string => {
    const descendantCount = countDescendants(node);
    if (descendantCount === 0) {
      return node.has_content ? "1 verse" : "Empty";
    }
    return `${descendantCount} descendant${descendantCount > 1 ? "s" : ""}`;
  };

  const toggleExpand = (nodeId: number) => {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderTreeNode = (node: ContentNode, depth: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isLeaf = !hasChildren;
    const isPicked = pickedNodes.find((n) => n.id === node.id) !== undefined;

    return (
      <div key={node.id} className="flex flex-col">
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition ${
            selectedNode?.id === node.id
              ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10"
              : "border-black/10 bg-white/90 hover:border-[color:var(--accent)]/50"
          }`}
          style={{ marginLeft: `${depth * 20}px` }}
        >
          {hasChildren && (
            <button
              onClick={() => toggleExpand(node.id)}
              className="text-zinc-500 hover:text-zinc-700"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
          )}
          {isLeaf && <span className="w-4" />}
          
          <button
            onClick={() => setSelectedNode(node)}
            className="flex-1 text-left text-sm"
          >
            <span className="font-medium text-[color:var(--deep)]">
              {node.title_english || node.title_sanskrit || node.title_hindi || node.title_transliteration || node.title_tamil || `${node.level_name} ${node.sequence_number || ""}`.trim()}
            </span>
            {!isLeaf && (
              <span className="ml-2 text-xs text-zinc-500">
                ({getNodeSummary(node)})
              </span>
            )}
          </button>

          <button
            onClick={() => handlePickNode(node)}
            disabled={isPicked}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
            title={isPicked ? "Already in basket" : "Add to basket"}
            aria-label={isPicked ? "Already in basket" : "Add to basket"}
          >
            {isPicked ? <Check size={14} /> : <ShoppingBasket size={14} />}
          </button>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-1 flex flex-col gap-1">
            {node.children!.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const selectedSchema = schemas.find((s) => s.id === selectedSchemaId);
  const selectedBook = books.find((b) => b.id === selectedBookId);

  return (
    <div className="grainy-bg min-h-screen">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
              Book Explorer
            </h1>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Pick Mode ({pickedNodes.length})
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-600">
            Navigate scriptures by schema and pick verses for assembly
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* Left Sidebar */}
          <aside className="flex flex-col gap-4">
            {/* Schema Selector */}
            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Schema
              </label>
              <select
                value={selectedSchemaId || ""}
                onChange={(e) => {
                  setSelectedSchemaId(e.target.value ? Number(e.target.value) : null);
                  setSearchResults([]);
                  setSearchQuery("");
                }}
                className="mt-2 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
              >
                <option value="">Select a schema</option>
                {schemas.map((schema) => (
                  <option key={schema.id} value={schema.id}>
                    {schema.name}
                  </option>
                ))}
              </select>
              {selectedSchema && (
                <div className="mt-2 text-xs text-zinc-500">
                  {selectedSchema.levels.join(" → ")}
                </div>
              )}
            </div>

            {/* Level Cascades */}
            {levelFilters.length > 0 && (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Navigate
                </h3>
                <div className="mt-3 flex flex-col gap-3">
                  {levelFilters.map(
                    (filter) => (
                      <div key={filter.level_order}>
                        <label className="text-xs text-zinc-500">
                          {filter.level_name}
                        </label>
                        <select
                          value={filter.selected_node_id || ""}
                          onChange={(e) =>
                            e.target.value &&
                            handleLevelSelect(filter.level_order, Number(e.target.value))
                          }
                          disabled={filter.nodes.length === 0}
                          className="mt-1 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-50"
                        >
                          <option value="">
                            {filter.nodes.length === 0
                              ? `No ${filter.level_name}s yet`
                              : `Select ${filter.level_name}`}
                          </option>
                          {filter.nodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </aside>

          {/* Main Content */}
          <div className="flex flex-col gap-6">
            {/* Search */}
            {selectedBookId && (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                <div className="flex gap-2">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={`Search in ${selectedBook?.book_name || "book"}...`}
                    className="flex-1 rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={loading}
                    className="rounded-xl border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    Search
                  </button>
                </div>
              </div>
            )}



            {/* Tree View */}
            {tree.length > 0 && (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    {selectedSchema?.levels[selectedSchema.levels.length - 1]}s ({getFilteredTree().length})
                  </h3>
                </div>
                <div className="mt-3 flex flex-col gap-2 max-h-96 overflow-y-auto">
                  {getFilteredTree().length === 0 ? (
                    <p className="text-xs text-zinc-500">Select a level above to see verses</p>
                  ) : (
                    getFilteredTree().map((node) => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedNode(node)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          selectedNode?.id === node.id
                            ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10"
                            : "border-black/10 bg-white/90 hover:border-[color:var(--accent)]/50"
                        }`}
                      >
                        <span className="font-medium text-[color:var(--deep)]">
                          {node.title_english || node.title_sanskrit || node.title_hindi || node.title_transliteration || node.title_tamil || `${node.level_name} ${node.sequence_number || ""}`.trim()}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Selected Node Display */}
            {selectedNode && (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[color:var(--accent)]">
                        {selectedNode.level_name}
                      </span>
                      <h3 className="text-lg font-semibold text-[color:var(--deep)]">
                        {selectedNode.title_english || selectedNode.title_sanskrit || selectedNode.title_hindi || selectedNode.title_transliteration || selectedNode.title_tamil || `${selectedNode.level_name} ${selectedNode.sequence_number || ""}`.trim()}
                      </h3>
                    </div>
                    {selectedNode.has_content && selectedNode.content_data ? (
                      <div className="mt-3">
                        {getNodeText(selectedNode) ? (
                          <p className="whitespace-pre-wrap text-sm text-zinc-700">
                            {getNodeText(selectedNode)}
                          </p>
                        ) : (
                          <div>
                            <p className="text-sm text-zinc-500 mb-2">
                              Content data available but no text field found. Data structure:
                            </p>
                            <pre className="bg-zinc-50 p-2 rounded text-xs text-zinc-600 overflow-auto max-h-40">
                              {JSON.stringify(selectedNode.content_data, null, 2).substring(0, 500)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">
                        Contains: {getNodeSummary(selectedNode)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handlePickNode(selectedNode)}
                    disabled={pickedNodes.find((n) => n.id === selectedNode.id) !== undefined}
                    className="ml-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                    title={
                      pickedNodes.find((n) => n.id === selectedNode.id)
                        ? "Already in basket"
                        : "Add to basket"
                    }
                    aria-label={
                      pickedNodes.find((n) => n.id === selectedNode.id)
                        ? "Already in basket"
                        : "Add to basket"
                    }
                  >
                    {pickedNodes.find((n) => n.id === selectedNode.id)
                      ? <Check size={14} />
                      : <ShoppingBasket size={14} />}
                  </button>
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Search Results ({searchResults.length})
                </h3>
                <div className="mt-3 flex flex-col gap-3">
                  {searchResults.map((result, idx) => {
                    const node = result.node;
                    const nodeText = getNodeText(node);
                    const nodeTitle = node.title_english || node.title_sanskrit || node.title_hindi || node.title_transliteration || node.title_tamil || `${node.level_name} ${node.sequence_number || ""}`.trim();
                    return (
                      <div
                        key={`${node.id}-${idx}`}
                        className="rounded-xl border border-black/10 bg-white/90 p-4"
                      >
                        {renderBreadcrumbExplorer(node)}
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-[color:var(--deep)]">
                              {nodeTitle}
                            </h4>
                            <p className="mt-2 text-sm text-zinc-700">
                              {nodeText ? (nodeText.substring(0, 200) + (nodeText.length > 200 ? "..." : "")) : "No content"}
                            </p>
                          </div>
                          <button
                            onClick={() => handlePickNode(node)}
                            disabled={
                              pickedNodes.find((n) => n.id === node.id) !== undefined
                            }
                            className="ml-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                            title={
                              pickedNodes.find((n) => n.id === node.id)
                                ? "Already in basket"
                                : "Add to basket"
                            }
                            aria-label={
                              pickedNodes.find((n) => n.id === node.id)
                                ? "Already in basket"
                                : "Add to basket"
                            }
                          >
                            {pickedNodes.find((n) => n.id === node.id) ? <Check size={14} /> : <ShoppingBasket size={14} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Picked Nodes Panel */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                    Basket / Picked Items ({pickedNodes.length})
                  </h3>
                  <button
                    onClick={() => {
                      setPickedNodes([]);
                      setPickedSections({});
                    }}
                    disabled={pickedNodes.length === 0}
                    className="text-xs text-emerald-600 hover:text-emerald-800"
                  >
                    Clear all
                  </button>
                </div>
                {pickedNodes.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-600">
                    Add items from the tree or search results, then insert into a book or sync directly to Drafts.
                  </p>
                ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {collectPolicyLoading && (
                    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                      Checking license policy…
                    </div>
                  )}
                  {collectPolicyError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {collectPolicyError}
                    </div>
                  )}
                  {collectPolicyReport && collectPolicyReport.status !== "pass" && (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        collectPolicyReport.status === "block"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      <div>
                        {collectPolicyReport.status === "block"
                          ? `${collectPolicyReport.blocked_issues.length} blocked source license(s). Snapshot publishing will be blocked.`
                          : `${collectPolicyReport.warning_issues.length} source license warning(s). Review before publishing.`}
                      </div>
                      <div className="mt-1 space-y-1">
                        {collectPolicyReport.warning_issues.map((issue) => {
                          const node = pickedNodes.find((candidate) => candidate.id === issue.source_node_id);
                          const label =
                            node?.title_english ||
                            node?.title_sanskrit ||
                            node?.title_hindi ||
                            node?.title_transliteration ||
                            node?.title_tamil ||
                            `Node ${issue.source_node_id}`;
                          return (
                            <button
                              key={`warn-${issue.source_node_id}-${issue.license_type}`}
                              type="button"
                              onClick={() => scrollToPickedNode(issue.source_node_id)}
                              className="block text-left underline decoration-dotted underline-offset-2"
                            >
                              ⚠ {label} — {issue.license_type}
                            </button>
                          );
                        })}
                        {collectPolicyReport.blocked_issues.map((issue) => {
                          const node = pickedNodes.find((candidate) => candidate.id === issue.source_node_id);
                          const label =
                            node?.title_english ||
                            node?.title_sanskrit ||
                            node?.title_hindi ||
                            node?.title_transliteration ||
                            node?.title_tamil ||
                            `Node ${issue.source_node_id}`;
                          return (
                            <button
                              key={`block-${issue.source_node_id}-${issue.license_type}`}
                              type="button"
                              onClick={() => scrollToPickedNode(issue.source_node_id)}
                              className="block text-left underline decoration-dotted underline-offset-2"
                            >
                              ✗ {label} — {issue.license_type}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {pickedNodes.map((node, index) => (
                    <div
                      key={node.id}
                      ref={(element) => {
                        pickedNodeRefs.current[node.id] = element;
                      }}
                      className={`flex items-start justify-between rounded-xl border bg-white p-3 transition-all ${
                        highlightedPickedNodeId === node.id
                          ? "border-emerald-400 ring-2 ring-emerald-200"
                          : "border-emerald-200"
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            {index + 1}
                          </span>
                          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {node.level_name}
                          </span>
                          <span className="text-sm font-semibold text-[color:var(--deep)]">
                            {node.title_english || node.title_sanskrit || node.title_hindi || node.title_transliteration || node.title_tamil || `${node.level_name} ${node.sequence_number || ""}`.trim()}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {getNodeSummary(node)}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-xs font-medium text-zinc-600">Section</label>
                          <select
                            value={pickedSections[node.id] || "body"}
                            onChange={(e) => handlePickedSectionChange(node.id, e.target.value as DraftSection)}
                            className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs text-zinc-700"
                          >
                            <option value="front">Front</option>
                            <option value="body">Body</option>
                            <option value="back">Back</option>
                          </select>
                        </div>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <button
                          onClick={() => handleMovePicked(node.id, "up")}
                          disabled={index === 0}
                          title="Move up"
                          aria-label="Move up"
                          className="rounded border border-emerald-200 p-1 text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-40"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => handleMovePicked(node.id, "down")}
                          disabled={index === pickedNodes.length - 1}
                          title="Move down"
                          aria-label="Move down"
                          className="rounded border border-emerald-200 p-1 text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-40"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => handleRemovePicked(node.id)}
                          className="rounded p-1 text-rose-600 transition hover:bg-rose-50 hover:text-rose-800"
                          title="Remove"
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                )}

                {draftSyncMessage && (
                  <div
                    className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                      draftSyncMessageType === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {draftSyncMessageType === "success" ? <Check size={14} /> : <X size={14} />}
                      <span>{draftSyncMessage}</span>
                    </div>
                    {draftSyncMessageType === "success" && lastSyncedDraftId && (
                      <div className="mt-2">
                        <a
                          href={`/drafts?draftId=${lastSyncedDraftId}`}
                          className="inline-flex rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Open Draft #{lastSyncedDraftId}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={handleSyncToDraft}
                    disabled={pickedNodes.length === 0 || draftSyncLoading}
                    className="w-full rounded-xl border border-emerald-600 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {draftSyncLoading ? "Syncing..." : "Sync to Draft"}
                  </button>
                  <button
                  onClick={() => setShowInsertModal(true)}
                  disabled={pickedNodes.length === 0}
                  className="mt-4 w-full rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Insert into Book
                  </button>
                </div>
              </div>

            {!selectedSchemaId && (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-8 text-center">
                <p className="text-sm text-zinc-500">
                  Select a schema to start exploring books
                </p>
              </div>
            )}

            {selectedSchemaId && !selectedBookId && books.length > 0 && (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-8 text-center">
                <p className="text-sm text-zinc-500">Select a book to browse its content</p>
              </div>
            )}
          </div>
        </div>

        {/* Insert References Modal */}
        {showInsertModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-lg rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Insert References
                </h2>
                <button
                  onClick={() => {
                    setShowInsertModal(false);
                    setInsertMessage(null);
                    setInsertMessageType(null);
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">
                  <strong>References, not copies:</strong> Inserted items will reference the
                  original content. Changes to the source will automatically reflect in all
                  books that reference it.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Target Book
                  </label>
                  <select
                    value={targetBookId || ""}
                    onChange={(e) =>
                      setTargetBookId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="">Select target book</option>
                    {allBooks.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.book_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Insert Location (Optional)
                  </label>
                  <select
                    value={targetParentId || ""}
                    onChange={(e) =>
                      setTargetParentId(e.target.value ? Number(e.target.value) : null)
                    }
                    disabled={!targetBookId}
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-50"
                  >
                    <option value="">Root level (no parent)</option>
                    {/* TODO: Load available parent nodes for selected book */}
                  </select>
                  <p className="mt-1 text-xs text-zinc-500">
                    References will be inserted at root level or under the selected parent
                  </p>
                </div>

                <div className="rounded-xl border border-black/10 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-700">
                    Items to insert: {pickedNodes.length}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pickedNodes.slice(0, 5).map((node) => (
                      <span
                        key={node.id}
                        className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-600"
                      >
                        {node.title_english || node.title_sanskrit || node.title_hindi || node.title_transliteration || node.title_tamil || `${node.level_name} ${node.sequence_number || ""}`.trim()}
                      </span>
                    ))}
                    {pickedNodes.length > 5 && (
                      <span className="text-xs text-zinc-500">
                        +{pickedNodes.length - 5} more
                      </span>
                    )}
                  </div>
                </div>

                {collectPolicyReport && collectPolicyReport.status !== "pass" && (
                  <div
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      collectPolicyReport.status === "block"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    <div>
                      {collectPolicyReport.status === "block"
                        ? "This selection includes blocked licenses and cannot publish as a snapshot until resolved."
                        : "This selection includes license warnings; publishing remains allowed but review is recommended."}
                    </div>
                    <div className="mt-1 space-y-1">
                      {collectPolicyReport.warning_issues.map((issue) => {
                        const node = pickedNodes.find((candidate) => candidate.id === issue.source_node_id);
                        const label =
                          node?.title_english ||
                          node?.title_sanskrit ||
                          node?.title_hindi ||
                          node?.title_transliteration ||
                          node?.title_tamil ||
                          `Node ${issue.source_node_id}`;
                        return (
                          <button
                            key={`modal-warn-${issue.source_node_id}-${issue.license_type}`}
                            type="button"
                            onClick={() => scrollToPickedNode(issue.source_node_id)}
                            className="block text-left underline decoration-dotted underline-offset-2"
                          >
                            ⚠ {label} — {issue.license_type}
                          </button>
                        );
                      })}
                      {collectPolicyReport.blocked_issues.map((issue) => {
                        const node = pickedNodes.find((candidate) => candidate.id === issue.source_node_id);
                        const label =
                          node?.title_english ||
                          node?.title_sanskrit ||
                          node?.title_hindi ||
                          node?.title_transliteration ||
                          node?.title_tamil ||
                          `Node ${issue.source_node_id}`;
                        return (
                          <button
                            key={`modal-block-${issue.source_node_id}-${issue.license_type}`}
                            type="button"
                            onClick={() => scrollToPickedNode(issue.source_node_id)}
                            className="block text-left underline decoration-dotted underline-offset-2"
                          >
                            ✗ {label} — {issue.license_type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {insertMessage && (
                  <div
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      insertMessageType === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {insertMessageType === "success" ? <Check size={14} /> : <X size={14} />}
                      <span>{insertMessage}</span>
                    </div>
                    {insertMessageType === "success" && lastSyncedDraftId && (
                      <div className="mt-2">
                        <a
                          href={`/drafts?draftId=${lastSyncedDraftId}`}
                          className="inline-flex rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Open Draft #{lastSyncedDraftId}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowInsertModal(false);
                      setInsertMessage(null);
                      setInsertMessageType(null);
                    }}
                    disabled={insertLoading}
                    className="flex-1 rounded-xl border border-black/10 bg-white/80 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleInsertReferences}
                    disabled={!targetBookId || insertLoading}
                    className="flex-1 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {insertLoading ? "Inserting..." : "Insert References"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
