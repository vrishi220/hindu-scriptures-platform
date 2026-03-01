"use client";

import { useState, useEffect, useRef } from "react";
import { getMe } from "../lib/authClient";

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

type BookTreeNode = {
  id: number;
  title?: string | null;
  level_name: string;
  level_order: number;
  sequence_number?: string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children: BookTreeNode[];
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

const parseSequenceNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = value.toString().match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
};

const getBookTreeNodeLabel = (node: BookTreeNode): string => {
  const title =
    node.title_english ||
    node.title_sanskrit ||
    node.title_transliteration ||
    node.title;
  const seq = parseSequenceNumber(node.sequence_number);
  const hasChildren = Boolean(node.children && node.children.length > 0);

  if (!hasChildren) {
    return title || `${node.level_name} ${seq ?? node.id}`;
  }

  if (title) {
    return seq !== null ? `${seq}. ${title}` : title;
  }

  return `${node.level_name} ${seq ?? node.id}`;
};

type BasketPanelProps = {
  items: BasketItem[];
  onRemoveItem: (nodeId: number) => void;
  onMoveItem?: (nodeId: number, direction: "up" | "down") => void;
  reorderLoading?: boolean;
  onClearBasket: () => void;
  onItemsAdded?: () => void;
};

export default function BasketPanel({
  items,
  onRemoveItem,
  onMoveItem,
  reorderLoading = false,
  onClearBasket,
  onItemsAdded,
}: BasketPanelProps) {
  const FLOATING_WIDGET_WIDTH = 220;
  const FLOATING_WIDGET_HEIGHT = 56;
  const PANEL_WIDTH = 384;
  const PANEL_HEIGHT = 520;
  const VIEWPORT_PADDING = 16;

  const [isExpanded, setIsExpanded] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [widgetPosition, setWidgetPosition] = useState({ x: 0, y: 0 });
  const [widgetSize, setWidgetSize] = useState({
    width: FLOATING_WIDGET_WIDTH,
    height: FLOATING_WIDGET_HEIGHT,
  });
  const [positionInitialized, setPositionInitialized] = useState(false);
  const [isDraggingWidget, setIsDraggingWidget] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
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
  const [insertMode, setInsertMode] = useState<"copy" | "reference">("copy");
  const [canCopyExistingContent, setCanCopyExistingContent] = useState(false);
  const [organizedTree, setOrganizedTree] = useState<OrganizedNode[]>([]);
  const [targetBookId, setTargetBookId] = useState<number | null>(null);
  const [targetSchemaLevels, setTargetSchemaLevels] = useState<string[]>([]);
  const [bookTree, setBookTree] = useState<BookTreeNode[]>([]);
  const [selectedParentNodeId, setSelectedParentNodeId] = useState<number | null>(null);
  const [selectedParentLevel, setSelectedParentLevel] = useState<string>("");
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<{ id: number; level: string; parentId: number | null; isLeaf: boolean; label: string } | null>(null);
  const [licensePolicyReport, setLicensePolicyReport] = useState<LicensePolicyReport | null>(null);
  const [licensePolicyLoading, setLicensePolicyLoading] = useState(false);
  const [licensePolicyError, setLicensePolicyError] = useState<string | null>(null);
  const [highlightedBasketNodeId, setHighlightedBasketNodeId] = useState<number | null>(null);
  const basketItemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);

  const measureWidgetSize = () => {
    const element = widgetContainerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const measuredWidth = Math.max(56, Math.ceil(rect.width));
    const measuredHeight = Math.max(48, Math.ceil(rect.height));
    setWidgetSize((current) =>
      current.width === measuredWidth && current.height === measuredHeight
        ? current
        : { width: measuredWidth, height: measuredHeight }
    );
  };

  const clampWidgetPosition = (x: number, y: number) => {
    const maxX = Math.max(VIEWPORT_PADDING, viewport.width - widgetSize.width - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, viewport.height - widgetSize.height - VIEWPORT_PADDING);
    return {
      x: Math.min(Math.max(VIEWPORT_PADDING, x), maxX),
      y: Math.min(Math.max(VIEWPORT_PADDING, y), maxY),
    };
  };

  const panelLeft = Math.min(
    Math.max(VIEWPORT_PADDING, widgetPosition.x + widgetSize.width - PANEL_WIDTH),
    Math.max(VIEWPORT_PADDING, viewport.width - PANEL_WIDTH - VIEWPORT_PADDING)
  );
  const panelTop = Math.min(
    Math.max(VIEWPORT_PADDING, widgetPosition.y - PANEL_HEIGHT - 12),
    Math.max(VIEWPORT_PADDING, viewport.height - PANEL_HEIGHT - VIEWPORT_PADDING)
  );

  useEffect(() => {
    const applyViewport = () => {
      measureWidgetSize();
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height });
      if (!positionInitialized) {
        setWidgetPosition(
          clampWidgetPosition(width - widgetSize.width - VIEWPORT_PADDING, height - widgetSize.height - 24)
        );
        setPositionInitialized(true);
      } else {
        setWidgetPosition((current) => clampWidgetPosition(current.x, current.y));
      }
    };

    applyViewport();
    window.addEventListener("resize", applyViewport);
    return () => window.removeEventListener("resize", applyViewport);
  }, [positionInitialized, widgetSize.width, widgetSize.height]);

  useEffect(() => {
    measureWidgetSize();
  }, [items.length]);

  useEffect(() => {
    if (!isDraggingWidget) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      event.preventDefault();
      const nextPosition = clampWidgetPosition(
        event.clientX - dragOffsetRef.current.x,
        event.clientY - dragOffsetRef.current.y
      );
      setWidgetPosition(nextPosition);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      activePointerIdRef.current = null;
      setIsDraggingWidget(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDraggingWidget, viewport]);

  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOffsetRef.current = {
      x: event.clientX - widgetPosition.x,
      y: event.clientY - widgetPosition.y,
    };
    setIsDraggingWidget(true);
  };

  const scrollToBasketItem = (nodeId: number) => {
    const target = basketItemRefs.current[nodeId];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setHighlightedBasketNodeId(nodeId);
    window.setTimeout(() => {
      setHighlightedBasketNodeId((current) => (current === nodeId ? null : current));
    }, 1400);
  };

  const basketButtonTooltip =
    items.length === 0
      ? "Collected items go here"
      : isExpanded
        ? "Close Basket"
        : "Open Basket";

  useEffect(() => {
    if (items.length === 0) {
      setLicensePolicyReport(null);
      setLicensePolicyError(null);
      setLicensePolicyLoading(false);
      return;
    }

    const controller = new AbortController();
    const evaluate = async () => {
      setLicensePolicyLoading(true);
      setLicensePolicyError(null);

      try {
        const response = await fetch("/api/content/license-policy-check", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node_ids: items.map((item) => item.node_id) }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | LicensePolicyReport
          | { detail?: string }
          | null;

        if (!response.ok) {
          throw new Error((payload as { detail?: string } | null)?.detail || "Failed to evaluate licenses");
        }

        setLicensePolicyReport(payload as LicensePolicyReport);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        setLicensePolicyError(error instanceof Error ? error.message : "Failed to evaluate licenses");
        setLicensePolicyReport(null);
      } finally {
        if (!controller.signal.aborted) {
          setLicensePolicyLoading(false);
        }
      }
    };

    void evaluate();
    return () => controller.abort();
  }, [items]);

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
    setPanelMessage(null);
    setShowAddToBook(true);
    setMode("select");
    setMessage(null);
    await Promise.all([loadSchemas(), loadBooks()]);

    try {
      const me = await getMe();
      if (!me) {
        setCanCopyExistingContent(false);
        setInsertMode("reference");
        return;
      }
      const perms = me.permissions || {};
      const allowCopy = Boolean(perms.can_edit || perms.can_admin);
      setCanCopyExistingContent(allowCopy);
      if (!allowCopy) {
        setInsertMode("reference");
      }
    } catch {
      setCanCopyExistingContent(false);
      setInsertMode("reference");
    }
  };

  const handleCreateDraftFromBasket = async () => {
    if (items.length === 0 || creatingDraft) {
      return;
    }

    setCreatingDraft(true);
    setPanelMessage(null);

    try {
      const response = await fetch("/api/cart/me/create-draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Draft from Basket",
          clear_cart_after_create: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { id?: number; detail?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to create draft from basket");
      }

      const createdDraftId = payload?.id;
      if (typeof createdDraftId === "number") {
        onClearBasket();
        window.location.href = `/drafts?draftId=${createdDraftId}`;
        return;
      }

      throw new Error("Draft created, but response did not include an id");
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : "Failed to create draft from basket");
    } finally {
      setCreatingDraft(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getValidChildLevels = (parentLevel: string | null, schemaLevels: string[]): string[] => {
    if (!parentLevel || parentLevel === "BOOK") {
      // Root level - can only add first level
      return schemaLevels.length > 0 ? [schemaLevels[0]] : [];
    }

    const parentIndex = schemaLevels.indexOf(parentLevel);
    if (parentIndex >= 0 && parentIndex + 1 < schemaLevels.length) {
      // Can only add the next level
      return [schemaLevels[parentIndex + 1]];
    }

    // Leaf level - cannot have children
    return [];
  };

  const canAddAtLevel = (level: string, schemaLevels: string[], itemType: "content" | "placeholder"): boolean => {
    const levelIndex = schemaLevels.indexOf(level);
    if (levelIndex < 0) return false;

    // Content nodes can only be added at leaf level
    if (itemType === "content") {
      return levelIndex === schemaLevels.length - 1;
    }

    // Organizational nodes can be at any level except the leaf
    return levelIndex < schemaLevels.length - 1;
  };

  const loadBookTree = async (bookId: number): Promise<BookTreeNode[]> => {
    try {
      const response = await fetch(`/api/books/${bookId}/tree`, {
        credentials: "include",
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data as BookTreeNode[];
    } catch {
      return [];
    }
  };

  const initializeOrganizer = async (schemaLevels: string[], bookId: number) => {
    // Load existing tree structure
    const tree = await loadBookTree(bookId);
    setBookTree(tree);

    // Initialize basket items as flat list at leaf level
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
    setSelectedParentNodeId(null);
    setSelectedParentLevel("");
    setShowAddToBook(false);
    setShowOrganizer(true);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addOrganizationalNode = (level: string, levelOrder: number, title: string) => {
    // Verify that this level can have organizational nodes (not leaf level)
    if (!canAddAtLevel(level, targetSchemaLevels, "placeholder")) {
      setMessage(`✗ Cannot create organizational nodes at ${level} level`);
      return;
    }

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      await initializeOrganizer(schema.levels, newBook.id);
      setLoading(false);
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
      await initializeOrganizer(schema.levels, selectedBook);
      setLoading(false);
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
      // All basket items go as direct children of selected parent (or root if none selected)
      const leafLevel = targetSchemaLevels[targetSchemaLevels.length - 1];
      const leafLevelOrder = targetSchemaLevels.length;
      
      let createdCount = 0;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let createPayload: Record<string, unknown> = {
          book_id: targetBookId,
          parent_node_id: selectedParentNodeId,
          level_name: leafLevel,
          level_order: leafLevelOrder,
        };

        if (insertMode === "reference" || !canCopyExistingContent) {
          const nodeResponse = await fetch(`/api/nodes/${item.node_id}`, {
            credentials: "include",
          });

          if (!nodeResponse.ok) {
            throw new Error(`Failed to load source node ${item.node_id}`);
          }

          const originalNode = await nodeResponse.json();
          const sourceNodeId = originalNode.referenced_node_id ?? item.node_id;
          createPayload = {
            ...createPayload,
            referenced_node_id: sourceNodeId,
            title_sanskrit: originalNode.title_sanskrit,
            title_transliteration: originalNode.title_transliteration,
            title_english: originalNode.title_english,
            title_hindi: originalNode.title_hindi,
            title_tamil: originalNode.title_tamil,
            has_content: false,
            content_data: {},
            summary_data: {},
            license_type: "CC-BY-SA-4.0",
            tags: [],
          };
        } else {
          const nodeResponse = await fetch(`/api/nodes/${item.node_id}`, {
            credentials: "include",
          });

          if (!nodeResponse.ok) {
            throw new Error(`Failed to load source node ${item.node_id}`);
          }

          const originalNode = await nodeResponse.json();
          createPayload = {
            ...createPayload,
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
          };
        }

        const createResponse = await fetch("/api/nodes", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createPayload),
        });

        if (!createResponse.ok) {
          const detailPayload = await createResponse.json().catch(() => null) as { detail?: string } | null;
          throw new Error(
            `Failed to create node for item ${item.node_id}${detailPayload?.detail ? `: ${detailPayload.detail}` : ""}`
          );
        }

        createdCount += 1;
      }

      if (createdCount === 0) {
        throw new Error("No items were added.");
      }

      const actionWord = insertMode === "reference" || !canCopyExistingContent ? "Added references for" : "Copied";
      setMessage(`✓ ${actionWord} ${createdCount} item${createdCount === 1 ? "" : "s"} to book`);
      
      // Clear basket and close organizer after success
      setTimeout(() => {
        onClearBasket();
        setShowOrganizer(false);
        setSelectedParentNodeId(null);
        setSelectedParentLevel("");
        setMessage(null);
        if (onItemsAdded) onItemsAdded();
      }, 1500);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to add items"}`);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addOrganizedNodesToBook = async (
    bookId: number,
    tree: OrganizedNode[],
    parentNodeId: number | null = null
  ): Promise<number> => {
    let createdCount = 0;

    for (const node of tree) {
      let createdNodeId: number | null = null;

      if (node.type === "content" && node.node_id) {
        let createPayload: Record<string, unknown> = {
          book_id: bookId,
          parent_node_id: parentNodeId,
          level_name: node.target_level,
          level_order: node.target_level_order,
          sequence_number: String(node.sequence_number),
        };

        if (insertMode === "reference" || !canCopyExistingContent) {
          const nodeResponse = await fetch(`/api/nodes/${node.node_id}`, {
            credentials: "include",
          });

          if (!nodeResponse.ok) {
            const details = await nodeResponse.text().catch(() => "");
            throw new Error(
              `Failed to load source node ${node.node_id}${details ? `: ${details}` : ""}`
            );
          }

          const originalNode = await nodeResponse.json();
          const sourceNodeId = originalNode.referenced_node_id ?? node.node_id;
          createPayload = {
            ...createPayload,
            referenced_node_id: sourceNodeId,
            title_sanskrit: originalNode.title_sanskrit,
            title_transliteration: originalNode.title_transliteration,
            title_english: originalNode.title_english,
            title_hindi: originalNode.title_hindi,
            title_tamil: originalNode.title_tamil,
            has_content: false,
            content_data: {},
            summary_data: {},
            license_type: "CC-BY-SA-4.0",
            tags: [],
          };
        } else {
          const nodeResponse = await fetch(`/api/nodes/${node.node_id}`, {
            credentials: "include",
          });

          if (!nodeResponse.ok) {
            const details = await nodeResponse.text().catch(() => "");
            throw new Error(
              `Failed to load source node ${node.node_id}${details ? `: ${details}` : ""}`
            );
          }

          const originalNode = await nodeResponse.json();
          createPayload = {
            ...createPayload,
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
          };
        }

        const createResponse = await fetch("/api/nodes", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createPayload),
        });

        if (!createResponse.ok) {
          const details = await createResponse.text().catch(() => "");
          throw new Error(
            `Failed to create content node${details ? `: ${details}` : ""}`
          );
        }

        const created = await createResponse.json();
        createdNodeId = created.id;
        createdCount += 1;
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
            sequence_number: String(node.sequence_number),
            title_english: node.title,
            has_content: false,
            content_data: {},
            summary_data: {},
            license_type: "CC-BY-SA-4.0",
            tags: [],
          }),
        });

        if (!createResponse.ok) {
          const details = await createResponse.text().catch(() => "");
          throw new Error(
            `Failed to create organizational node${details ? `: ${details}` : ""}`
          );
        }

        const created = await createResponse.json();
        createdNodeId = created.id;
        createdCount += 1;
      }

      // Recursively create children
      if (node.children.length > 0 && createdNodeId) {
        createdCount += await addOrganizedNodesToBook(bookId, node.children, createdNodeId);
      }
    }

    return createdCount;
  };

  return (
    <>
      {/* Floating Basket Button */}
      <div
        ref={widgetContainerRef}
        className="fixed z-40"
        style={{ left: `${widgetPosition.x}px`, top: `${widgetPosition.y}px` }}
      >
        <div className="mb-1 flex justify-center">
          <button
            type="button"
            onPointerDown={handleDragStart}
            className="rounded-full border border-black/10 bg-white/95 px-2 py-1 text-xs text-zinc-500 shadow-sm transition hover:bg-white hover:text-zinc-700 cursor-grab active:cursor-grabbing"
            style={{ touchAction: "none" }}
            title="Drag basket widget"
            aria-label="Drag basket widget"
          >
            ⠿
          </button>
        </div>
        <div className="group relative">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 font-medium text-white shadow-lg transition hover:shadow-xl"
            title={basketButtonTooltip}
            aria-label={basketButtonTooltip}
          >
            <span aria-hidden="true">🧺</span>
            {items.length > 0 && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[color:var(--accent)]">
                {items.length}
              </span>
            )}
          </button>
          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 rounded-md border border-black/10 bg-white/95 px-2 py-1 text-xs text-zinc-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 whitespace-nowrap">
            {basketButtonTooltip}
          </div>
        </div>
      </div>

      {/* Expanded Panel */}
      {isExpanded && (
        <div
          className="fixed z-40 w-96 rounded-2xl border border-black/10 bg-white/95 shadow-2xl backdrop-blur-sm"
          style={{ left: `${panelLeft}px`, top: `${panelTop}px` }}
        >
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
                {licensePolicyLoading && (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                    Checking license policy…
                  </div>
                )}
                {licensePolicyError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {licensePolicyError}
                  </div>
                )}
                {licensePolicyReport && licensePolicyReport.status !== "pass" && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      licensePolicyReport.status === "block"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    <div>
                      {licensePolicyReport.status === "block"
                        ? `${licensePolicyReport.blocked_issues.length} blocked source license(s) in basket. Snapshot publish will be blocked.`
                        : `${licensePolicyReport.warning_issues.length} source license warning(s) in basket. Review before publish.`}
                    </div>
                    <div className="mt-1 space-y-1">
                      {licensePolicyReport.warning_issues.map((issue) => {
                        const item = items.find((candidate) => candidate.node_id === issue.source_node_id);
                        const label = item?.title || `Node ${issue.source_node_id}`;
                        return (
                          <button
                            key={`warn-${issue.source_node_id}-${issue.license_type}`}
                            type="button"
                            onClick={() => scrollToBasketItem(issue.source_node_id)}
                            className="block text-left underline decoration-dotted underline-offset-2"
                          >
                            ⚠ {label} — {issue.license_type}
                          </button>
                        );
                      })}
                      {licensePolicyReport.blocked_issues.map((issue) => {
                        const item = items.find((candidate) => candidate.node_id === issue.source_node_id);
                        const label = item?.title || `Node ${issue.source_node_id}`;
                        return (
                          <button
                            key={`block-${issue.source_node_id}-${issue.license_type}`}
                            type="button"
                            onClick={() => scrollToBasketItem(issue.source_node_id)}
                            className="block text-left underline decoration-dotted underline-offset-2"
                          >
                            ✗ {label} — {issue.license_type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {items
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((item, index, arr) => (
                  <div
                    key={item.node_id}
                    ref={(element) => {
                      basketItemRefs.current[item.node_id] = element;
                    }}
                    className={`flex items-start justify-between gap-2 rounded-lg border bg-white/80 p-3 transition-all ${
                      highlightedBasketNodeId === item.node_id
                        ? "border-emerald-300 ring-2 ring-emerald-200"
                        : "border-black/10"
                    }`}
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
                    <div className="flex items-center gap-2">
                      {onMoveItem && (
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          {index + 1}
                        </span>
                      )}
                      {onMoveItem && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onMoveItem(item.node_id, "up")}
                            disabled={reorderLoading || index === 0}
                            className="rounded border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40"
                            aria-label="Move up"
                            title="Move up"
                          >
                            ↑ Up
                          </button>
                          <button
                            type="button"
                            onClick={() => onMoveItem(item.node_id, "down")}
                            disabled={reorderLoading || index === arr.length - 1}
                            className="rounded border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40"
                            aria-label="Move down"
                            title="Move down"
                          >
                            ↓ Down
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => onRemoveItem(item.node_id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t border-black/10 p-4">
              {panelMessage && (
                <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {panelMessage}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCreateDraftFromBasket}
                  disabled={loading || creatingDraft}
                  className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  {creatingDraft ? "Creating Draft..." : "Create Draft"}
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleAddToBookClick}
                  disabled={loading || creatingDraft}
                  className="flex-1 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:shadow-lg disabled:opacity-50"
                >
                  Add to Book
                </button>
                <button
                  onClick={onClearBasket}
                  disabled={loading || creatingDraft}
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

            <div className="mx-6 mt-4 rounded-2xl border border-black/10 bg-white/90 p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                Add Mode
              </div>
              <div className="flex gap-2">
                {canCopyExistingContent && (
                  <button
                    onClick={() => setInsertMode("copy")}
                    disabled={loading}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      insertMode === "copy"
                        ? "border border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                        : "border border-black/10 bg-white text-zinc-700 hover:border-[color:var(--accent)]"
                    }`}
                  >
                    Copy (independent)
                  </button>
                )}
                <button
                  onClick={() => setInsertMode("reference")}
                  disabled={loading}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    insertMode === "reference" || !canCopyExistingContent
                      ? "border border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                      : "border border-black/10 bg-white text-zinc-700 hover:border-[color:var(--accent)]"
                  }`}
                >
                  Reference (linked)
                </button>
              </div>
              {!canCopyExistingContent && (
                <p className="mt-2 text-xs text-zinc-500">
                  Existing content can only be inserted as references.
                </p>
              )}
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
              {/* Left: Existing Book Tree (insertion point selector) */}
              <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/90">
                <div className="border-b border-black/10 p-4">
                  <h3 className="font-medium text-[color:var(--deep)]">
                    Select Insertion Point
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Click nodes in the full book tree to insert as children or siblings where valid
                  </p>
                  {selectedParentLevel && (
                    <p className="mt-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                      Selected: <span className="font-medium">{selectedParentLevel}</span>
                    </p>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {bookTree.length === 0 ? (
                    <p className="text-center text-sm text-zinc-500">
                      {bookTree.length === 0 ? "Empty book - items will be added at root level" : "No items yet"}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {bookTree.map((node) => (
                        <BookTreeNodeItem
                          key={node.id}
                          node={node}
                          depth={0}
                          schemaLevels={targetSchemaLevels}
                          selectedNodeInfo={selectedNodeInfo}
                          onSelect={(nodeId, level, parentId, isLeaf, label) => {
                            setSelectedNodeInfo({ id: nodeId, level, parentId, isLeaf, label });
                            setSelectedParentNodeId(parentId);
                            setSelectedParentLevel(`${label} → ${level}`);
                          }}
                          parentNodeId={null}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Items to Add */}
              <div className="w-96 flex flex-col gap-4">
                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4">
                  <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                    <h4 className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
                      Items to Add ({organizedTree.length})
                    </h4>
                    {organizedTree.length === 0 ? (
                      <p className="text-xs text-zinc-500">
                        Your basket is empty
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {organizedTree.map((node) => (
                          <div
                            key={node.id}
                            className="rounded-lg border border-black/10 bg-white p-3 text-sm"
                          >
                            <div className="font-medium text-zinc-900">{node.title}</div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {node.type === "content" ? "Content Item" : "Organizational"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedParentLevel && organizedTree.length > 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <h4 className="mb-2 text-sm font-medium text-emerald-900">
                        Will be added as:
                      </h4>
                      <p className="text-xs text-emerald-700">
                        <strong>Insertion type:</strong> {selectedNodeInfo?.isLeaf ? "Siblings" : "Children"}
                      </p>
                      <p className="text-xs text-emerald-700">
                        <strong>Selected node:</strong> {selectedNodeInfo?.label || "-"}
                      </p>
                      <p className="text-xs text-emerald-700">
                        <strong>Target level:</strong> {selectedNodeInfo?.level || "-"}
                      </p>
                      <p className="mt-2 text-xs text-emerald-600 italic">
                        {selectedNodeInfo?.isLeaf 
                          ? `Items will be added as siblings to the selected ${selectedNodeInfo?.level} node`
                          : `Items will be added as children of the selected ${selectedNodeInfo?.level?.split(" ")[0]} node`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Fixed buttons at bottom */}
                <button
                  onClick={createOrganizedTree}
                  disabled={(() => {
                    const leafLevel = targetSchemaLevels[targetSchemaLevels.length - 1];
                    const isSingleLevelSchema = targetSchemaLevels.length === 1;
                    const hasValidRootInsert = isSingleLevelSchema && selectedParentNodeId === null;
                    const hasValidParentInsert = selectedParentLevel.endsWith(`→ ${leafLevel}`) && (isSingleLevelSchema || selectedParentNodeId !== null);
                    const hasEmptyMultiLevelTree = bookTree.length === 0 && !isSingleLevelSchema;
                    return loading || items.length === 0 || hasEmptyMultiLevelTree || !(hasValidRootInsert || hasValidParentInsert);
                  })()}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500 px-4 py-3 font-medium text-white transition hover:bg-emerald-600 hover:shadow-lg disabled:opacity-50"
                >
                  {loading
                    ? "Adding to Book..."
                    : insertMode === "reference"
                    ? "Finalize & Add References"
                    : "Finalize & Add Copies"}
                </button>

                {(() => {
                  const leafLevel = targetSchemaLevels[targetSchemaLevels.length - 1];
                  const isSingleLevelSchema = targetSchemaLevels.length === 1;
                  const hasValidRootInsert = isSingleLevelSchema && selectedParentNodeId === null;
                  const hasValidParentInsert = selectedParentLevel.endsWith(`→ ${leafLevel}`) && (isSingleLevelSchema || selectedParentNodeId !== null);
                  const hasEmptyMultiLevelTree = bookTree.length === 0 && !isSingleLevelSchema;
                  const canInsert = !hasEmptyMultiLevelTree && (hasValidRootInsert || hasValidParentInsert);

                  if (canInsert || loading || items.length === 0) return null;

                  return (
                    <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {hasEmptyMultiLevelTree
                        ? "This book has no hierarchy yet. Add the top levels in Scriptures first, then insert basket items at the leaf level."
                        : `Select a valid insertion point that targets the '${leafLevel}' level.`}
                    </p>
                  );
                })()}

                <button
                  onClick={() => {
                    setShowOrganizer(false);
                    setSelectedParentNodeId(null);
                    setSelectedParentLevel("");
                    setSelectedNodeInfo(null);
                  }}
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

  // Determine valid levels for this node based on its type
  const getValidLevels = (): string[] => {
    if (node.type === "content") {
      // Content nodes can only go at leaf level
      return [availableLevels[availableLevels.length - 1]];
    } else {
      // Organizational nodes can go at any non-leaf level
      return availableLevels.slice(0, -1);
    }
  };

  const validLevels = getValidLevels();
  const isValidLevel = validLevels.includes(node.target_level);

  return (
    <div style={{ marginLeft: `${depth * 20}px` }}>
      <div className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${
        !isValidLevel ? "border-red-300 bg-red-50" :
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
            {!isValidLevel && <span className="ml-2 text-red-600 font-medium">Invalid level</span>}
          </div>
        </div>
        <select
          value={node.target_level}
          onChange={(e) => onChangelevel(e.target.value)}
          className={`rounded border px-2 py-1 text-xs outline-none ${
            !isValidLevel 
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-black/10"
          }`}
        >
          {validLevels.map(level => (
            <option key={level} value={level}>{level}</option>
          ))}
          {!isValidLevel && (
            <option value={node.target_level} disabled>
              {node.target_level} (invalid)
            </option>
          )}
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

// Helper component to render existing book tree nodes (clickable for insertion point selection)
function BookTreeNodeItem({
  node,
  depth,
  schemaLevels,
  selectedNodeInfo,
  onSelect,
  parentNodeId,
}: {
  node: BookTreeNode;
  depth: number;
  schemaLevels: string[];
  selectedNodeInfo: { id: number; level: string; parentId: number | null; isLeaf: boolean; label: string } | null;
  onSelect: (nodeId: number, level: string, parentId: number | null, isLeaf: boolean, label: string) => void;
  parentNodeId: number | null;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Check if this node can have children (not at leaf level)
  const canHaveChildren = schemaLevels.indexOf(node.level_name) < schemaLevels.length - 1;
  const isLeafLevel = schemaLevels.indexOf(node.level_name) === schemaLevels.length - 1;
  const isSelected = selectedNodeInfo?.id === node.id;

  // Can select this node if it can have children, OR if it's a leaf node (to add as siblings)
  const isSelectable = canHaveChildren || isLeafLevel;

  return (
    <div style={{ marginLeft: `${depth * 16}px` }}>
      <div
        onClick={() => {
          if (isSelectable) {
            // If leaf node, use its parent as insertion parent (siblings)
            // If non-leaf node, use itself as insertion parent (children)
            const insertionParentId = isLeafLevel ? parentNodeId : node.id;
            const insertionLevel = isLeafLevel 
              ? node.level_name  // siblings at same level
              : schemaLevels[schemaLevels.indexOf(node.level_name) + 1]; // children at next level
            onSelect(node.id, insertionLevel, insertionParentId, isLeafLevel, getBookTreeNodeLabel(node));
          }
        }}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
          isSelected
            ? "border-emerald-500 bg-emerald-50"
            : isSelectable
            ? "border-black/10 bg-white hover:border-emerald-300 hover:bg-emerald-50/50"
            : "border-black/10 bg-gray-50 cursor-not-allowed text-zinc-500"
        }`}
      >
        {node.children && node.children.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="text-xs text-zinc-500"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        )}
        <div className="flex-1">
          <div className={`font-medium ${isSelected ? "text-emerald-900" : "text-zinc-900"}`}>
            {getBookTreeNodeLabel(node)}
          </div>
          <div className="text-xs text-zinc-500">
            {node.level_name}{node.sequence_number ? ` • ${node.sequence_number}` : ""}
            {isLeafLevel && " (add as siblings)"}
          </div>
        </div>
        {isSelected && <span className="text-emerald-600 font-bold">✓</span>}
      </div>
      {isExpanded && node.children && node.children.length > 0 && (
        <div className="mt-1">
          {node.children.map(child => (
            <BookTreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              schemaLevels={schemaLevels}
              selectedNodeInfo={selectedNodeInfo}
              onSelect={onSelect}
              parentNodeId={node.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
