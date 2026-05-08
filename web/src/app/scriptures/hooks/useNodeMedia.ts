"use client";

import { useState, useRef, useEffect } from "react";
import { contentPath } from "../../../lib/apiPaths";
import { getMe } from "../../../lib/authClient";
import {
  getErrorMessageFromPayload,
} from "../../../lib/scriptureUtils";
import {
  createMediaBankLinkAsset as createMediaBankLinkAssetRequest,
  deleteMediaBankAsset,
  listMediaBankAssets,
  MediaBankClientError,
  replaceMediaBankAssetFile,
  renameMediaBankAsset,
  uploadMediaBankAsset,
} from "../../../lib/mediaBankClient";
import {
  inferDisplayNameFromUrl,
  type ExternalMediaType,
} from "../../../lib/externalMedia";
import {
  getBookMediaItems,
  getMediaLookupKey,
  normalizeBookMediaType,
} from "../../../lib/bookMediaUtils";
import {
  mediaManagerDensityStorageKey,
  readStoredMediaManagerDensity,
  getDeviceScopedStorageKey,
} from "../../../lib/scriptureStorage";
import {
  SCRIPTURES_MEDIA_MANAGER_VIEW_KEY,
} from "../../../lib/scriptureUtils";
import type {
  MediaFile,
  MediaAsset,
  BookDetails,
  BookMediaItem,
  MediaLinkContext,
} from "../../../lib/scriptureTypes";

// Pure helpers — no external state deps.

export function getNodeMediaDisplayOrder(media: MediaFile): number {
  const metadata =
    media.metadata && typeof media.metadata === "object"
      ? media.metadata
      : media.metadata_json && typeof media.metadata_json === "object"
        ? media.metadata_json
        : null;
  const raw = metadata?.display_order;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function isNodeMediaDefault(media: MediaFile): boolean {
  const metadata =
    media.metadata && typeof media.metadata === "object"
      ? media.metadata
      : media.metadata_json && typeof media.metadata_json === "object"
        ? media.metadata_json
        : null;
  return Boolean(metadata?.is_default);
}

export function sortNodeMediaItems(items: MediaFile[]): MediaFile[] {
  return [...items].sort((a, b) => {
    const typeCompare = (a.media_type || "").localeCompare(b.media_type || "");
    if (typeCompare !== 0) {
      return typeCompare;
    }
    const defaultCompare = Number(isNodeMediaDefault(b)) - Number(isNodeMediaDefault(a));
    if (defaultCompare !== 0) {
      return defaultCompare;
    }
    const orderCompare = getNodeMediaDisplayOrder(a) - getNodeMediaDisplayOrder(b);
    if (orderCompare !== 0) {
      return orderCompare;
    }
    const aCreated = a.created_at ? Date.parse(a.created_at) : 0;
    const bCreated = b.created_at ? Date.parse(b.created_at) : 0;
    if (aCreated !== bCreated) {
      return aCreated - bCreated;
    }
    return a.id - b.id;
  });
}

function getMediaBankAssetDisplayName(asset: MediaAsset): string {
  if (typeof asset.metadata?.display_name === "string" && asset.metadata.display_name.trim()) {
    return asset.metadata.display_name.trim();
  }
  if (typeof asset.metadata?.original_filename === "string" && asset.metadata.original_filename.trim()) {
    return asset.metadata.original_filename.trim();
  }
  return `${asset.media_type} #${asset.id}`;
}

export function useNodeMedia({
  authEmail,
  authResolved,
  selectedId,
  bookId,
  currentBook,
  resolvedCurrentBookId,
  setPropertiesError,
  setPropertiesMessage,
  setBookThumbnailUploading,
  selectNodeRef,
  saveBookMediaItemsRef,
}: {
  authEmail: string | null;
  authResolved: boolean;
  selectedId: number | null;
  bookId: string | null;
  currentBook: BookDetails | null;
  resolvedCurrentBookId: string | null;
  setPropertiesError: (err: string | null) => void;
  setPropertiesMessage: (msg: string | null) => void;
  setBookThumbnailUploading: (uploading: boolean) => void;
  selectNodeRef: React.MutableRefObject<
    ((nodeId: number, syncUrl?: boolean, expandPath?: boolean) => void) | null
  >;
  saveBookMediaItemsRef: React.MutableRefObject<
    | ((
        items: BookMediaItem[],
        successMessage: string,
        failureMessage: string
      ) => Promise<boolean>)
    | null
  >;
}) {
  const [nodeMedia, setNodeMedia] = useState<MediaFile[]>([]);
  const [nodeMediaLoading, setNodeMediaLoading] = useState(false);
  const [nodeMediaError, setNodeMediaError] = useState<string | null>(null);
  const [nodeMediaUploading, setNodeMediaUploading] = useState(false);
  const [nodeMediaUpdating, setNodeMediaUpdating] = useState(false);
  const [nodeMediaMessage, setNodeMediaMessage] = useState<string | null>(null);
  const [nodeMediaSearchQuery, setNodeMediaSearchQuery] = useState("");
  const [mediaBankAssets, setMediaBankAssets] = useState<MediaAsset[]>([]);
  const [mediaBankLoading, setMediaBankLoading] = useState(false);
  const [mediaBankError, setMediaBankError] = useState<string | null>(null);
  const [mediaBankMessage, setMediaBankMessage] = useState<string | null>(null);
  const [mediaBankUploading, setMediaBankUploading] = useState(false);
  const [mediaBankUpdating, setMediaBankUpdating] = useState(false);
  const [mediaBankRenameId, setMediaBankRenameId] = useState<number | null>(null);
  const [mediaBankRenameValue, setMediaBankRenameValue] = useState("");
  const [externalMediaFormOpen, setExternalMediaFormOpen] = useState(false);
  const [externalMediaFormContext, setExternalMediaFormContext] = useState<MediaLinkContext>("bank");
  const [externalMediaFormSubmitting, setExternalMediaFormSubmitting] = useState(false);
  const [bookMediaActionsOpen, setBookMediaActionsOpen] = useState(false);
  const [nodeMediaActionsOpen, setNodeMediaActionsOpen] = useState(false);
  const [mediaManagerSearchQuery, setMediaManagerSearchQuery] = useState("");
  const [mediaManagerTypeFilter, setMediaManagerTypeFilter] = useState("all");
  const [mediaManagerView, setMediaManagerView] = useState<"list" | "icon">("list");
  const [mediaManagerDensity, setMediaManagerDensity] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [mediaManagerDensityHydrated, setMediaManagerDensityHydrated] = useState(false);
  const [showMediaManagerDensityMenu, setShowMediaManagerDensityMenu] = useState(false);
  const [showMediaManagerModal, setShowMediaManagerModal] = useState(false);
  const [mediaManagerScope, setMediaManagerScope] = useState<"node" | "book" | "bank">("node");
  const [mediaBankViewMode, setMediaBankViewMode] = useState<"manage" | "pick-node" | "pick-book">("manage");

  const activeNodeMediaRequestId = useRef(0);
  const activeNodeMediaAbortController = useRef<AbortController | null>(null);
  const activeNodeMediaNodeId = useRef<number | null>(null);

  const fetchContentWithSessionRecovery = async (
    path: string,
    init?: RequestInit
  ): Promise<Response> => {
    let response = await fetch(contentPath(path), init);
    if (response.status !== 401) {
      return response;
    }
    await getMe({ force: true }).catch(() => null);
    response = await fetch(contentPath(path), init);
    return response;
  };

  const loadMediaBankAssets = async () => {
    setMediaBankLoading(true);
    setMediaBankError(null);
    try {
      const data = await listMediaBankAssets(300);
      setMediaBankAssets(Array.isArray(data) ? (data as MediaAsset[]) : []);
    } catch (err) {
      setMediaBankAssets([]);
      setMediaBankError(err instanceof Error ? err.message : "Unable to load media repo");
    } finally {
      setMediaBankLoading(false);
    }
  };

  const handleUploadMediaBankAsset = async (file: File) => {
    setMediaBankUploading(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await uploadMediaBankAsset(file);
      setMediaBankMessage("Media asset uploaded.");
      await loadMediaBankAssets();
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to upload media asset");
    } finally {
      setMediaBankUploading(false);
    }
  };

  const openMediaLinkForm = (context: MediaLinkContext) => {
    setExternalMediaFormContext(context);
    setExternalMediaFormOpen(true);
  };

  const createMediaBankLinkAsset = async (
    url: string,
    displayName?: string,
    mediaType?: ExternalMediaType
  ): Promise<MediaAsset> => {
    const asset = await createMediaBankLinkAssetRequest({
      url,
      displayName,
      mediaType,
    });
    if (!asset || typeof asset.id !== "number") {
      throw new Error("Link created but no media asset was returned.");
    }
    return asset as MediaAsset;
  };

  const uploadMediaBankAssetAndReturn = async (file: File): Promise<MediaAsset> => {
    const asset = (await uploadMediaBankAsset(file)) as MediaAsset | null;
    if (!asset || typeof asset.id !== "number") {
      throw new Error("Upload succeeded but no media asset was returned.");
    }
    return asset;
  };

  const attachMediaBankAssetToNode = async (assetId: number, nodeId: number): Promise<void> => {
    const response = await fetchContentWithSessionRecovery(`/media-bank/assets/${assetId}/attach/nodes/${nodeId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: false }),
    });
    const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    if (!response.ok) {
      throw new Error(getErrorMessageFromPayload(payload, "Failed to attach media asset"));
    }
  };

  const handleSubmitMediaLinkForm = async (payload: {
    url: string;
    displayName?: string;
    mediaType?: ExternalMediaType;
  }) => {
    if (!payload.url.trim()) {
      setMediaBankError("URL is required.");
      return;
    }

    setExternalMediaFormSubmitting(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    setNodeMediaError(null);
    setNodeMediaMessage(null);
    setPropertiesError(null);
    setPropertiesMessage(null);

    try {
      const createdAsset = await createMediaBankLinkAsset(
        payload.url,
        payload.displayName,
        payload.mediaType
      );

      if (externalMediaFormContext === "node") {
        if (!selectedId) {
          throw new Error("Select a node first to attach media.");
        }
        await attachMediaBankAssetToNode(createdAsset.id, selectedId);
        setNodeMediaMessage("Link added to repo and attached to node.");
        await Promise.all([loadNodeMedia(selectedId, true), loadMediaBankAssets()]);
      } else if (externalMediaFormContext === "book") {
        const attached = await handleAttachMediaBankAssetToBook(createdAsset);
        if (!attached) {
          throw new Error("Failed to attach external media to book.");
        }
        await loadMediaBankAssets();
      } else {
        setMediaBankMessage("External media link added.");
        await loadMediaBankAssets();
      }

      setExternalMediaFormOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add external media link";
      if (externalMediaFormContext === "node") {
        setNodeMediaError(message);
      } else if (externalMediaFormContext === "book") {
        setPropertiesError(message);
      } else {
        setMediaBankError(message);
      }
    } finally {
      setExternalMediaFormSubmitting(false);
    }
  };

  const beginRenameMediaBankAsset = (asset: MediaAsset) => {
    setMediaBankError(null);
    setMediaBankMessage(null);
    setMediaBankRenameId(asset.id);
    setMediaBankRenameValue(getMediaBankAssetDisplayName(asset));
  };

  const cancelRenameMediaBankAsset = () => {
    setMediaBankRenameId(null);
    setMediaBankRenameValue("");
  };

  const handleRenameMediaBankAsset = async (assetId: number) => {
    const asset = mediaBankAssets.find((entry) => entry.id === assetId);
    if (!asset) {
      cancelRenameMediaBankAsset();
      return;
    }

    const currentName = getMediaBankAssetDisplayName(asset);
    const trimmed = mediaBankRenameValue.trim();
    if (!trimmed) {
      setMediaBankError("Name cannot be empty.");
      return;
    }

    if (trimmed === currentName) {
      cancelRenameMediaBankAsset();
      return;
    }

    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      const updatedAsset = await renameMediaBankAsset(assetId, trimmed);
      setMediaBankAssets((prev) =>
        prev.map((entry) =>
          entry.id === assetId
            ? {
                ...entry,
                ...updatedAsset,
              }
            : entry
        )
      );
      cancelRenameMediaBankAsset();
      setMediaBankMessage("Media asset renamed.");
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to rename media asset");
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleDeleteMediaBankAsset = async (assetId: number) => {
    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await deleteMediaBankAsset(assetId);
      setMediaBankMessage("Media asset removed from repo.");
      await loadMediaBankAssets();
    } catch (err) {
      if (err instanceof MediaBankClientError && err.status === 409) {
        setMediaBankError(
          "Cannot remove this asset yet. Detach it from all nodes first, then delete it from the multimedia repo."
        );
      } else {
        setMediaBankError(err instanceof Error ? err.message : "Failed to delete media asset");
      }
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleReplaceMediaBankAsset = async (asset: MediaAsset, file: File) => {
    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await replaceMediaBankAssetFile(asset.id, file);
      setMediaBankMessage("Media asset file replaced. Existing links remain intact.");
      await Promise.all([
        loadMediaBankAssets(),
        mediaManagerScope === "node" && selectedId ? loadNodeMedia(selectedId, true) : Promise.resolve(),
      ]);
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to replace media asset");
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleAttachMediaBankAssetToSelectedNode = async (assetId: number): Promise<boolean> => {
    if (!selectedId) {
      setMediaBankError("Select a node first to attach media.");
      return false;
    }

    setMediaBankUpdating(true);
    setMediaBankError(null);
    setMediaBankMessage(null);
    try {
      await attachMediaBankAssetToNode(assetId, selectedId);
      setMediaBankMessage("Media asset attached to node.");
      await loadNodeMedia(selectedId, true);
      return true;
    } catch (err) {
      setMediaBankError(err instanceof Error ? err.message : "Failed to attach media asset");
      return false;
    } finally {
      setMediaBankUpdating(false);
    }
  };

  const handleAttachMediaBankAssetToBook = async (asset: MediaAsset): Promise<boolean> => {
    const currentItems = getBookMediaItems(currentBook);
    const assetDisplayName = getMediaBankAssetDisplayName(asset);
    const mediaLookupKey = getMediaLookupKey(asset.media_type, asset.url || "");

    const exists = currentItems.some((item) => {
      const itemLookupKey = getMediaLookupKey(item.media_type, item.url || "");
      if (typeof item.asset_id === "number" && item.asset_id === asset.id) {
        return true;
      }
      return itemLookupKey === mediaLookupKey;
    });
    if (exists) {
      setPropertiesMessage("Media is already attached to this book.");
      return true;
    }

    const normalizedType = normalizeBookMediaType(asset.media_type, asset.url || "");
    const sameTypeItems = currentItems.filter((item) => item.media_type === normalizedType);
    const isDefault = sameTypeItems.length === 0;

    const nextItems = [
      ...currentItems,
      {
        media_type: normalizedType,
        url: asset.url,
        display_name: assetDisplayName,
        content_type:
          typeof asset.metadata?.content_type === "string" && asset.metadata.content_type.trim()
            ? asset.metadata.content_type.trim()
            : undefined,
        size_bytes:
          typeof asset.metadata?.size_bytes === "number" || typeof asset.metadata?.size_bytes === "string"
            ? asset.metadata.size_bytes
            : undefined,
        replaced_at:
          typeof asset.metadata?.replaced_at === "string" && asset.metadata.replaced_at.trim()
            ? asset.metadata.replaced_at.trim()
            : undefined,
        asset_id: asset.id,
        is_default: isDefault,
      },
    ];
    const saveBookMediaItems = saveBookMediaItemsRef.current;
    if (!saveBookMediaItems) {
      return false;
    }
    return saveBookMediaItems(nextItems, "Media attached to book.", "Failed to attach media to book");
  };

  const handleUploadNodeMediaViaBank = async (file: File) => {
    if (!selectedId) {
      setNodeMediaError("Select a node first to attach media.");
      return;
    }

    setNodeMediaUploading(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);
    try {
      const uploadedAsset = await uploadMediaBankAssetAndReturn(file);
      await attachMediaBankAssetToNode(uploadedAsset.id, selectedId);

      setNodeMediaMessage("Multimedia uploaded to repo and attached to node.");
      await Promise.all([loadNodeMedia(selectedId, true), loadMediaBankAssets()]);
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to upload multimedia");
    } finally {
      setNodeMediaUploading(false);
    }
  };

  const handleUploadBookMediaViaBank = async (file: File) => {
    if (!resolvedCurrentBookId) {
      setPropertiesError("Select a book first.");
      return;
    }

    setBookThumbnailUploading(true);
    setPropertiesError(null);
    setPropertiesMessage(null);
    try {
      const uploadedAsset = await uploadMediaBankAssetAndReturn(file);
      const attached = await handleAttachMediaBankAssetToBook(uploadedAsset);
      if (attached) {
        await loadMediaBankAssets();
      }
    } catch (err) {
      setPropertiesError(err instanceof Error ? err.message : "Failed to upload media");
    } finally {
      setBookThumbnailUploading(false);
    }
  };

  const loadNodeMedia = async (nodeId: number, force = false) => {
    if (!force && activeNodeMediaNodeId.current === nodeId) return;

    activeNodeMediaAbortController.current?.abort();
    const abortController = new AbortController();
    activeNodeMediaAbortController.current = abortController;
    const requestId = activeNodeMediaRequestId.current + 1;
    activeNodeMediaRequestId.current = requestId;
    activeNodeMediaNodeId.current = nodeId;

    setNodeMediaLoading(true);
    setNodeMediaError(null);
    try {
      const response = await fetchContentWithSessionRecovery(`/nodes/${nodeId}/media?limit=20`, {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeNodeMediaRequestId.current) return;
      if (!response.ok) {
        setNodeMedia([]);
        setNodeMediaError("Unable to load multimedia for this node.");
        return;
      }
      const data = (await response.json()) as MediaFile[];
      if (requestId !== activeNodeMediaRequestId.current) return;
      setNodeMedia(sortNodeMediaItems(Array.isArray(data) ? data : []));
      setNodeMediaError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeNodeMediaRequestId.current) return;
      setNodeMedia([]);
      setNodeMediaError("Unable to load multimedia for this node.");
    } finally {
      if (requestId === activeNodeMediaRequestId.current) {
        setNodeMediaLoading(false);
        activeNodeMediaNodeId.current = null;
      }
    }
  };

  const handleDeleteNodeMedia = async (media: MediaFile) => {
    const targetNodeId = typeof media.node_id === "number" ? media.node_id : selectedId;
    if (!targetNodeId) {
      return;
    }

    setNodeMediaUpdating(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);

    try {
      const response = await fetchContentWithSessionRecovery(`/nodes/${targetNodeId}/media/${media.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessageFromPayload(payload, "Failed to delete media"));
      }

      setNodeMediaMessage("Multimedia removed.");
      if (selectedId === targetNodeId) {
        await loadNodeMedia(targetNodeId, true);
      }
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to delete media");
    } finally {
      setNodeMediaUpdating(false);
    }
  };

  const handleSetDefaultNodeMedia = async (mediaId: number) => {
    if (!selectedId) {
      return;
    }

    setNodeMediaUpdating(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);

    try {
      const response = await fetchContentWithSessionRecovery(`/nodes/${selectedId}/media/${mediaId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to set default media");
      }

      setNodeMediaMessage("Default media updated.");
      await loadNodeMedia(selectedId, true);
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to set default media");
    } finally {
      setNodeMediaUpdating(false);
    }
  };

  const handleMoveNodeMedia = async (mediaId: number, direction: "up" | "down") => {
    if (!selectedId) {
      return;
    }

    const targetMedia = nodeMedia.find((item) => item.id === mediaId);
    if (!targetMedia) {
      return;
    }

    const sameType = sortNodeMediaItems(
      nodeMedia.filter((item) => (item.media_type || "") === (targetMedia.media_type || ""))
    );
    const currentIndex = sameType.findIndex((item) => item.id === mediaId);
    if (currentIndex < 0) {
      return;
    }

    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= sameType.length) {
      return;
    }

    const reordered = [...sameType];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(swapIndex, 0, moved);
    const orderedIds = reordered.map((item) => item.id);

    setNodeMediaUpdating(true);
    setNodeMediaError(null);
    setNodeMediaMessage(null);

    try {
      const response = await fetchContentWithSessionRecovery(`/nodes/${selectedId}/media/reorder`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: targetMedia.media_type,
          media_ids: orderedIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to reorder media");
      }

      setNodeMediaMessage("Media order updated.");
      await loadNodeMedia(selectedId, true);
    } catch (err) {
      setNodeMediaError(err instanceof Error ? err.message : "Failed to reorder media");
    } finally {
      setNodeMediaUpdating(false);
    }
  };

  const openNodeMediaManager = (targetNodeId?: number | null) => {
    const nextNodeId =
      typeof targetNodeId === "number" && Number.isFinite(targetNodeId)
        ? targetNodeId
        : selectedId;

    if (!nextNodeId) {
      setNodeMediaError("Select a node first to manage multimedia.");
      return;
    }

    if (nextNodeId !== selectedId) {
      selectNodeRef.current?.(nextNodeId);
    }

    void loadNodeMedia(nextNodeId, true);
    setMediaManagerScope("node");
    setShowMediaManagerModal(true);
  };

  const getNodeMediaLabel = (media: MediaFile): string => {
    const mediaType = (media.media_type || "").trim();
    const mediaLookupKey = getMediaLookupKey(mediaType, media.url);
    const metadata =
      media.metadata && typeof media.metadata === "object"
        ? media.metadata
        : media.metadata_json && typeof media.metadata_json === "object"
          ? media.metadata_json
          : null;

    const metadataAssetIdRaw = metadata?.asset_id;
    const metadataAssetId =
      typeof metadataAssetIdRaw === "number"
        ? metadataAssetIdRaw
        : typeof metadataAssetIdRaw === "string" && metadataAssetIdRaw.trim()
          ? Number.parseInt(metadataAssetIdRaw, 10)
          : null;

    const matchingAssetById =
      typeof metadataAssetId === "number" && Number.isFinite(metadataAssetId)
        ? mediaBankAssets.find((asset) => asset.id === metadataAssetId)
        : undefined;

    const matchingAssetByLookup = mediaBankAssets.find((asset) => {
      const assetType = (asset.media_type || "").trim();
      if (assetType !== mediaType) {
        return false;
      }
      const assetLookupKey = getMediaLookupKey(assetType, asset.url || "");
      if (assetLookupKey === mediaLookupKey) {
        return true;
      }
      return (asset.url || "").trim() === (media.url || "").trim();
    });

    const matchingAsset = matchingAssetById ?? matchingAssetByLookup;

    const repoDisplayName =
      typeof matchingAsset?.metadata?.display_name === "string" ? matchingAsset.metadata.display_name.trim() : "";
    if (repoDisplayName) {
      return repoDisplayName;
    }
    const repoFilename =
      typeof matchingAsset?.metadata?.original_filename === "string"
        ? matchingAsset.metadata.original_filename.trim()
        : "";
    if (repoFilename) {
      return repoFilename;
    }

    const directDisplayName = typeof metadata?.display_name === "string" ? metadata.display_name.trim() : "";
    if (directDisplayName) {
      return directDisplayName;
    }

    const directAssetDisplayName =
      typeof metadata?.asset_display_name === "string" ? metadata.asset_display_name.trim() : "";
    if (directAssetDisplayName) {
      return directAssetDisplayName;
    }

    const directFilename = typeof metadata?.original_filename === "string" ? metadata.original_filename.trim() : "";
    if (directFilename) {
      return directFilename;
    }

    return inferDisplayNameFromUrl(media.url) || `${mediaType || "media"} #${media.id}`;
  };

  const getBookMediaLabel = (media: BookMediaItem): string => {
    if (typeof media.display_name === "string" && media.display_name.trim()) {
      return media.display_name.trim();
    }
    const matchingAsset =
      typeof media.asset_id === "number"
        ? mediaBankAssets.find((asset) => asset.id === media.asset_id)
        : undefined;
    if (matchingAsset) {
      return getMediaBankAssetDisplayName(matchingAsset);
    }
    return inferDisplayNameFromUrl(media.url) || `${media.media_type || "media"}`;
  };

  // Manages nodeMedia lifecycle when selected node changes.
  useEffect(() => {
    if (!selectedId) {
      activeNodeMediaAbortController.current?.abort();
      setNodeMedia([]);
      setNodeMediaError(null);
      setNodeMediaLoading(false);
      setNodeMediaUploading(false);
      setNodeMediaUpdating(false);
      setNodeMediaMessage(null);
      setNodeMediaSearchQuery("");
      if (mediaManagerScope === "node") {
        setShowMediaManagerModal(false);
      }
      return;
    }

    void loadNodeMedia(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mediaManagerScope]);

  // Resets transient media manager state when modal opens/closes.
  useEffect(() => {
    if (!showMediaManagerModal) {
      setMediaBankViewMode("manage");
      setExternalMediaFormOpen(false);
      setExternalMediaFormSubmitting(false);
      setBookMediaActionsOpen(false);
      setNodeMediaActionsOpen(false);
      return;
    }
    setMediaManagerSearchQuery("");
    setMediaManagerTypeFilter("all");
    setMediaBankError(null);
    setMediaBankMessage(null);
    setExternalMediaFormOpen(false);
    setExternalMediaFormSubmitting(false);
    setBookMediaActionsOpen(false);
    setNodeMediaActionsOpen(false);
    void loadMediaBankAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMediaManagerModal, mediaManagerScope, selectedId, bookId]);

  return {
    // nodeMedia state
    nodeMedia,
    setNodeMedia,
    nodeMediaLoading,
    setNodeMediaLoading,
    nodeMediaError,
    setNodeMediaError,
    nodeMediaUploading,
    setNodeMediaUploading,
    nodeMediaUpdating,
    setNodeMediaUpdating,
    nodeMediaMessage,
    setNodeMediaMessage,
    nodeMediaSearchQuery,
    setNodeMediaSearchQuery,
    // mediaBank state
    mediaBankAssets,
    setMediaBankAssets,
    mediaBankLoading,
    mediaBankError,
    setMediaBankError,
    mediaBankMessage,
    setMediaBankMessage,
    mediaBankUploading,
    mediaBankUpdating,
    mediaBankRenameId,
    setMediaBankRenameId,
    mediaBankRenameValue,
    setMediaBankRenameValue,
    // externalMediaForm state
    externalMediaFormOpen,
    setExternalMediaFormOpen,
    externalMediaFormContext,
    setExternalMediaFormContext,
    externalMediaFormSubmitting,
    setExternalMediaFormSubmitting,
    // media manager UI state
    bookMediaActionsOpen,
    setBookMediaActionsOpen,
    nodeMediaActionsOpen,
    setNodeMediaActionsOpen,
    mediaManagerSearchQuery,
    setMediaManagerSearchQuery,
    mediaManagerTypeFilter,
    setMediaManagerTypeFilter,
    mediaManagerView,
    setMediaManagerView,
    mediaManagerDensity,
    setMediaManagerDensity,
    mediaManagerDensityHydrated,
    setMediaManagerDensityHydrated,
    showMediaManagerDensityMenu,
    setShowMediaManagerDensityMenu,
    showMediaManagerModal,
    setShowMediaManagerModal,
    mediaManagerScope,
    setMediaManagerScope,
    mediaBankViewMode,
    setMediaBankViewMode,
    // handlers
    loadMediaBankAssets,
    handleUploadMediaBankAsset,
    openMediaLinkForm,
    handleSubmitMediaLinkForm,
    beginRenameMediaBankAsset,
    cancelRenameMediaBankAsset,
    handleRenameMediaBankAsset,
    handleDeleteMediaBankAsset,
    handleReplaceMediaBankAsset,
    handleAttachMediaBankAssetToSelectedNode,
    handleAttachMediaBankAssetToBook,
    handleUploadNodeMediaViaBank,
    handleUploadBookMediaViaBank,
    loadNodeMedia,
    handleDeleteNodeMedia,
    handleSetDefaultNodeMedia,
    handleMoveNodeMedia,
    openNodeMediaManager,
    // label helpers exposed for JSX
    getMediaBankAssetDisplayName,
    getNodeMediaLabel,
    getBookMediaLabel,
  };
}
