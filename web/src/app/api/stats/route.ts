import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET() {
  const store = await cookies();
  const target = new URL("/api/content/stats", API_BASE_URL);

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
      payload || { detail: "Stats fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
