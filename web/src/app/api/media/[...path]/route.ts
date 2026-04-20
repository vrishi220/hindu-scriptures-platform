import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";

// This route must never be statically cached at the framework/CDN layer because
// media files can be replaced in place while keeping the same URL.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isLikelyImageRequest(pathParts: string[], request: NextRequest): boolean {
  const lastPart = pathParts[pathParts.length - 1] || "";
  const lowered = lastPart.toLowerCase();
  const hasImageExtension =
    lowered.endsWith(".png") ||
    lowered.endsWith(".jpg") ||
    lowered.endsWith(".jpeg") ||
    lowered.endsWith(".gif") ||
    lowered.endsWith(".webp") ||
    lowered.endsWith(".avif") ||
    lowered.endsWith(".svg");
  if (hasImageExtension) {
    return true;
  }
  const accept = (request.headers.get("accept") || "").toLowerCase();
  return accept.includes("image/");
}

function missingImagePlaceholder(pathParts: string[]): NextResponse {
  const fileLabel = pathParts[pathParts.length - 1] || "media";
  const escapedLabel = fileLabel
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 60);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" role="img" aria-label="Missing media">
  <rect width="320" height="240" fill="#f4f4f5"/>
  <rect x="1" y="1" width="318" height="238" fill="none" stroke="#d4d4d8"/>
  <g fill="#71717a" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" text-anchor="middle">
    <text x="160" y="110" font-size="14">Media file missing</text>
    <text x="160" y="132" font-size="11">${escapedLabel}</text>
  </g>
</svg>`.trim();
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      "x-media-fallback": "missing-upstream-image",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolved = await params;
  const pathParts = Array.isArray(resolved.path) ? resolved.path : [];
  if (pathParts.length === 0) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }

  const target = new URL(`/media/${pathParts.join("/")}`, API_BASE_URL);
  const imageRequest = isLikelyImageRequest(pathParts, request);
  const search = request.nextUrl.search;
  if (search) {
    target.search = search;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        Accept: request.headers.get("accept") || "*/*",
        ...(request.headers.get("if-none-match")
          ? { "if-none-match": request.headers.get("if-none-match") as string }
          : {}),
        ...(request.headers.get("if-modified-since")
          ? { "if-modified-since": request.headers.get("if-modified-since") as string }
          : {}),
      },
      cache: "no-store",
    });
  } catch {
    if (imageRequest) {
      return missingImagePlaceholder(pathParts);
    }
    return NextResponse.json({ detail: "Media upstream unavailable" }, { status: 502 });
  }

  if (upstream.status === 304) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        "cache-control": "no-cache, max-age=0, must-revalidate",
        "cdn-cache-control": "no-store",
        "vercel-cdn-cache-control": "no-store",
        ...(upstream.headers.get("etag")
          ? { etag: upstream.headers.get("etag") as string }
          : {}),
        ...(upstream.headers.get("last-modified")
          ? { "last-modified": upstream.headers.get("last-modified") as string }
          : {}),
      },
    });
  }

    if (!upstream.ok) {
      if (upstream.status === 404 && imageRequest) {
        return missingImagePlaceholder(pathParts);
      }
      const raw = await upstream.text().catch(() => "");
      return new NextResponse(raw || "", {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "text/plain",
        },
      });
    }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      // Browser may store bytes but must revalidate before reuse.
      "cache-control": "no-cache, max-age=0, must-revalidate",
      // Prevent stale edge cache entries at CDN/proxy layers.
      "cdn-cache-control": "no-store",
      "vercel-cdn-cache-control": "no-store",
      ...(upstream.headers.get("etag")
        ? { etag: upstream.headers.get("etag") as string }
        : {}),
      ...(upstream.headers.get("last-modified")
        ? { "last-modified": upstream.headers.get("last-modified") as string }
        : {}),
    },
  });
}
