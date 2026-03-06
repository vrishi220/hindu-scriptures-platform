"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, List, MoreVertical } from "lucide-react";
import { getMe } from "@/lib/authClient";
import InlineClearButton from "@/components/InlineClearButton";
import ExternalMediaFormModal from "@/components/ExternalMediaFormModal";
import {
  createMediaBankLinkAsset,
  deleteMediaBankAsset,
  listMediaBankAssets,
  MediaBankClientError,
  renameMediaBankAsset,
  uploadMediaBankAsset,
} from "@/lib/mediaBankClient";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { type ExternalMediaType } from "@/lib/externalMedia";

const ADMIN_MEDIA_BANK_VIEW_KEY = "admin_media_bank_browser_view";

const readStoredBrowserView = (): "list" | "icon" => {
  if (typeof window === "undefined") {
    return "list";
  }
  return window.localStorage.getItem(ADMIN_MEDIA_BANK_VIEW_KEY) === "icon" ? "icon" : "list";
};

const normalizeBrowserView = (value: unknown): "list" | "icon" =>
  value === "icon" ? "icon" : "list";

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

export default function AdminMediaBankPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
  const [browserView, setBrowserView] = useState<"list" | "icon">("list");
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openActionsId, setOpenActionsId] = useState<number | null>(null);
  const [externalFormOpen, setExternalFormOpen] = useState(false);
  const [externalFormSubmitting, setExternalFormSubmitting] = useState(false);
  const [accountPrefReady, setAccountPrefReady] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const actionMenuRefs = useRef<Record<number, HTMLDivElement | null>>({});

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
            setBrowserView(normalizeBrowserView(payload?.admin_media_bank_browser_view));
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
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (openActionsId === null) return;
      const menu = actionMenuRefs.current[openActionsId];
      const target = event.target as Node;
      if (menu && !menu.contains(target)) {
        setOpenActionsId(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openActionsId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ADMIN_MEDIA_BANK_VIEW_KEY, browserView);
  }, [browserView]);

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

  const handleRename = async (assetId: number) => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setToast({ type: "error", message: "Display name is required." });
      return;
    }

    setUpdatingId(assetId);
    setToast(null);
    try {
      await renameMediaBankAsset(assetId, nextName);
      setRenameId(null);
      setRenameValue("");
      setToast({ type: "success", message: "Asset renamed." });
      await loadAssets();
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
            <div className="inline-flex rounded-md border border-black/10 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setBrowserView("list")}
                className={`inline-flex h-8 w-8 items-center justify-center rounded ${
                  browserView === "list"
                    ? "bg-[color:var(--accent)] text-white"
                    : "text-zinc-600 hover:bg-zinc-50"
                }`}
                aria-label="List view"
                title="List view"
              >
                <List size={14} />
              </button>
              <button
                type="button"
                onClick={() => setBrowserView("icon")}
                className={`inline-flex h-8 w-8 items-center justify-center rounded ${
                  browserView === "icon"
                    ? "bg-[color:var(--accent)] text-white"
                    : "text-zinc-600 hover:bg-zinc-50"
                }`}
                aria-label="Icon view"
                title="Icon view"
              >
                <LayoutGrid size={14} />
              </button>
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
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-black/10 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
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
            <div className={browserView === "icon" ? "grid grid-cols-1 gap-2 p-2 sm:grid-cols-2" : "divide-y divide-black/5"}>
              {filteredAssets.map((asset) => {
                const label = getDisplayName(asset);
                const isRenaming = renameId === asset.id;
                const isImage = (asset.media_type || "").toLowerCase() === "image";
                const showUrl = isExternalUrl(asset.url);
                return (
                  <div
                    key={asset.id}
                    className={
                      browserView === "icon"
                        ? "overflow-hidden rounded-xl border border-black/10 bg-white text-sm text-zinc-700"
                        : "grid grid-cols-[2.2fr_0.9fr_1.5fr] items-center gap-3 px-3 py-2.5 text-sm text-zinc-700"
                    }
                  >
                    {browserView === "icon" ? (
                      <>
                        {isImage ? (
                          <img
                            src={resolveMediaUrl(asset.url)}
                            alt={label}
                            className="h-32 w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-32 w-full items-center justify-center bg-zinc-100 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                            {asset.media_type || "media"}
                          </div>
                        )}
                        <div className="space-y-2 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              {isRenaming ? (
                                <input
                                  value={renameValue}
                                  onChange={(event) => setRenameValue(event.target.value)}
                                  className="w-full rounded border border-black/10 bg-white px-2 py-1 text-sm"
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
                                  onClick={() => {
                                    setRenameId(null);
                                    setRenameValue("");
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
                                  disabled={deletingId === asset.id || updatingId === asset.id}
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
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0">
                          {isRenaming ? (
                            <input
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              className="w-full rounded border border-black/10 bg-white px-2 py-1 text-sm"
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              {isImage ? (
                                <img
                                  src={resolveMediaUrl(asset.url)}
                                  alt={label}
                                  className="h-10 w-10 shrink-0 rounded-md border border-black/10 object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-black/10 bg-zinc-50 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                                  {asset.media_type || "media"}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-medium">{label}</div>
                                {showUrl && <div className="truncate text-xs text-zinc-500">{asset.url}</div>}
                              </div>
                            </div>
                          )}
                        </div>
                        <span className="uppercase text-xs tracking-[0.12em] text-zinc-600">{asset.media_type || "other"}</span>
                        <div className="flex items-center justify-end gap-1.5">
                          {isRenaming ? (
                            <>
                              <button
                                type="button"
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
                                onClick={() => {
                                  setRenameId(null);
                                  setRenameValue("");
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
                                disabled={deletingId === asset.id || updatingId === asset.id}
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
    </main>
  );
}
