import { contentPath } from "@/lib/apiPaths";
import { type ExternalMediaType } from "@/lib/externalMedia";

export type MediaBankAssetLinkPayload = {
  url: string;
  displayName?: string;
  mediaType?: ExternalMediaType;
};

export type MediaBankAssetMinimal = {
  id: number;
  media_type: string;
  url: string;
  metadata_json?: Record<string, unknown> | null;
};

export class MediaBankClientError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MediaBankClientError";
    this.status = status;
  }
}

const normalizeErrorValue = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeErrorValue(entry))
      .filter(Boolean)
      .join("; ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === "string" && record.msg.trim()) {
      return record.msg.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if ("detail" in record) {
      const nested = normalizeErrorValue(record.detail);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
};

const getErrorMessageFromPayload = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = normalizeErrorValue((payload as { detail?: unknown }).detail);
    if (detail) {
      return detail;
    }
  }
  const generic = normalizeErrorValue(payload);
  return generic || fallback;
};

const normalizeAsset = (asset: Partial<MediaBankAssetMinimal> | null): MediaBankAssetMinimal => {
  if (!asset || typeof asset.id !== "number") {
    throw new MediaBankClientError("Media asset was returned in an unexpected format.");
  }

  return {
    id: asset.id,
    media_type: typeof asset.media_type === "string" ? asset.media_type : "",
    url: typeof asset.url === "string" ? asset.url : "",
    metadata_json:
      asset.metadata_json && typeof asset.metadata_json === "object"
        ? (asset.metadata_json as Record<string, unknown>)
        : null,
  };
};

const buildClientError = (payload: unknown, fallback: string, status?: number): MediaBankClientError =>
  new MediaBankClientError(getErrorMessageFromPayload(payload, fallback), status);

export const listMediaBankAssets = async (limit = 300): Promise<MediaBankAssetMinimal[]> => {
  const response = await fetch(contentPath(`/media-bank/assets?limit=${limit}`), {
    credentials: "include",
  });
  const responsePayload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw buildClientError(responsePayload, "Failed to load media repo", response.status);
  }

  if (!Array.isArray(responsePayload)) {
    return [];
  }

  return responsePayload.map((entry) => normalizeAsset(entry as Partial<MediaBankAssetMinimal>));
};

export const uploadMediaBankAsset = async (file: File): Promise<MediaBankAssetMinimal> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(contentPath("/media-bank/assets"), {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const responsePayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw buildClientError(responsePayload, "Failed to upload media asset", response.status);
  }

  return normalizeAsset(responsePayload as Partial<MediaBankAssetMinimal>);
};

export const renameMediaBankAsset = async (
  assetId: number,
  displayName: string
): Promise<MediaBankAssetMinimal> => {
  const response = await fetch(contentPath(`/media-bank/assets/${assetId}`), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });

  const responsePayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw buildClientError(responsePayload, "Failed to rename media asset", response.status);
  }

  return normalizeAsset(responsePayload as Partial<MediaBankAssetMinimal>);
};

export const deleteMediaBankAsset = async (assetId: number): Promise<void> => {
  const response = await fetch(contentPath(`/media-bank/assets/${assetId}`), {
    method: "DELETE",
    credentials: "include",
  });

  const responsePayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw buildClientError(responsePayload, "Failed to delete media asset", response.status);
  }
};

export const createMediaBankLinkAsset = async (
  payload: MediaBankAssetLinkPayload
): Promise<MediaBankAssetMinimal> => {
  const response = await fetch(contentPath("/media-bank/assets/link"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: payload.url,
      ...(payload.displayName ? { display_name: payload.displayName } : {}),
      ...(payload.mediaType ? { media_type: payload.mediaType } : {}),
    }),
  });

  const responsePayload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw buildClientError(responsePayload, "Failed to create media link", response.status);
  }

  return normalizeAsset(responsePayload as Partial<MediaBankAssetMinimal>);
};
