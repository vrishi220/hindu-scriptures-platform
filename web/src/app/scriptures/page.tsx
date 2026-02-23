"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  Link2,
  Pencil,
  Plus,
  Share2,
  ShoppingBasket,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { contentPath } from "../../lib/apiPaths";
import BasketPanel from "../../components/BasketPanel";
import { getMe, invalidateMeCache } from "../../lib/authClient";
import {
  isRomanScript,
  normalizeTransliterationScript,
  transliterateFromDevanagari,
  transliterateFromIast,
  transliterationScriptLabel,
} from "../../lib/indicScript";

type BookOption = {
  id: number;
  book_name: string;
  schema_id?: number | null;
  status?: "draft" | "published";
  visibility?: "private" | "public";
};

type BookDetails = {
  id: number;
  book_name: string;
  schema_id: number | null;
  status?: "draft" | "published";
  visibility?: "private" | "public";
  metadata_json?: {
    owner_id?: number;
    status?: "draft" | "published";
    visibility?: "private" | "public";
    [key: string]: unknown;
  } | null;
  metadata?: {
    owner_id?: number;
    status?: "draft" | "published";
    visibility?: "private" | "public";
    [key: string]: unknown;
  } | null;
  schema?: {
    id: number;
    name: string;
    levels: string[];
  } | null;
};

type SharePermission = "viewer" | "contributor" | "editor";

type BookShare = {
  id: number;
  book_id: number;
  shared_with_user_id: number;
  permission: SharePermission;
  shared_by_user_id: number | null;
  shared_with_email: string;
  shared_with_username: string | null;
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
  title_hindi?: string | null;
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
  title_hindi?: string | null;
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

type UserPreferences = {
  source_language: string;
  transliteration_enabled: boolean;
  transliteration_script: string;
  show_roman_transliteration: boolean;
};

type BookPreviewBlock = {
  section: "body";
  order: number;
  block_type: string;
  template_key: string;
  source_node_id: number | null;
  source_book_id: number | null;
  title: string;
  content: {
    level_name?: string;
    sequence_number?: number | null;
    sanskrit?: string;
    transliteration?: string;
    english?: string;
    text?: string;
    rendered_lines?: Array<{
      field?: string;
      label?: string;
      value?: string;
    }>;
  };
};

type BookPreviewRenderSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_metadata: boolean;
  text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
};

type BookPreviewArtifact = {
  book_id: number;
  book_name: string;
  section_order: Array<"body">;
  sections: {
    body: BookPreviewBlock[];
  };
  book_template?: {
    template_key: string;
    resolved_template_source: string;
    rendered_text: string;
    child_count: number;
  };
  render_settings: BookPreviewRenderSettings;
  warnings?: string[];
};

type BasketItem = {
  cart_item_id?: number;
  node_id: number;
  title?: string;
  order: number;
  book_name?: string;
  level_name?: string;
};

type MetadataCategory = {
  id: number;
  name: string;
  description?: string | null;
  applicable_scopes: string[];
  is_deprecated: boolean;
};

type EffectivePropertyBinding = {
  property_internal_name: string;
  property_display_name: string;
  property_data_type: "text" | "boolean" | "number" | "dropdown" | "date" | "datetime";
  description?: string | null;
  default_value?: unknown;
  is_required?: boolean;
  dropdown_options?: string[] | null;
};

type CategoryEffectiveProperties = {
  category_id: number;
  category_name: string;
  properties: EffectivePropertyBinding[];
};

type ResolvedPropertyValue = {
  property_internal_name: string;
  property_data_type: string;
  value: unknown;
};

type ResolvedMetadata = {
  category_id: number | null;
  property_overrides: Record<string, unknown>;
  properties: ResolvedPropertyValue[];
};

type PropertiesScope = "book" | "node";

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

const normalizeSourceLanguage = (value?: string | null): "english" | "sanskrit" | "hindi" => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "en" || normalized === "eng" || normalized === "english") {
    return "english";
  }
  if (normalized === "sa" || normalized === "sanskrit") {
    return "sanskrit";
  }
  if (normalized === "hi" || normalized === "hindi") {
    return "hindi";
  }
  return "english";
};

const isBookScopedCategory = (category: MetadataCategory): boolean => {
  const scopes = category.applicable_scopes || [];
  return scopes.includes("book") || scopes.includes("all") || scopes.includes("node");
};

const normalizeMetadataValue = (dataType: string, rawValue: unknown): unknown => {
  if (dataType === "boolean") {
    return Boolean(rawValue);
  }

  if (dataType === "number") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return null;
    }
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const stringValue = String(rawValue);
  if (!stringValue.trim()) {
    return null;
  }

  if (dataType === "datetime") {
    const parsed = new Date(stringValue);
    return Number.isNaN(parsed.getTime()) ? stringValue : parsed.toISOString();
  }

  return stringValue;
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const toDatetimeLocalValue = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
  const [, setAuthStatus] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authUserId, setAuthUserId] = useState<number | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [bookVisibilitySubmitting, setBookVisibilitySubmitting] = useState(false);
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
  const activeContentRequestId = useRef(0);
  const activeContentAbortController = useRef<AbortController | null>(null);
  const activeContentNodeId = useRef<number | null>(null);
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
  const [showBookPreview, setShowBookPreview] = useState(false);
  const [bookPreviewLoading, setBookPreviewLoading] = useState(false);
  const [bookPreviewError, setBookPreviewError] = useState<string | null>(null);
  const [bookPreviewArtifact, setBookPreviewArtifact] = useState<BookPreviewArtifact | null>(null);
  const [bookBodyAddLoading, setBookBodyAddLoading] = useState(false);
  const [bookBodyCreateDraftLoading, setBookBodyCreateDraftLoading] = useState(false);
  const [bookBodyAddMessage, setBookBodyAddMessage] = useState<string | null>(null);
  const [showShareManager, setShowShareManager] = useState(false);
  const [schemas, setSchemas] = useState<SchemaOption[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
  const [bookFormData, setBookFormData] = useState({
    bookName: "",
    bookCode: "",
    languagePrimary: "sanskrit",
  });
  const [bookSubmitting, setBookSubmitting] = useState(false);
  const [bookShares, setBookShares] = useState<BookShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<SharePermission>("viewer");
  const [sharesSubmitting, setSharesSubmitting] = useState(false);
  const [shareUpdatingUserId, setShareUpdatingUserId] = useState<number | null>(null);
  const [shareRemovingUserId, setShareRemovingUserId] = useState<number | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [isReorderingBasket, setIsReorderingBasket] = useState(false);
  const [basketItems, setBasketItems] = useState<BasketItem[]>([]);
  const [metadataCategories, setMetadataCategories] = useState<MetadataCategory[]>([]);
  const [metadataCategoriesLoading, setMetadataCategoriesLoading] = useState(false);
  const [showPropertiesModal, setShowPropertiesModal] = useState(false);
  const [propertiesScope, setPropertiesScope] = useState<PropertiesScope>("book");
  const [propertiesNodeId, setPropertiesNodeId] = useState<number | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesSaving, setPropertiesSaving] = useState(false);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [propertiesMessage, setPropertiesMessage] = useState<string | null>(null);
  const [propertiesCategoryId, setPropertiesCategoryId] = useState<number | null>(null);
  const [propertiesEffectiveFields, setPropertiesEffectiveFields] = useState<EffectivePropertyBinding[]>([]);
  const [propertiesValues, setPropertiesValues] = useState<Record<string, unknown>>({});
  const [showBookActionsMenu, setShowBookActionsMenu] = useState(false);
  const [showNodeActionsMenu, setShowNodeActionsMenu] = useState(false);
  const bookActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const nodeActionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bookActionsMenuRef.current && !bookActionsMenuRef.current.contains(target)) {
        setShowBookActionsMenu(false);
      }
      if (nodeActionsMenuRef.current && !nodeActionsMenuRef.current.contains(target)) {
        setShowNodeActionsMenu(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    setShowBookActionsMenu(false);
  }, [bookId]);

  useEffect(() => {
    setShowNodeActionsMenu(false);
  }, [selectedId]);

  const resolvePreviewContentLines = (
    block: BookPreviewBlock,
    settings?: BookPreviewRenderSettings
  ) => {
    const resolvedSettings: BookPreviewRenderSettings =
      settings || {
        show_sanskrit: true,
        show_transliteration: true,
        show_english: true,
        show_metadata: true,
        text_order: ["sanskrit", "transliteration", "english", "text"],
      };

    const visibleByKey: Record<string, boolean> = {
      sanskrit: resolvedSettings.show_sanskrit,
      transliteration: resolvedSettings.show_transliteration,
      english: resolvedSettings.show_english,
      text: true,
    };

    const lineClassNameForField = (fieldName: string) =>
      fieldName === "sanskrit"
        ? "text-base text-[color:var(--deep)]"
        : fieldName === "transliteration"
          ? "text-sm italic text-zinc-700"
          : "text-sm text-zinc-700";

    const lines: Array<{ key: string; label: string; value: string; className: string }> = [];
    const renderedLines = Array.isArray(block.content.rendered_lines) ? block.content.rendered_lines : [];
    if (renderedLines.length > 0) {
      let previousFieldName = "";
      for (let index = 0; index < renderedLines.length; index += 1) {
        const line = renderedLines[index];
        const value = (line?.value || "").trim();
        if (!value) {
          continue;
        }

        const fieldName = (line?.field || "text").trim().toLowerCase();
        if (fieldName in visibleByKey && !visibleByKey[fieldName]) {
          continue;
        }

        const rawLabel = (line?.label || "").trim();
        const label = fieldName === previousFieldName ? "" : rawLabel;

        lines.push({
          key: `${fieldName || "line"}-${index}`,
          label,
          value,
          className: lineClassNameForField(fieldName),
        });

        previousFieldName = fieldName;
      }

      if (lines.length > 0) {
        return lines;
      }
    }

    for (const key of resolvedSettings.text_order) {
      const value = (block.content[key] || "").trim();
      if (!value || !visibleByKey[key]) {
        continue;
      }

      const label =
        key === "sanskrit"
          ? "Sanskrit"
          : key === "transliteration"
            ? "Transliteration"
            : key === "english"
              ? "English"
              : "Text";

      const className = lineClassNameForField(key);

      lines.push({ key, label, value, className });
    }

    if (lines.length === 0) {
      const fallback = (block.content.text || "").trim();
      if (fallback) {
        lines.push({ key: "text", label: "Text", value: fallback, className: "text-sm text-zinc-700" });
      }
    }

    return lines;
  };

  const loadMetadataCategories = async () => {
    setMetadataCategoriesLoading(true);
    try {
      const response = await fetch("/api/metadata/categories", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | MetadataCategory[]
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to load metadata categories");
      }
      const categories = Array.isArray(payload) ? payload : [];
      setMetadataCategories(categories.filter((category) => !category.is_deprecated && isBookScopedCategory(category)));
    } catch {
      setMetadataCategories([]);
    } finally {
      setMetadataCategoriesLoading(false);
    }
  };

  const loadEffectiveProperties = async (categoryId: number) => {
    const response = await fetch(`/api/metadata/categories/${categoryId}/effective-properties`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | CategoryEffectiveProperties
      | { detail?: string }
      | null;
    if (!response.ok) {
      throw new Error((payload as { detail?: string } | null)?.detail || "Failed to load category properties");
    }
    return (payload as CategoryEffectiveProperties).properties || [];
  };

  const propertiesEndpoint = (scope: PropertiesScope, nodeId: number | null) => {
    if (!bookId) {
      throw new Error("Book is required");
    }
    if (scope === "book") {
      return `/api/books/${bookId}/metadata-binding`;
    }
    if (!nodeId) {
      throw new Error("Node is required");
    }
    return `/api/books/${bookId}/nodes/${nodeId}/metadata-binding`;
  };

  const openPropertiesModal = async (scope: PropertiesScope, nodeId: number | null = null) => {
    if (!bookId) return;
    if (scope === "node" && !nodeId) return;

    setShowPropertiesModal(true);
    setPropertiesScope(scope);
    setPropertiesNodeId(nodeId);
    setPropertiesLoading(true);
    setPropertiesSaving(false);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const endpoint = propertiesEndpoint(scope, nodeId);
      const response = await fetch(endpoint, {
        credentials: "include",
        cache: "no-store",
      });

      let binding: ResolvedMetadata | null = null;
      if (response.ok) {
        binding = (await response.json()) as ResolvedMetadata;
      } else if (response.status !== 404) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Failed to load metadata properties");
      }

      const categoryId = binding?.category_id ?? null;
      if (!categoryId) {
        setPropertiesCategoryId(null);
        setPropertiesEffectiveFields([]);
        setPropertiesValues({});
        return;
      }

      const effective = await loadEffectiveProperties(categoryId);
      const values: Record<string, unknown> = {};
      effective.forEach((field) => {
        values[field.property_internal_name] = field.default_value ?? null;
      });
      if (binding) {
        binding.properties.forEach((item) => {
          values[item.property_internal_name] = item.value ?? null;
        });
        Object.entries(binding.property_overrides || {}).forEach(([key, value]) => {
          values[key] = value;
        });
      }

      setPropertiesCategoryId(categoryId);
      setPropertiesEffectiveFields(effective);
      setPropertiesValues(values);
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to load metadata");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const handlePropertiesCategoryChange = async (nextCategoryIdRaw: string) => {
    const nextCategoryId = Number(nextCategoryIdRaw);
    if (!Number.isFinite(nextCategoryId) || nextCategoryId <= 0) {
      setPropertiesCategoryId(null);
      setPropertiesEffectiveFields([]);
      setPropertiesValues({});
      setPropertiesError(null);
      setPropertiesMessage(null);
      return;
    }

    setPropertiesLoading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const effective = await loadEffectiveProperties(nextCategoryId);
      const values: Record<string, unknown> = {};
      effective.forEach((field) => {
        values[field.property_internal_name] = field.default_value ?? null;
      });
      setPropertiesCategoryId(nextCategoryId);
      setPropertiesEffectiveFields(effective);
      setPropertiesValues(values);
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to load category metadata properties");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const handlePropertiesValueChange = (propertyName: string, value: unknown) => {
    setPropertiesValues((prev) => ({
      ...prev,
      [propertyName]: value,
    }));
    setPropertiesMessage(null);
    setPropertiesError(null);
  };

  const handleSaveProperties = async () => {
    if (!propertiesCategoryId) {
      setPropertiesError("Select a category before saving");
      return;
    }

    const propertyOverrides: Record<string, unknown> = {};
    propertiesEffectiveFields.forEach((field) => {
      const currentValue = normalizeMetadataValue(field.property_data_type, propertiesValues[field.property_internal_name]);
      const defaultValue = normalizeMetadataValue(field.property_data_type, field.default_value ?? null);
      if (!valuesEqual(currentValue, defaultValue)) {
        propertyOverrides[field.property_internal_name] = currentValue;
      }
    });

    setPropertiesSaving(true);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const endpoint = propertiesEndpoint(propertiesScope, propertiesNodeId);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: propertiesCategoryId,
          property_overrides: propertyOverrides,
          unset_overrides: [],
        }),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to save properties");
      }

      setPropertiesMessage("Properties saved");
      await openPropertiesModal(propertiesScope, propertiesNodeId);
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to save properties");
    } finally {
      setPropertiesSaving(false);
    }
  };

  const loadBasket = async () => {
    try {
      const response = await fetch("/api/cart/me", { credentials: "include" });
      if (!response.ok) {
        setBasketItems([]);
        return;
      }
      const data = (await response.json()) as {
        items?: Array<{
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            book_name?: string;
            level_name?: string;
          };
        }>;
      };

      const mappedItems = (data.items || [])
        .map((item) => ({
          cart_item_id: item.id,
          node_id: item.item_id,
          title: item.metadata?.title,
          book_name: item.metadata?.book_name,
          level_name: item.metadata?.level_name,
          order: item.order,
        }))
        .sort((a, b) => a.order - b.order);

      setBasketItems(mappedItems);
    } catch {
      setBasketItems([]);
    }
  };

  const loadAuth = async () => {
    try {
      const data = await getMe();
      if (!data) {
        setAuthEmail(null);
        setAuthUserId(null);
        setAuthStatus("Not authenticated");
        setCanAdmin(false);
        setCanContribute(false);
        setCanEdit(false);
        return;
      }
      setAuthUserId(data.id ?? null);
      setAuthEmail(data.email || null);
      setAuthStatus(data.email ? `Signed in as ${data.email}` : "Authenticated");
      setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
      setCanContribute(Boolean(data.permissions?.can_contribute || data.role === "contributor" || data.role === "editor" || data.role === "admin"));
      setCanEdit(Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin"));
    } catch {
      setAuthEmail(null);
      setAuthUserId(null);
      setAuthStatus("Auth check failed");
      setCanAdmin(false);
      setCanContribute(false);
      setCanEdit(false);
    } finally {
      setAuthResolved(true);
    }
  };

  useEffect(() => {
    loadAuth();
  }, []);

  const currentBookMetadata =
    currentBook?.metadata_json || currentBook?.metadata || null;
  const currentBookOwnerId =
    typeof currentBookMetadata?.owner_id === "number"
      ? currentBookMetadata.owner_id
      : null;
  const canTogglePublish =
    Boolean(bookId) &&
    Boolean(currentBook) &&
    (canAdmin || (authUserId !== null && currentBookOwnerId === authUserId));
  const canManageShares = canTogglePublish;

  const handleTogglePublish = async () => {
    if (!bookId || !currentBook) return;
    const isPublic = (currentBook.visibility || "private") === "public";
    const payload = isPublic
      ? { status: "draft", visibility: "private" }
      : { status: "published", visibility: "public" };

    try {
      setBookVisibilitySubmitting(true);
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => null)) as
        | BookDetails
        | { detail?: string }
        | null;

      if (!response.ok) {
        alert(
          (result as { detail?: string } | null)?.detail ||
            "Failed to update publish state"
        );
        return;
      }

      const updatedBook = result as BookDetails;
      setCurrentBook(updatedBook);
      setBooks((prev) =>
        prev.map((book) =>
          book.id.toString() === bookId
            ? {
                ...book,
                status: updatedBook.status,
                visibility: updatedBook.visibility,
              }
            : book
        )
      );
    } catch {
      alert("Failed to update publish state");
    } finally {
      setBookVisibilitySubmitting(false);
    }
  };

  useEffect(() => {
    if (!authResolved) return;

    if (!authEmail) {
      setBasketItems([]);
      return;
    }
    void loadBasket();
  }, [authResolved, authEmail]);

  useEffect(() => {
    const loadPreferences = async () => {
      if (!authEmail) {
        setPreferences(null);
        return;
      }
      try {
        const response = await fetch("/api/preferences", { credentials: "include" });
        if (!response.ok) return;
        const data = (await response.json()) as UserPreferences;
        setPreferences({
          ...data,
          source_language: normalizeSourceLanguage(data.source_language),
          transliteration_script: normalizeTransliterationScript(data.transliteration_script),
        });
      } catch {
        setPreferences(null);
      }
    };

    loadPreferences();
  }, [authEmail]);

  useEffect(() => {
    if (!authEmail) {
      setMetadataCategories([]);
      return;
    }
    void loadMetadataCategories();
  }, [authEmail]);

  const addCurrentToBasket = () => {
    if (!nodeContent) return;

    void (async () => {
      if (basketItems.some((item) => item.node_id === nodeContent.id)) {
        return;
      }

      const seq = formatSequenceDisplay(
        nodeContent.sequence_number ?? nodeContent.id,
        Boolean(nodeContent.has_content)
      ) || nodeContent.id;
      const title = `${formatValue(nodeContent.level_name) || "Level"} ${seq}`;

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            item_id: nodeContent.id,
            item_type: "library_node",
            metadata: {
              title,
              book_name: currentBook?.book_name,
              level_name: nodeContent.level_name,
            },
          }),
        });

        if (response.status === 409) {
          await loadBasket();
          return;
        }

        if (!response.ok) {
          return;
        }

        const item = (await response.json()) as {
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            book_name?: string;
            level_name?: string;
          };
        };

        setBasketItems((prev) =>
          [
            ...prev,
            {
              cart_item_id: item.id,
              node_id: item.item_id,
              title: item.metadata?.title || title,
              book_name: item.metadata?.book_name || currentBook?.book_name,
              level_name: item.metadata?.level_name || nodeContent.level_name,
              order: item.order,
            },
          ].sort((a, b) => a.order - b.order)
        );
      } catch {
        // ignore basket add failures for now
      }
    })();
  };

  const removeFromBasket = (nodeId: number) => {
    void (async () => {
      const target = basketItems.find((item) => item.node_id === nodeId);
      if (!target?.cart_item_id) {
        setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
        return;
      }

      try {
        const response = await fetch(`/api/cart/items/${target.cart_item_id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok && response.status !== 404) {
          return;
        }
        setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));
      } catch {
        // ignore basket remove failures for now
      }
    })();
  };

  const moveBasketItem = (nodeId: number, direction: "up" | "down") => {
    void (async () => {
      if (isReorderingBasket) return;

      setIsReorderingBasket(true);
      const current = [...basketItems].sort((a, b) => a.order - b.order);
      const index = current.findIndex((item) => item.node_id === nodeId);
      if (index === -1) {
        setIsReorderingBasket(false);
        return;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        setIsReorderingBasket(false);
        return;
      }

      const [moved] = current.splice(index, 1);
      current.splice(targetIndex, 0, moved);

      const reordered = current.map((item, idx) => ({ ...item, order: idx }));
      setBasketItems(reordered);

      const itemOrder = reordered
        .map((item) => item.cart_item_id)
        .filter((id): id is number => typeof id === "number");

      if (itemOrder.length !== reordered.length) {
        await loadBasket();
        return;
      }

      try {
        const response = await fetch("/api/cart/items/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ item_order: itemOrder }),
        });

        if (!response.ok) {
          await loadBasket();
        }
      } catch {
        await loadBasket();
      } finally {
        setIsReorderingBasket(false);
      }
    })();
  };

  const clearBasket = () => {
    void (async () => {
      try {
        await fetch("/api/cart/me", {
          method: "DELETE",
          credentials: "include",
        });
      } finally {
        setBasketItems([]);
      }
    })();
  };

  const savePreferences = async () => {
    if (!preferences) return;
    try {
      setPreferencesSaving(true);
      setPreferencesMessage(null);
      const response = await fetch("/api/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to save preferences");
      }
      setPreferencesMessage("Preferences saved");
    } catch (err) {
      setPreferencesMessage(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setPreferencesSaving(false);
      setTimeout(() => setPreferencesMessage(null), 2000);
    }
  };

  const sourceLanguage = normalizeSourceLanguage(preferences?.source_language);
  const transliterationScript = normalizeTransliterationScript(preferences?.transliteration_script);
  const scriptPrefersRoman = isRomanScript(transliterationScript);
  const transliterationEnabled = preferences?.transliteration_enabled ?? true;
  const showRomanTransliteration = preferences?.show_roman_transliteration ?? true;
  const showTransliteration =
    transliterationEnabled && (!scriptPrefersRoman || showRomanTransliteration);

  const renderTransliterationByPreference = (value: string): string => {
    if (!value) return "";
    return transliterateFromIast(value, transliterationScript);
  };

  const renderSanskritByPreference = (
    sanskritValue: string,
    transliterationValue?: string
  ): string => {
    if (!sanskritValue && !transliterationValue) {
      return "";
    }

    if (sanskritValue) {
      return sanskritValue;
    }

    if (!transliterationValue) {
      return "";
    }

    return renderTransliterationByPreference(transliterationValue);
  };

  const getPreferredTitle = (node: TreeNode | NodeContent): string => {
    const sanskritTitle = renderSanskritByPreference(
      formatValue(node.title_sanskrit),
      formatValue(node.title_transliteration)
    );

    if (sourceLanguage === "sanskrit") {
      return (
        sanskritTitle ||
        formatValue(node.title_english) ||
        formatValue(node.title_hindi)
      );
    }
    if (sourceLanguage === "hindi") {
      return (
        formatValue(node.title_hindi) ||
        formatValue(node.title_english) ||
        sanskritTitle
      );
    }
    return (
      formatValue(node.title_english) ||
      formatValue(node.title_hindi) ||
      sanskritTitle
    );
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const isCurrentNodeAlreadyLoading =
          activeContentNodeId.current === nodeId;
        if (
          selectedId !== nodeId ||
          (!isCurrentNodeAlreadyLoading && nodeContent?.id !== nodeId)
        ) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, urlInitialized, searchParams.get("node"), treeData]);

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
    if (!force && activeContentNodeId.current === nodeId) return;
    if (!force && !contentLoading && nodeContent?.id === nodeId) return;

    activeContentAbortController.current?.abort();
    const abortController = new AbortController();
    activeContentAbortController.current = abortController;
    const requestId = activeContentRequestId.current + 1;
    activeContentRequestId.current = requestId;
    activeContentNodeId.current = nodeId;

    lastLoadedNodeId.current = nodeId;
    setContentLoading(true);
    try {
      const response = await fetch(contentPath(`/nodes/${nodeId}`), {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeContentRequestId.current) return;
      if (response.ok) {
        const data = (await response.json()) as NodeContent;
        if (requestId !== activeContentRequestId.current) return;
        setNodeContent(data);
      } else {
        if (requestId !== activeContentRequestId.current) return;
        setNodeContent(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      console.error("Content load error:", err);
      if (requestId !== activeContentRequestId.current) return;
      setNodeContent(null);
    } finally {
      if (requestId === activeContentRequestId.current) {
        setContentLoading(false);
        activeContentNodeId.current = null;
      }
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
    const syncSelectionUrl = (targetNodeId: number) => {
      if (typeof window === "undefined" || !bookId) return;
      const url = new URL(window.location.href);
      const currentBook = url.searchParams.get("book") || "";
      const currentNode = url.searchParams.get("node") || "";
      if (currentBook === bookId && currentNode === String(targetNodeId)) {
        return;
      }
      url.searchParams.set("book", bookId);
      url.searchParams.set("node", String(targetNodeId));
      window.history.replaceState(window.history.state, "", url.toString());
    };

    if (selectedId === nodeId && nodeContent?.id === nodeId && !contentLoading) {
      if (syncUrl && bookId) {
        syncSelectionUrl(nodeId);
      }
      return;
    }

    const path = findPath(treeData, nodeId);
    if (path) {
      applySelection(nodeId, path, false, false);
    } else {
      setSelectedId(nodeId);
      setBreadcrumb([]);
      loadNodeContent(nodeId);
    }
    
    // Update URL with current selection
    if (syncUrl && bookId) {
      syncSelectionUrl(nodeId);
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

  const loadBookShares = async () => {
    if (!bookId) return;
    setSharesLoading(true);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/shares`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | BookShare[]
        | { detail?: string }
        | null;
      if (!response.ok) {
        setBookShares([]);
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to load shares"
        );
        return;
      }
      setBookShares(Array.isArray(payload) ? payload : []);
    } catch {
      setBookShares([]);
      setSharesError("Failed to load shares");
    } finally {
      setSharesLoading(false);
    }
  };

  const handleOpenShareManager = async () => {
    setShowShareManager(true);
    await loadBookShares();
  };

  const handlePreviewBook = async () => {
    if (!bookId) return;

    setBookPreviewLoading(true);
    setBookPreviewError(null);

    try {
      const response = await fetch(`/api/books/${bookId}/preview/render`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookPreviewArtifact
        | { detail?: string }
        | null;

      if (!response.ok) {
        setBookPreviewArtifact(null);
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to render book preview");
      }

      setBookPreviewArtifact(payload as BookPreviewArtifact);
      setShowBookPreview(true);
    } catch (err) {
      setShowBookPreview(false);
      setBookPreviewError(err instanceof Error ? err.message : "Failed to render book preview");
    } finally {
      setBookPreviewLoading(false);
    }
  };

  const handleAddBookAsDraftBody = async () => {
    if (!bookId || bookBodyAddLoading) return;

    setBookBodyAddLoading(true);
    setBookBodyAddMessage(null);

    try {
      const selectedBookId = Number(bookId);
      const response = await fetch("/api/cart/items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: -selectedBookId,
          item_type: "library_node",
          source_book_id: selectedBookId,
          metadata: {
            title: currentBook?.book_name || `Book ${selectedBookId}`,
            book_name: currentBook?.book_name || `Book ${selectedBookId}`,
            level_name: "book",
          },
        }),
      });

      if (response.status !== 409 && !response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Failed to add book to draft body cart");
      }

      await loadBasket();
      setBookBodyAddMessage("Book added as body source. Use Create Draft in Basket.");
      setTimeout(() => setBookBodyAddMessage(null), 2500);
    } catch (err) {
      setBookBodyAddMessage(err instanceof Error ? err.message : "Failed to add book to draft body cart");
    } finally {
      setBookBodyAddLoading(false);
    }
  };

  const handleCreateDraftFromBookBody = async () => {
    if (!bookId || bookBodyCreateDraftLoading) return;

    setBookBodyCreateDraftLoading(true);
    setBookBodyAddMessage(null);

    try {
      const selectedBookId = Number(bookId);
      const addResponse = await fetch("/api/cart/items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: -selectedBookId,
          item_type: "library_node",
          source_book_id: selectedBookId,
          metadata: {
            title: currentBook?.book_name || `Book ${selectedBookId}`,
            book_name: currentBook?.book_name || `Book ${selectedBookId}`,
            level_name: "book",
          },
        }),
      });

      if (addResponse.status !== 409 && !addResponse.ok) {
        const addPayload = (await addResponse.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(addPayload?.detail || "Failed to add book to draft body cart");
      }

      const draftTitle = currentBook?.book_name
        ? `Draft from ${currentBook.book_name}`
        : "Draft from Book";
      const createResponse = await fetch("/api/cart/me/create-draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle,
          clear_cart_after_create: true,
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | { id?: number; detail?: string }
        | null;

      if (!createResponse.ok) {
        throw new Error(createPayload?.detail || "Failed to create draft from book body");
      }

      if (typeof createPayload?.id === "number") {
        window.location.href = `/drafts?draftId=${createPayload.id}`;
        return;
      }

      throw new Error("Draft created, but response did not include an id");
    } catch (err) {
      setBookBodyAddMessage(err instanceof Error ? err.message : "Failed to create draft from book body");
    } finally {
      setBookBodyCreateDraftLoading(false);
    }
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookId || !shareEmail.trim()) return;

    setSharesSubmitting(true);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: shareEmail.trim(),
          permission: sharePermission,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookShare
        | { detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to add share"
        );
        return;
      }
      setShareEmail("");
      setSharePermission("viewer");
      await loadBookShares();
    } catch {
      setSharesError("Failed to add share");
    } finally {
      setSharesSubmitting(false);
    }
  };

  const handleUpdateSharePermission = async (
    sharedUserId: number,
    permission: SharePermission
  ) => {
    if (!bookId) return;

    setShareUpdatingUserId(sharedUserId);
    setSharesError(null);
    try {
      const response = await fetch(
        `/api/books/${bookId}/shares/${sharedUserId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permission }),
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | BookShare
        | { detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to update share"
        );
        return;
      }
      setBookShares((prev) =>
        prev.map((share) =>
          share.shared_with_user_id === sharedUserId
            ? { ...share, permission }
            : share
        )
      );
    } catch {
      setSharesError("Failed to update share");
    } finally {
      setShareUpdatingUserId(null);
    }
  };

  const handleDeleteShare = async (sharedUserId: number) => {
    if (!bookId) return;

    setShareRemovingUserId(sharedUserId);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${bookId}/shares/${sharedUserId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(payload?.detail || "Failed to remove share");
        return;
      }
      setBookShares((prev) =>
        prev.filter((share) => share.shared_with_user_id !== sharedUserId)
      );
    } catch {
      setSharesError("Failed to remove share");
    } finally {
      setShareRemovingUserId(null);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        sequence_number: formData.sequenceNumber ? formData.sequenceNumber.trim() : null,
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSignOut = async () => {
    setBasketItems([]);
    invalidateMeCache();
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                    {book.visibility === "private" ? " (Private draft)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {(bookId || canContribute) && (
              <div ref={bookActionsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowBookActionsMenu((prev) => !prev)}
                  title="Book actions"
                  aria-label="Book actions"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-lg text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                >
                  ⋮
                </button>
                {showBookActionsMenu && (
                  <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                    {bookId && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setShowBookActionsMenu(false);
                            void handleAddBookAsDraftBody();
                          }}
                          disabled={bookBodyAddLoading || bookBodyCreateDraftLoading}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ShoppingBasket size={14} />
                          {bookBodyAddLoading ? "Adding to basket..." : "Add book as body to basket"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowBookActionsMenu(false);
                            void handleCreateDraftFromBookBody();
                          }}
                          disabled={bookBodyCreateDraftLoading || bookBodyAddLoading}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus size={14} />
                          {bookBodyCreateDraftLoading ? "Creating draft..." : "Create draft from book"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowBookActionsMenu(false);
                            void handlePreviewBook();
                          }}
                          disabled={bookPreviewLoading}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Eye size={14} />
                          {bookPreviewLoading ? "Loading preview..." : "Preview book"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/scriptures?book=${bookId}`;
                            navigator.clipboard.writeText(url);
                            setShowBookActionsMenu(false);
                            setAuthMessage("Link copied.");
                            setCopyTarget("book");
                            setTimeout(() => {
                              setAuthMessage(null);
                              setCopyTarget(null);
                            }, 2000);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                        >
                          <Link2 size={14} />
                          Copy book link
                        </button>
                      </>
                    )}
                    {canContribute && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          loadSchemas();
                          setShowCreateBook(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <Plus size={14} />
                        Create book
                      </button>
                    )}
                    {canTogglePublish && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void handleTogglePublish();
                        }}
                        disabled={bookVisibilitySubmitting}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Upload size={14} />
                        {bookVisibilitySubmitting
                          ? "Updating visibility..."
                          : currentBook?.visibility === "public"
                          ? "Unpublish book"
                          : "Publish book"}
                      </button>
                    )}
                    {canManageShares && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void handleOpenShareManager();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <Share2 size={14} />
                        Manage sharing
                      </button>
                    )}
                    {canEdit && bookId && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookActionsMenu(false);
                          void openPropertiesModal("book");
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <SlidersHorizontal size={14} />
                        Book properties
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {isCopyMessage && copyTarget === "book" && !showLogin && (
              <div className="rounded-full bg-blue-500 px-3 py-1 text-[10px] text-white shadow">
                {authMessage}
              </div>
            )}
            {bookId && currentBook && (
              <span
                title={
                  (currentBook.visibility || "private") === "public"
                    ? "Visible to all users"
                    : "Private draft: only you and users you explicitly share this book with can view it"
                }
                aria-label={
                  (currentBook.visibility || "private") === "public"
                    ? "Public visibility"
                    : "Private draft visibility: only you and explicitly shared users can view"
                }
                className="inline-flex h-9 items-center rounded-full border border-black/10 bg-white/80 px-3 text-[10px] uppercase tracking-[0.2em] text-zinc-600"
              >
                {(currentBook.visibility || "private") === "public"
                  ? "Public"
                  : "Private draft"}
              </span>
            )}
          </div>

          {bookPreviewError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {bookPreviewError}
            </div>
          )}

          {bookBodyAddMessage && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {bookBodyAddMessage}
            </div>
          )}

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
                      {!(canEdit || canAdmin) && (
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
                      )}
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
                  <div
                    className="flex items-center justify-between mb-4"
                    onContextMenu={(event) => {
                      if (!(isLeafSelected || canEdit || canAdmin)) {
                        return;
                      }
                      event.preventDefault();
                      setShowBookActionsMenu(false);
                      setShowNodeActionsMenu(true);
                    }}
                  >
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
                      {(isLeafSelected || canEdit || canAdmin) && (
                        <div ref={nodeActionsMenuRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setShowNodeActionsMenu((prev) => !prev)}
                            title="Node actions"
                            aria-label="Node actions"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-sm text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                          >
                            ⋮
                          </button>
                          {showNodeActionsMenu && (
                            <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                              {isLeafSelected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    addCurrentToBasket();
                                  }}
                                  disabled={basketItems.some((item) => item.node_id === nodeContent.id)}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <ShoppingBasket size={14} />
                                  {basketItems.some((item) => item.node_id === nodeContent.id)
                                    ? "Already in basket"
                                    : "Add to basket"}
                                </button>
                              )}
                              {isLeafSelected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
                                    navigator.clipboard.writeText(url);
                                    setShowNodeActionsMenu(false);
                                    setAuthMessage("Link copied.");
                                    setCopyTarget("leaf");
                                    setTimeout(() => {
                                      setAuthMessage(null);
                                      setCopyTarget(null);
                                    }, 2000);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Link2 size={14} />
                                  Copy node link
                                </button>
                              )}
                              {!isLeafSelected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `${window.location.origin}/scriptures?book=${bookId}&node=${selectedId}`;
                                    navigator.clipboard.writeText(url);
                                    setShowNodeActionsMenu(false);
                                    setAuthMessage("Link copied.");
                                    setCopyTarget("node");
                                    setTimeout(() => {
                                      setAuthMessage(null);
                                      setCopyTarget(null);
                                    }, 2000);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Link2 size={14} />
                                  Copy node link
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
                                    void openPropertiesModal("node", nodeContent.id);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <SlidersHorizontal size={14} />
                                  Node properties
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNodeActionsMenu(false);
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
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  <Pencil size={14} />
                                  Edit node
                                </button>
                              )}
                              {canAdmin && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setShowNodeActionsMenu(false);
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
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50"
                                >
                                  <Trash2 size={14} />
                                  Delete node
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {isCopyMessage && copyTarget === "leaf" && !showLogin && (
                        <div className="rounded-full bg-blue-500 px-3 py-1 text-xs text-white shadow">
                          {authMessage}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-6">
                    {authEmail && preferences && (
                      <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                        <div className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
                          Display preferences
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Source language
                            </span>
                            <select
                              value={preferences.source_language}
                              onChange={(event) =>
                                setPreferences({
                                  ...preferences,
                                  source_language: event.target.value,
                                })
                              }
                              className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                            >
                              <option value="sanskrit">Sanskrit</option>
                              <option value="hindi">Hindi</option>
                              <option value="english">English</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Transliteration script
                            </span>
                            <select
                              value={preferences.transliteration_script}
                              onChange={(event) =>
                                setPreferences({
                                  ...preferences,
                                  transliteration_script: normalizeTransliterationScript(
                                    event.target.value
                                  ),
                                })
                              }
                              disabled={!transliterationEnabled}
                              className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="iast">IAST</option>
                              <option value="harvard_kyoto">Harvard-Kyoto</option>
                              <option value="itrans">ITRANS</option>
                              <option value="devanagari">Devanagari</option>
                              <option value="bengali">Bengali</option>
                              <option value="gujarati">Gujarati</option>
                              <option value="gurmukhi">Gurmukhi</option>
                              <option value="kannada">Kannada</option>
                              <option value="malayalam">Malayalam</option>
                              <option value="oriya">Odia</option>
                              <option value="tamil">Tamil</option>
                              <option value="telugu">Telugu</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-2 text-sm text-zinc-700">
                            <input
                              type="checkbox"
                              checked={transliterationEnabled}
                              onChange={(event) =>
                                setPreferences({
                                  ...preferences,
                                  transliteration_enabled: event.target.checked,
                                })
                              }
                            />
                            Enable transliteration
                          </label>
                          <label className="flex items-center gap-2 text-sm text-zinc-700">
                            <input
                              type="checkbox"
                              checked={showRomanTransliteration}
                              disabled={!transliterationEnabled || !scriptPrefersRoman}
                              onChange={(event) =>
                                setPreferences({
                                  ...preferences,
                                  show_roman_transliteration: event.target.checked,
                                })
                              }
                            />
                            Show Roman transliteration
                          </label>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={savePreferences}
                            disabled={preferencesSaving}
                            className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-white transition disabled:opacity-50"
                          >
                            {preferencesSaving ? "Saving..." : "Save prefs"}
                          </button>
                          {preferencesMessage && (
                            <span className="text-xs text-zinc-600">{preferencesMessage}</span>
                          )}
                        </div>
                      </div>
                    )}



                    {/* Titles (hide for verses) */}
                    {!nodeContent.has_content && (
                      <div className="flex flex-col gap-2">
                        {getPreferredTitle(nodeContent) && (
                          <div className="text-xl font-medium text-zinc-900">
                            {getPreferredTitle(nodeContent)}
                          </div>
                        )}
                        {showTransliteration &&
                          (() => {
                            const renderedTitleTransliteration = renderTransliterationByPreference(
                              formatValue(nodeContent.title_transliteration)
                            );
                            if (
                              !renderedTitleTransliteration ||
                              renderedTitleTransliteration === getPreferredTitle(nodeContent)
                            ) {
                              return null;
                            }
                            return (
                              <div className="text-lg italic text-zinc-700">
                                {renderedTitleTransliteration}
                              </div>
                            );
                          })()}
                      </div>
                    )}

                    {/* Content Data */}
                    {nodeContent.has_content && nodeContent.content_data && (
                      <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-white/90 p-4">
                        {(() => {
                          const sanskrit = formatValue(nodeContent.content_data?.basic?.sanskrit);
                          const transliterationRaw = formatValue(
                            nodeContent.content_data?.basic?.transliteration
                          );
                          const transliteration = renderTransliterationByPreference(
                            transliterationRaw
                          );
                          const renderedSanskrit = renderSanskritByPreference(
                            sanskrit,
                            transliterationRaw
                          );
                          const english = formatValue(
                            nodeContent.content_data?.translations?.english ||
                              nodeContent.content_data?.basic?.translation
                          );

                          const primaryContent =
                            sourceLanguage === "sanskrit"
                              ? renderedSanskrit || english
                              : sourceLanguage === "hindi"
                              ? english || renderedSanskrit
                              : english || renderedSanskrit;

                          const primaryLabel =
                            sourceLanguage === "sanskrit"
                              ? "Sanskrit"
                              : sourceLanguage === "hindi"
                              ? "Hindi/Translation"
                              : "English Translation";

                          return (
                            <>
                              {primaryContent && (
                                <div>
                                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                    {primaryLabel}
                                  </div>
                                  <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-900">
                                    {primaryContent}
                                  </div>
                                </div>
                              )}
                              {showTransliteration && transliteration && (
                                <div>
                                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                    Transliteration ({transliterationScriptLabel(transliterationScript)})
                                  </div>
                                  <div className="whitespace-pre-wrap text-base italic leading-relaxed text-zinc-700">
                                    {transliteration}
                                  </div>
                                </div>
                              )}
                              {sourceLanguage !== "sanskrit" &&
                                renderedSanskrit &&
                                renderedSanskrit !== primaryContent && (
                                <div>
                                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                    Sanskrit
                                  </div>
                                  <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                                    {renderedSanskrit}
                                  </div>
                                </div>
                              )}
                              {sourceLanguage !== "english" && english && english !== primaryContent && (
                                <div>
                                  <div className="mb-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                                    English Translation
                                  </div>
                                  <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-700">
                                    {english}
                                  </div>
                                </div>
                              )}
                            </>
                          );
                        })()}
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

        {showPropertiesModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {propertiesScope === "book" ? "Book Properties" : "Node Properties"}
                  </h2>
                  <p className="text-sm text-zinc-600">
                    Base properties: Name, Description, Category. Other fields are category metadata properties.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPropertiesModal(false);
                    setPropertiesMessage(null);
                    setPropertiesError(null);
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Name</span>
                  <input
                    type="text"
                    readOnly
                    value={
                      propertiesScope === "book"
                        ? currentBook?.book_name || ""
                        : nodeContent?.title_english || nodeContent?.title_sanskrit || nodeContent?.title_transliteration || `Node ${propertiesNodeId || ""}`
                    }
                    className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Description</span>
                  <textarea
                    readOnly
                    value={
                      propertiesScope === "book"
                        ? (typeof (currentBook?.metadata_json || currentBook?.metadata || {})?.description === "string"
                            ? String((currentBook?.metadata_json || currentBook?.metadata || {}).description)
                            : "")
                        : `${nodeContent?.level_name || "Node"} ${formatSequenceDisplay(nodeContent?.sequence_number, Boolean(nodeContent?.has_content)) || propertiesNodeId || ""}`
                    }
                    rows={2}
                    className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Category</span>
                  <select
                    value={propertiesCategoryId?.toString() || ""}
                    onChange={(event) => {
                      void handlePropertiesCategoryChange(event.target.value);
                    }}
                    disabled={propertiesLoading || metadataCategoriesLoading}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
                  >
                    <option value="">Select category</option>
                    {metadataCategories.map((category) => (
                      <option key={category.id} value={category.id.toString()}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                {propertiesLoading && (
                  <p className="text-xs text-zinc-500">Loading metadata properties...</p>
                )}

                {propertiesError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {propertiesError}
                  </div>
                )}

                {!propertiesLoading && propertiesCategoryId && propertiesEffectiveFields.length === 0 && (
                  <p className="text-xs text-zinc-500">Selected category has no metadata properties.</p>
                )}

                {propertiesEffectiveFields.map((field) => {
                  const key = field.property_internal_name;
                  const value = propertiesValues[key];
                  const required = Boolean(field.is_required);

                  if (field.property_data_type === "boolean") {
                    return (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.checked)}
                          className="rounded border-black/20"
                        />
                        <span>{field.property_display_name}{required ? " *" : ""}</span>
                      </label>
                    );
                  }

                  if (field.property_data_type === "dropdown") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <select
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Select value</option>
                          {(field.dropdown_options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  if (field.property_data_type === "number") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <input
                          type="number"
                          value={value === null || value === undefined ? "" : String(value)}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    );
                  }

                  if (field.property_data_type === "date") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <input
                          type="date"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    );
                  }

                  if (field.property_data_type === "datetime") {
                    return (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                        <input
                          type="datetime-local"
                          value={toDatetimeLocalValue(value)}
                          onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    );
                  }

                  return (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{field.property_display_name}{required ? " *" : ""}</span>
                      <input
                        type="text"
                        value={value === null || value === undefined ? "" : String(value)}
                        onChange={(event) => handlePropertiesValueChange(key, event.target.value)}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  );
                })}

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveProperties();
                    }}
                    disabled={propertiesSaving || propertiesLoading || !propertiesCategoryId}
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                  >
                    {propertiesSaving ? "Saving..." : "Save Properties"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void openPropertiesModal(propertiesScope, propertiesNodeId);
                    }}
                    disabled={propertiesLoading || propertiesSaving}
                    className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20 disabled:opacity-50"
                  >
                    Refresh
                  </button>
                  {propertiesMessage && <span className="text-xs text-emerald-700">{propertiesMessage}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {showBookPreview && bookPreviewArtifact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-4xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    Book Preview
                  </h2>
                  <p className="text-sm text-zinc-600">{bookPreviewArtifact.book_name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBookPreview(false)}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              {bookPreviewArtifact.warnings && bookPreviewArtifact.warnings.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {bookPreviewArtifact.warnings.join(" ")}
                </div>
              )}

              {bookPreviewArtifact.book_template && (
                <div className="mb-3 rounded-xl border border-black/10 bg-white/90 p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Book Template</div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--deep)]">
                    {bookPreviewArtifact.book_template.template_key}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Children rendered: {bookPreviewArtifact.book_template.child_count}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                    {bookPreviewArtifact.book_template.rendered_text || "No rendered book-level summary."}
                  </p>
                </div>
              )}

              <div className="max-h-[65vh] space-y-2 overflow-y-auto rounded-2xl border border-black/10 bg-white/80 p-3">
                {bookPreviewArtifact.sections.body.length === 0 ? (
                  <p className="text-sm text-zinc-500">No previewable content found for this book.</p>
                ) : (
                  bookPreviewArtifact.sections.body.map((block) => {
                    const contentLines = resolvePreviewContentLines(block, bookPreviewArtifact.render_settings);
                    return (
                      <article
                        key={`${block.section}-${block.order}-${block.source_node_id ?? block.title}`}
                        className="rounded-xl border border-black/10 bg-white p-3"
                      >
                        <div className="text-sm font-semibold text-[color:var(--deep)]">{block.title}</div>
                        <div className="mt-2 space-y-1">
                          {contentLines.length === 0 ? (
                            <p className="text-sm text-zinc-500">No textual content in this block.</p>
                          ) : (
                            contentLines.map((line) => (
                              <div key={`${line.key}-${line.value.slice(0, 24)}`}>
                                {line.label && (
                                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{line.label}</div>
                                )}
                                <p className={line.className}>{line.value}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Share Manager Modal */}
        {showShareManager && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                  Manage Book Shares
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowShareManager(false);
                    setSharesError(null);
                  }}
                  className="text-2xl text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateShare} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="sm:col-span-2 flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Invite user email</span>
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(event) => setShareEmail(event.target.value)}
                    required
                    className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder="user@example.com"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Permission</span>
                  <select
                    value={sharePermission}
                    onChange={(event) =>
                      setSharePermission(event.target.value as SharePermission)
                    }
                    className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="contributor">Contributor</option>
                    <option value="editor">Editor</option>
                  </select>
                </label>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={sharesSubmitting}
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                  >
                    {sharesSubmitting ? "Adding..." : "Add Share"}
                  </button>
                </div>
              </form>

              {sharesError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {sharesError}
                </div>
              )}

              <div className="max-h-[45vh] overflow-y-auto rounded-2xl border border-black/10">
                {sharesLoading ? (
                  <div className="p-4 text-sm text-zinc-600">Loading shares...</div>
                ) : bookShares.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-500">No shared users yet.</div>
                ) : (
                  <div className="divide-y divide-black/10">
                    {bookShares.map((share) => (
                      <div key={share.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-[color:var(--deep)]">
                            {share.shared_with_email}
                          </p>
                          {share.shared_with_username && (
                            <p className="text-xs text-zinc-500">{share.shared_with_username}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={share.permission}
                            onChange={(event) =>
                              void handleUpdateSharePermission(
                                share.shared_with_user_id,
                                event.target.value as SharePermission
                              )
                            }
                            disabled={shareUpdatingUserId === share.shared_with_user_id}
                            className="rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-xs uppercase tracking-[0.15em] outline-none focus:border-[color:var(--accent)] disabled:opacity-50"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="contributor">Contributor</option>
                            <option value="editor">Editor</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              void handleDeleteShare(share.shared_with_user_id);
                            }}
                            disabled={shareRemovingUserId === share.shared_with_user_id}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.15em] text-red-700 transition hover:border-red-400 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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

      {/* Floating Basket Panel */}
      <BasketPanel
        items={basketItems.map(item => ({
          node_id: item.node_id,
          order: item.order,
          title: item.title,
          book_name: item.book_name,
          level_name: item.level_name,
        }))}
        onRemoveItem={removeFromBasket}
        onMoveItem={moveBasketItem}
        reorderLoading={isReorderingBasket}
        onClearBasket={clearBasket}
        onItemsAdded={() => {
          // Optionally refresh the tree if needed
          if (bookId) {
            void loadTree(bookId);
          }
        }}
      />
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
