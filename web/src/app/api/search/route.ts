import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(request: Request) {
  const store = await cookies();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const mode = (searchParams.get("mode") || "").trim().toLowerCase();

  if (!query.trim()) {
    return NextResponse.json(
      { detail: "Query required" },
      { status: 400 }
    );
  }

  const target = new URL(mode === "fulltext" ? "/api/search/fulltext" : "/api/search", API_BASE_URL);
  for (const [key, value] of searchParams.entries()) {
    if (key === "mode") {
      continue;
    }
    if (value !== "") {
      target.searchParams.set(key, value);
    }
  }

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const response = await fetch(target.toString(), {
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Search failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
