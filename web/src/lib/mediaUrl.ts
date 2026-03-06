export const resolveMediaUrl = (rawUrl: string | null | undefined) => {
  const value = (rawUrl || "").trim();
  if (!value) return "";

  if (value.startsWith("data:")) {
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

  return value;
};
