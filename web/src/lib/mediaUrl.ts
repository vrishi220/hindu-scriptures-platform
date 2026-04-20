export const resolveMediaUrl = (rawUrl: string | null | undefined) => {
  const value = (rawUrl || "").trim();
  if (!value) return "";

  if (value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("//")) {
    return value;
  }

  if (value.startsWith("/api/media/")) {
    return value;
  }

  if (value.startsWith("api/media/")) {
    return `/${value}`;
  }

  if (value.startsWith("/media/")) {
    return `/api/media/${value.slice("/media/".length)}`;
  }

  if (value.startsWith("media/")) {
    return `/api/media/${value.slice("media/".length)}`;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/media/")) {
        const suffix = parsed.pathname.slice("/media/".length);
        const query = parsed.search || "";
        const hash = parsed.hash || "";
        return `/api/media/${suffix}${query}${hash}`;
      }
    } catch {
      return value;
    }
    return value;
  }

  if (value.startsWith("/")) {
    return value;
  }

  return `/${value.replace(/^\.?\/+/, "")}`;
};

const normalizeVersionToken = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
};

export const appendMediaVersion = (
  mediaUrl: string | null | undefined,
  versionToken: unknown,
): string => {
  const normalizedUrl = (mediaUrl || "").trim();
  const version = normalizeVersionToken(versionToken);
  if (!normalizedUrl || !version) {
    return normalizedUrl;
  }

  const hashIndex = normalizedUrl.indexOf("#");
  const hash = hashIndex >= 0 ? normalizedUrl.slice(hashIndex) : "";
  const beforeHash = hashIndex >= 0 ? normalizedUrl.slice(0, hashIndex) : normalizedUrl;

  const queryIndex = beforeHash.indexOf("?");
  const basePath = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const queryText = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(queryText);
  params.set("v", version);
  const query = params.toString();

  return `${basePath}${query ? `?${query}` : ""}${hash}`;
};

export const resolveMediaUrlWithMetadataVersion = (
  rawUrl: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string => {
  const resolved = resolveMediaUrl(rawUrl);
  if (!metadata || typeof metadata !== "object") {
    return resolved;
  }

  const versionCandidates = [
    metadata.replaced_at,
    metadata.thumbnail_replaced_at,
    metadata.size_bytes,
    metadata.thumbnail_size_bytes,
  ];
  const version = versionCandidates
    .map((candidate) => normalizeVersionToken(candidate))
    .find((candidate) => candidate.length > 0);

  if (!version) {
    return resolved;
  }

  return appendMediaVersion(resolved, version);
};
