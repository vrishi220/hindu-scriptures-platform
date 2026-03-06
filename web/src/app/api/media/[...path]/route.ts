import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";

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
  const search = request.nextUrl.search;
  if (search) {
    target.search = search;
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      Accept: request.headers.get("accept") || "*/*",
    },
    cache: "no-store",
  });

  if (!upstream.ok) {
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
      "cache-control": upstream.headers.get("cache-control") || "public, max-age=3600",
    },
  });
}
