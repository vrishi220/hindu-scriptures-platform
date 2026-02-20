import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET() {
  const store = await cookies();
  const target = new URL("/api/content/books", API_BASE_URL);

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
      payload || { detail: "Books fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const store = await cookies();
  const target = new URL("/api/content/books", API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeader,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { detail: "Content service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const rawText = await response.text().catch(() => "");
  const payload = (() => {
    if (!rawText) return null;
    try {
      return JSON.parse(rawText) as { detail?: string };
    } catch {
      return null;
    }
  })();
  if (!response.ok) {
    const fallbackDetail = rawText || response.statusText || "Book creation failed";
    return NextResponse.json(
      payload || { detail: `Book creation failed (${response.status}): ${fallbackDetail}` },
      { status: response.status }
    );
  }

  return NextResponse.json(payload ?? null, { status: 201 });
}
