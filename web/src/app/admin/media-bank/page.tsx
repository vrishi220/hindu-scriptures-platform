"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreVertical, SlidersHorizontal } from "lucide-react";
import { getMe } from "@/lib/authClient";
import InlineClearButton from "@/components/InlineClearButton";
import ExternalMediaFormModal from "@/components/ExternalMediaFormModal";
import {
  createMediaBankLinkAsset,
  deleteMediaBankAsset,
  listMediaBankAssets,
  MediaBankClientError,
  replaceMediaBankAssetFile,
  renameMediaBankAsset,
  uploadMediaBankAsset,
} from "@/lib/mediaBankClient";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { type ExternalMediaType } from "@/lib/externalMedia";

const ADMIN_MEDIA_BANK_VIEW_KEY = "admin_media_bank_browser_view";
const ADMIN_MEDIA_BANK_DENSITY_KEY = "admin_media_bank_browser_density";

const readStoredBrowserView = (): "list" | "icon" => {
  if (typeof window === "undefined") {
    return "list";
  }
  return window.localStorage.getItem(ADMIN_MEDIA_BANK_VIEW_KEY) === "icon" ? "icon" : "list";
};

const normalizeBrowserView = (value: unknown): "list" | "icon" =>
  value === "icon" ? "icon" : "list";

const normalizeBrowserDensity = (value: unknown): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.min(5, Math.max(0, Math.round(value)));
    return normalized as 0 | 1 | 2 | 3 | 4 | 5;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      const normalized = Math.min(5, Math.max(0, Math.round(parsed)));
      return normalized as 0 | 1 | 2 | 3 | 4 | 5;
    }
  }
  return 0;
};

const readStoredBrowserDensity = (): { value: 0 | 1 | 2 | 3 | 4 | 5; hasStored: boolean } => {
  if (typeof window === "undefined") {
    return { value: 4, hasStored: false };
  }
  const raw = window.localStorage.getItem(ADMIN_MEDIA_BANK_DENSITY_KEY);
  if (raw === null) {
    return { value: 4, hasStored: false };
  }
  return { value: normalizeBrowserDensity(raw), hasStored: true };
};

type MediaAsset = {
  id: number;
  media_type: string;
  url: string;
  metadata_json?: Record<string, unknown> | null;
};

type Toast = {
  type: "success" | "error";
  message: string;
};

type PreviewAsset = {
  id: number;
  label: string;
  mediaType: string;
  url: string;
};

const getDisplayName = (asset: MediaAsset) => {
  const metadata =
    asset.metadata_json && typeof asset.metadata_json === "object"
      ? asset.metadata_json
      : null;
  const displayName =
    metadata && typeof metadata.display_name === "string" ? metadata.display_name.trim() : "";
  if (displayName) return displayName;
  const originalName =
    metadata && typeof metadata.original_filename === "string" ? metadata.original_filename.trim() : "";
  if (originalName) return originalName;
  return `${asset.media_type || "media"} #${asset.id}`;
};

const isExternalUrl = (rawUrl: string) => {
  const normalized = rawUrl.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
};

const canPreviewInModal = (asset: MediaAsset) => {
  if (isExternalUrl(asset.url)) return false;
  const type = (asset.media_type || "").toLowerCase();
  return type === "image" || type === "video" || type === "audio";
};

export default function AdminMediaBankPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replacingId, setReplacingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
  const [browserView, setBrowserView] = useState<"list" | "icon">("list");
  const [browserDensity, setBrowserDensity] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [densityHydrated, setDensityHydrated] = useState(false);
  const [hasStoredDensity, setHasStoredDensity] = useState(false);
  const [showDensityMenu, setShowDensityMenu] = useState(false);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openActionsId, setOpenActionsId] = useState<number | null>(null);
  const [externalFormOpen, setExternalFormOpen] = useState(false);
  const [externalFormSubmitting, setExternalFormSubmitting] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);
  const [accountPrefReady, setAccountPrefReady] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetIdRef = useRef<number | null>(null);
  const suppressRenameBlurRef = useRef(false);
  const actionMenuRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const densityMenuRef = useRef<HTMLDivElement | null>(null);

  const ensureAdmin = async () => {
    try {
      const me = await getMe();
      const admin = Boolean(me?.permissions?.can_admin || me?.role === "admin");
      setAccessDenied(!admin);
      return admin;
    } catch {
      setAccessDenied(true);
      return false;
    }
  };

  const loadAssets = async () => {
    setLoading(true);
    try {
      const loadedAssets = await listMediaBankAssets(300);
      setAssets(Array.isArray(loadedAssets) ? (loadedAssets as MediaAsset[]) : []);
    } catch (error) {
      if (error instanceof MediaBankClientError && (error.status === 401 || error.status === 403)) {
        setAccessDenied(true);
        setAssets([]);
        return;
      }
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load media repo",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedDensity = readStoredBrowserDensity();
    setBrowserDensity(storedDensity.value);
    setHasStoredDensity(storedDensity.hasStored);
    setDensityHydrated(true);
  }, []);

  useEffect(() => {
    void (async () => {
      const admin = await ensureAdmin();
      if (admin) {
        try {
          const response = await fetch("/api/preferences", {
            credentials: "include",
            cache: "no-store",
          });
          if (response.ok) {
            const payload = (await response.json().catch(() => null)) as {
              admin_media_bank_browser_view?: unknown;
            } | null;
            const nextView = normalizeBrowserView(payload?.admin_media_bank_browser_view);
            setBrowserView(nextView);
          }
        } catch {
          // no-op: local fallback already loaded
        }
        setAccountPrefReady(true);
        await loadAssets();
      } else {
        setAccountPrefReady(false);
      }
      setAuthChecked(true);
    })();
  }, [hasStoredDensity]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (openActionsId !== null) {
        const menu = actionMenuRefs.current[openActionsId];
        if (menu && !menu.contains(target)) {
          setOpenActionsId(null);
        }
      }
      if (densityMenuRef.current && !densityMenuRef.current.contains(target)) {
        setShowDensityMenu(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openActionsId]);

  useEffect(() => {
    if (!previewAsset) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewAsset(null);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [previewAsset]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ADMIN_MEDIA_BANK_VIEW_KEY, browserView);
  }, [browserView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!densityHydrated) {
      return;
    }
    window.localStorage.setItem(ADMIN_MEDIA_BANK_DENSITY_KEY, String(browserDensity));
  }, [browserDensity, densityHydrated]);

  useEffect(() => {
    if (!densityHydrated) {
      return;
    }
    const coarseView: "list" | "icon" = browserDensity === 0 ? "list" : "icon";
    if (coarseView !== browserView) {
      setBrowserView(coarseView);
    }
  }, [browserDensity, browserView, densityHydrated]);

  useEffect(() => {
    if (!authChecked || accessDenied || !accountPrefReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await fetch("/api/preferences", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              admin_media_bank_browser_view: browserView,
            }),
          });
        } catch {
          // no-op: local persistence already applied
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [authChecked, accessDenied, accountPrefReady, browserView]);

  const mediaTypes = useMemo(() => {
    const unique = new Set<string>();
    assets.forEach((asset) => {
      const type = (asset.media_type || "").trim();
      if (type) unique.add(type);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== "all" && asset.media_type !== typeFilter) return false;
      if (!query) return true;
      const haystack = `${getDisplayName(asset)} ${asset.media_type} ${asset.url}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [assets, searchQuery, typeFilter]);

  const browserGridColumns =
    browserDensity === 1
      ? 8
      : browserDensity === 2
        ? 6
        : browserDensity === 3
          ? 4
          : browserDensity === 4
            ? 2
            : 1;
  const browserDensityLabel =
    browserDensity === 0
      ? "List"
      : browserDensity === 1
        ? "8 col"
        : browserDensity === 2
          ? "6 col"
          : browserDensity === 3
            ? "4 col"
            : browserDensity === 4
              ? "2 col"
              : "1 col";

  const handleUpload = async (file: File) => {
    setUploading(true);
    setToast(null);
    try {
      await uploadMediaBankAsset(file);
      setToast({ type: "success", message: "Asset uploaded to multimedia repo." });
      await loadAssets();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleAddExternalLink = async (payload: {
    url: string;
    displayName?: string;
    mediaType?: ExternalMediaType;
  }) => {
    setExternalFormSubmitting(true);
    setToast(null);
    try {
      await createMediaBankLinkAsset(payload);
      setToast({ type: "success", message: "External media link added." });
      setExternalFormOpen(false);
      await loadAssets();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Link creation failed",
      });
    } finally {
      setExternalFormSubmitting(false);
    }
  };

  const cancelRename = () => {
    setRenameId(null);
    setRenameValue("");
  };

  const handleRename = async (assetId: number) => {
    const target = assets.find((asset) => asset.id === assetId);
    if (!target) {
      cancelRename();
      return;
    }

    const currentName = getDisplayName(target).trim();
    const nextName = renameValue.trim();
    if (!nextName) {
      setToast({ type: "error", message: "Display name is required." });
      return;
    }

    if (nextName === currentName) {
      cancelRename();
      return;
    }

    setUpdatingId(assetId);
    setToast(null);
    try {
      const updatedAsset = await renameMediaBankAsset(assetId, nextName);
      setAssets((prev) =>
        prev.map((asset) =>
          asset.id === assetId
            ? {
                ...asset,
                ...updatedAsset,
              }
            : asset
        )
      );
      cancelRename();
      setToast({ type: "success", message: "Asset renamed." });
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Rename failed",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!window.confirm(`Delete "${getDisplayName(asset)}" from multimedia repo?`)) return;

    setDeletingId(asset.id);
    setToast(null);
    try {
      await deleteMediaBankAsset(asset.id);
      setToast({ type: "success", message: "Asset deleted." });
      await loadAssets();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Delete failed",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleReplace = async (asset: MediaAsset, file: File) => {
    setReplacingId(asset.id);
    setToast(null);
    try {
      await replaceMediaBankAssetFile(asset.id, file);
      setToast({ type: "success", message: "Asset file replaced. Existing links remain intact." });
      await loadAssets();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Replace failed",
      });
    } finally {
      setReplacingId(null);
    }
  };

  const handleAssetOpen = (asset: MediaAsset) => {
    if (isExternalUrl(asset.url)) {
      window.open(asset.url, "_blank", "noopener,noreferrer");
      return;
    }

    if (!canPreviewInModal(asset)) {
      return;
    }

    setPreviewAsset({
      id: asset.id,
      label: getDisplayName(asset),
      mediaType: asset.media_type || "media",
      url: resolveMediaUrl(asset.url),
    });
  };

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-6">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Multimedia Repo</h1>
        <p className="text-sm text-zinc-600">Upload and manage global multimedia assets.</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        <a href="/admin" className="rounded-full border border-black/10 bg-white px-3 py-1">Users</a>
        <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white px-3 py-1">Schemas</a>
        <a href="/admin/metadata/properties" className="rounded-full border border-black/10 bg-white px-3 py-1">Properties</a>
        <a href="/admin/metadata/categories" className="rounded-full border border-black/10 bg-white px-3 py-1">Categories</a>
        <a href="/admin/media-bank" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Multimedia Repo</a>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {toast.message}
        </div>
      )}

      {accessDenied && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Admin access required.
          <a className="ml-2 font-semibold underline" href="/signin">
            Sign in
          </a>
        </div>
      )}

      <section className={`rounded-xl border border-black/10 bg-white p-4 space-y-3 ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Repo Assets</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="group relative">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search media"
                className="rounded-lg border border-black/10 px-3 py-1.5 pr-10 text-sm"
              />
              <InlineClearButton
                visible={Boolean(searchQuery)}
                onClear={() => setSearchQuery("")}
                ariaLabel="Clear media search"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm"
            >
              <option value="all">All types</option>
              {mediaTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <div ref={densityMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setShowDensityMenu((prev) => !prev)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-700 transition hover:bg-zinc-50"
                aria-label="Open view density"
                title="View density"
              >
                <SlidersHorizontal size={12} />
                {browserDensityLabel}
              </button>
              {showDensityMenu && (
                <div className="absolute left-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-64 rounded-xl border border-black/10 bg-white p-3 shadow-xl sm:left-auto sm:right-0">
                  <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                    <span>View density</span>
                    <span className="font-semibold text-zinc-700">{browserDensityLabel}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={browserDensity}
                    onChange={(event) => {
                      setBrowserDensity(normalizeBrowserDensity(event.target.value));
                    }}
                    className="w-full"
                    aria-label="Media bank view density"
                  />
                  <div className="mt-2 grid grid-cols-6 text-center text-[10px] text-zinc-500">
                    <span>List</span>
                    <span>8 col</span>
                    <span>6 col</span>
                    <span>4 col</span>
                    <span>2 col</span>
                    <span>1 col</span>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*,audio/*,video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void handleUpload(file);
              }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*,audio/*,video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                const targetId = replaceTargetIdRef.current;
                replaceTargetIdRef.current = null;
                if (!file || !targetId) return;
                const target = assets.find((item) => item.id === targetId);
                if (!target) {
                  setToast({ type: "error", message: "Asset not found for replacement." });
                  return;
                }
                void handleReplace(target, file);
              }}
            />
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <button
              type="button"
              onClick={() => {
                setExternalFormOpen(true);
              }}
              disabled={uploading || externalFormSubmitting}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 disabled:opacity-60"
            >
              Add external
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10">
          {browserView === "list" && (
            <div className="grid grid-cols-[2.2fr_0.9fr_1.5fr] items-center gap-3 border-b border-black/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
              <span>Asset</span>
              <span>Type</span>
              <span className="text-right">Actions</span>
            </div>
          )}

          {loading ? (
            <div className="px-3 py-6 text-sm text-zinc-600">Loading multimedia repo...</div>
          ) : filteredAssets.length === 0 ? (
            <div className="px-3 py-6 text-sm text-zinc-500">No assets found.</div>
          ) : (
            <div
              className={browserView === "icon" ? "grid gap-2 p-2" : "divide-y divide-black/5"}
              style={
                browserView === "icon"
                  ? {
                      gridTemplateColumns: `repeat(${browserGridColumns}, minmax(0, 1fr))`,
                    }
                  : undefined
              }
            >
              {filteredAssets.map((asset) => {
                const label = getDisplayName(asset);
                const isRenaming = renameId === asset.id;
                const isImage = (asset.media_type || "").toLowerCase() === "image";
                const isVideo = (asset.media_type || "").toLowerCase() === "video";
                const isAudio = (asset.media_type || "").toLowerCase() === "audio";
                const showUrl = isExternalUrl(asset.url);
                const previewable = canPreviewInModal(asset) || showUrl;
                const previewLabel = showUrl
                  ? `Open ${label}`
                  : isVideo
                    ? `Play ${label}`
                    : isAudio
                      ? `Preview ${label}`
                      : `Preview ${label}`;
                return (
                  <div
                    key={asset.id}
                    className={
                      browserView === "icon"
                        ? "overflow-visible rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
                        : "grid grid-cols-[2.2fr_0.9fr_1.5fr] items-center gap-3 px-3 py-2.5 text-sm text-zinc-700"
                    }
                  >
                    {browserView === "icon" ? (
                      <>
                        <div
                          className="relative"
                          ref={(element) => {
                            actionMenuRefs.current[asset.id] = element;
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (previewable) {
                                handleAssetOpen(asset);
                              }
                            }}
                            disabled={!previewable}
                            className="group flex w-full rounded-t-xl bg-zinc-50 text-left disabled:cursor-default"
                            aria-label={previewLabel}
                          >
                            {isImage ? (
                              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-t-xl bg-zinc-50 p-2">
                                <img
                                  src={resolveMediaUrl(asset.url)}
                                  alt={label}
                                  className="max-h-full max-w-full object-contain transition duration-200 group-hover:scale-[1.02]"
                                />
                              </div>
                            ) : isVideo ? (
                              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-t-xl bg-zinc-950 p-2">
                                <video
                                  src={resolveMediaUrl(asset.url)}
                                  className="max-h-full max-w-full object-contain"
                                  muted
                                  playsInline
                                  preload="metadata"
                                />
                              </div>
                            ) : (
                              <div className="flex aspect-square w-full items-center justify-center rounded-t-xl bg-zinc-100 px-4 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                                {showUrl ? "Open link" : asset.media_type || "media"}
                              </div>
                            )}
                          </button>
                          {!isRenaming && (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenActionsId((prev) => (prev === asset.id ? null : asset.id));
                                }}
                                disabled={deletingId === asset.id || updatingId === asset.id || replacingId === asset.id}
                                className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/90 text-zinc-700 shadow-sm transition hover:border-black/20 hover:bg-zinc-50 disabled:opacity-50"
                                aria-label="Open asset actions"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {openActionsId === asset.id && (
                                <div className="absolute right-2 top-11 z-20 min-w-[120px] rounded-lg border border-black/10 bg-white p-1 shadow-md">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionsId(null);
                                      replaceTargetIdRef.current = asset.id;
                                      replaceInputRef.current?.click();
                                    }}
                                    disabled={isExternalUrl(asset.url) || replacingId === asset.id}
                                    className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                  >
                                    Replace file
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionsId(null);
                                      setRenameId(asset.id);
                                      setRenameValue(label);
                                    }}
                                    className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionsId(null);
                                      void handleDelete(asset);
                                    }}
                                    disabled={deletingId === asset.id}
                                    className="w-full rounded px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div className="space-y-2 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              {isRenaming ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(event) => setRenameValue(event.target.value)}
                                  onBlur={() => {
                                    if (suppressRenameBlurRef.current) {
                                      suppressRenameBlurRef.current = false;
                                      return;
                                    }
                                    void handleRename(asset.id);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      event.currentTarget.blur();
                                      return;
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      cancelRename();
                                    }
                                  }}
                                  className="min-w-[18rem] max-w-full rounded border border-black/10 bg-white px-2 py-1 text-sm sm:min-w-[22rem]"
                                />
                              ) : (
                                <>
                                  <div className="truncate font-medium">{label}</div>
                                  {showUrl && <div className="truncate text-xs text-zinc-500">{asset.url}</div>}
                                </>
                              )}
                            </div>
                            <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                              {asset.media_type || "other"}
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5">
                            {isRenaming ? (
                              <>
                                <button
                                  type="button"
                                  onMouseDown={() => {
                                    suppressRenameBlurRef.current = true;
                                  }}
                                  onClick={() => {
                                    void handleRename(asset.id);
                                  }}
                                  disabled={updatingId === asset.id}
                                  className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onMouseDown={() => {
                                    suppressRenameBlurRef.current = true;
                                  }}
                                  onClick={() => {
                                    cancelRename();
                                  }}
                                  className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0">
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onBlur={() => {
                                if (suppressRenameBlurRef.current) {
                                  suppressRenameBlurRef.current = false;
                                  return;
                                }
                                void handleRename(asset.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                  return;
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRename();
                                }
                              }}
                              className="min-w-[18rem] max-w-full rounded border border-black/10 bg-white px-2 py-1 text-sm sm:min-w-[24rem]"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (previewable) {
                                  handleAssetOpen(asset);
                                }
                              }}
                              disabled={!previewable}
                              className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default"
                              aria-label={previewLabel}
                            >
                              {isImage ? (
                                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-zinc-50 p-1">
                                  <img
                                    src={resolveMediaUrl(asset.url)}
                                    alt={label}
                                    className="max-h-full max-w-full object-contain"
                                  />
                                </div>
                              ) : isVideo ? (
                                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-zinc-950 p-1">
                                  <video
                                    src={resolveMediaUrl(asset.url)}
                                    className="max-h-full max-w-full object-contain"
                                    muted
                                    playsInline
                                    preload="metadata"
                                  />
                                </div>
                              ) : (
                                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-black/10 bg-zinc-50 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                                  {showUrl ? "Link" : asset.media_type || "media"}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-medium">{label}</div>
                                {showUrl && <div className="truncate text-xs text-zinc-500">{asset.url}</div>}
                              </div>
                            </button>
                          )}
                        </div>
                        <span className="uppercase text-xs tracking-[0.12em] text-zinc-600">{asset.media_type || "other"}</span>
                        <div className="flex items-center justify-end gap-1.5">
                          {isRenaming ? (
                            <>
                              <button
                                type="button"
                                onMouseDown={() => {
                                  suppressRenameBlurRef.current = true;
                                }}
                                onClick={() => {
                                  void handleRename(asset.id);
                                }}
                                disabled={updatingId === asset.id}
                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onMouseDown={() => {
                                  suppressRenameBlurRef.current = true;
                                }}
                                onClick={() => {
                                  cancelRename();
                                }}
                                className="rounded border border-black/10 bg-white px-2 py-1 text-xs text-zinc-700"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <div
                              className="relative"
                              ref={(element) => {
                                actionMenuRefs.current[asset.id] = element;
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenActionsId((prev) => (prev === asset.id ? null : asset.id));
                                }}
                                disabled={deletingId === asset.id || updatingId === asset.id || replacingId === asset.id}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:opacity-50"
                                aria-label="Open asset actions"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {openActionsId === asset.id && (
                                <div className="absolute right-0 top-9 z-10 min-w-[120px] rounded-lg border border-black/10 bg-white p-1 shadow-md">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionsId(null);
                                      replaceTargetIdRef.current = asset.id;
                                      replaceInputRef.current?.click();
                                    }}
                                    disabled={isExternalUrl(asset.url) || replacingId === asset.id}
                                    className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                  >
                                    Replace file
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionsId(null);
                                      setRenameId(asset.id);
                                      setRenameValue(label);
                                    }}
                                    className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionsId(null);
                                      void handleDelete(asset);
                                    }}
                                    disabled={deletingId === asset.id}
                                    className="w-full rounded px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <ExternalMediaFormModal
        open={externalFormOpen}
        submitting={externalFormSubmitting}
        description="Add an external media link to repo."
        onClose={() => {
          if (!externalFormSubmitting) {
            setExternalFormOpen(false);
          }
        }}
        onSubmit={async (payload) => {
          await handleAddExternalLink(payload);
        }}
      />

      {previewAsset && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewAsset(null)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-white/10 bg-zinc-950 p-4 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">{previewAsset.label}</div>
                <div className="text-xs uppercase tracking-[0.14em] text-zinc-400">{previewAsset.mediaType}</div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-white/5"
              >
                Close
              </button>
            </div>

            {previewAsset.mediaType.toLowerCase() === "image" ? (
              <div className="flex max-h-[75vh] items-center justify-center overflow-hidden rounded-xl bg-black p-2">
                <img
                  src={previewAsset.url}
                  alt={previewAsset.label}
                  className="max-h-[72vh] max-w-full object-contain"
                />
              </div>
            ) : previewAsset.mediaType.toLowerCase() === "video" ? (
              <video
                src={previewAsset.url}
                controls
                autoPlay
                playsInline
                className="max-h-[75vh] w-full rounded-xl bg-black"
              />
            ) : (
              <div className="rounded-xl bg-black/40 p-4">
                <audio controls autoPlay className="w-full">
                  <source src={previewAsset.url} />
                </audio>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
