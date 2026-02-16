import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(request: Request) {
  const store = await cookies();
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  const target = new URL("/api/content/daily-verse", API_BASE_URL);
  if (mode) {
    target.searchParams.set("mode", mode);
  }

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  try {
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
        payload || { detail: "Failed to fetch daily verse" },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching daily verse:", error);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}
