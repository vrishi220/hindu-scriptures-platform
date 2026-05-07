import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function POST(request: Request) {
  const store = await cookies();
  const body = await request.json().catch(() => null) as { query?: string } | null;

  if (!body?.query?.trim()) {
    return NextResponse.json({ detail: "Query required" }, { status: 400 });
  }

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const response = await fetch(`${API_BASE_URL}/api/search/semantic`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeader,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Semantic search failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
