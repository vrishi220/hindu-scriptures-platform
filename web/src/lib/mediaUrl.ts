export const resolveMediaUrl = (rawUrl: string | null | undefined) => {
  const value = (rawUrl || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  if (value.startsWith("/media/")) {
    return `/api/media/${value.slice("/media/".length)}`;
  }
  return value;
};
