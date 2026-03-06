export type ExternalMediaType = "image" | "audio" | "video" | "link";

const anyFileExtension = (value: string, extensions: string[]): boolean =>
  extensions.some((extension) => value.endsWith(extension));

const getYouTubeVideoId = (rawUrl: string): string | null => {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const videoId = parsed.pathname.replace(/^\//, "").split("/")[0];
      return videoId || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") || null;
      }
      if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
        const videoId = parsed.pathname.split("/")[2];
        return videoId || null;
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const getYouTubeEmbedUrl = (rawUrl: string): string | null => {
  const videoId = getYouTubeVideoId(rawUrl);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
};

export const inferMediaTypeFromUrl = (rawUrl: string): ExternalMediaType => {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "link";
  }

  try {
    const parsed = new URL(rawUrl);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }
    const path = (parsed.pathname || "").toLowerCase();

    if (anyFileExtension(path, [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"])) {
      return "image";
    }
    if (anyFileExtension(path, [".mp3", ".wav", ".ogg", ".aac", ".m4a", ".flac"])) {
      return "audio";
    }
    if (anyFileExtension(path, [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"])) {
      return "video";
    }
    if (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "vimeo.com" ||
      host === "dailymotion.com"
    ) {
      return "video";
    }

    return "link";
  } catch {
    return "link";
  }
};

export const inferDisplayNameFromUrl = (rawUrl: string): string => {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "";
  }
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      return "YouTube Video";
    }
    if (host === "vimeo.com") {
      return "Vimeo Video";
    }
    if (host === "dailymotion.com") {
      return "Dailymotion Video";
    }
    const leaf = parsed.pathname.split("/").filter(Boolean).pop();
    if (leaf) {
      return decodeURIComponent(leaf);
    }
    return parsed.hostname;
  } catch {
    return "";
  }
};
