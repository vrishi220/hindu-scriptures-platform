import type { ReadonlyURLSearchParams } from "next/navigation";
import type { PersistedImportJobState } from "./scriptureTypes";
import {
  ACTIVE_IMPORT_JOB_STORAGE_KEY,
  SCRIPTURES_BOOK_BROWSER_DENSITY_KEY,
  SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY,
  SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY,
  SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY,
  SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY,
} from "./scriptureUtils";

export const readPersistedImportJobState = (): PersistedImportJobState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_IMPORT_JOB_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedImportJobState | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.jobId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writePersistedImportJobState = (state: PersistedImportJobState) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ACTIVE_IMPORT_JOB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures
  }
};

export const clearPersistedImportJobState = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(ACTIVE_IMPORT_JOB_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
};

export type LayoutDeviceBucket = "phone" | "tablet" | "desktop";

export const getLayoutDeviceBucket = (): LayoutDeviceBucket => {
  if (typeof window === "undefined") {
    return "desktop";
  }
  const width = window.innerWidth;
  if (width < 768) {
    return "phone";
  }
  if (width < 1024) {
    return "tablet";
  }
  return "desktop";
};

export const getDeviceScopedStorageKey = (baseKey: string): string =>
  `${baseKey}_${getLayoutDeviceBucket()}`;

export const resolvePreviewQueryScope = (
  params: URLSearchParams | ReadonlyURLSearchParams
): "book" | "node" | null => {
  const previewParam = params.get("preview");
  if (previewParam === "book" || previewParam === "node") {
    return previewParam;
  }
  if (params.get("browse") === "1") {
    return null;
  }
  return params.get("book") ? "book" : null;
};

export const readStoredBrowserView = (storageKey: string): "list" | "icon" => {
  if (typeof window === "undefined") {
    return "list";
  }
  const scopedValue = window.localStorage.getItem(getDeviceScopedStorageKey(storageKey));
  if (scopedValue !== null) {
    return scopedValue === "icon" ? "icon" : "list";
  }
  return window.localStorage.getItem(storageKey) === "icon" ? "icon" : "list";
};

export const normalizeBookBrowserDensity = (value: unknown): 0 | 1 | 2 | 3 | 4 | 5 => {
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

export const readStoredBookBrowserDensity = (): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (typeof window === "undefined") {
    return 0;
  }
  const scopedValue = window.localStorage.getItem(
    getDeviceScopedStorageKey(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY)
  );
  if (scopedValue !== null) {
    return normalizeBookBrowserDensity(scopedValue);
  }
  return normalizeBookBrowserDensity(window.localStorage.getItem(SCRIPTURES_BOOK_BROWSER_DENSITY_KEY));
};

export const mediaManagerDensityStorageKey = (scope: "node" | "book" | "bank"): string => {
  if (scope === "book") return SCRIPTURES_MEDIA_MANAGER_DENSITY_BOOK_KEY;
  if (scope === "bank") return SCRIPTURES_MEDIA_MANAGER_DENSITY_BANK_KEY;
  return SCRIPTURES_MEDIA_MANAGER_DENSITY_NODE_KEY;
};

export const readStoredMediaManagerDensity = (scope: "node" | "book" | "bank"): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (typeof window === "undefined") {
    return 0;
  }
  const scopedValue = window.localStorage.getItem(
    getDeviceScopedStorageKey(mediaManagerDensityStorageKey(scope))
  );
  if (scopedValue !== null) {
    return normalizeBookBrowserDensity(scopedValue);
  }
  const legacyScopedValue = window.localStorage.getItem(mediaManagerDensityStorageKey(scope));
  if (legacyScopedValue !== null) {
    return normalizeBookBrowserDensity(legacyScopedValue);
  }
  return normalizeBookBrowserDensity(window.localStorage.getItem(SCRIPTURES_MEDIA_MANAGER_DENSITY_KEY));
};

export const resolveBookBrowserDensity = (
  storedDensity: unknown,
  preferenceDensity: unknown,
  preferenceView: "list" | "icon"
): 0 | 1 | 2 | 3 | 4 | 5 => {
  const normalizedStoredDensity = normalizeBookBrowserDensity(storedDensity);
  if (normalizedStoredDensity !== 0) {
    return normalizedStoredDensity;
  }
  const normalizedPreferenceDensity = normalizeBookBrowserDensity(preferenceDensity);
  if (preferenceView === "icon" && normalizedPreferenceDensity === 0) {
    return 3;
  }
  return normalizedPreferenceDensity;
};

export const normalizeBrowserView = (value: unknown): "list" | "icon" =>
  value === "icon" ? "icon" : "list";
