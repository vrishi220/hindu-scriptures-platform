import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const maxDuration = 120;

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";
const BACKEND_UNAVAILABLE = "Auth/content service unavailable. Please try again shortly.";

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const readResponsePayload = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => null)) as Record<string, unknown> | null;
  }

  const text = await response.text().catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return {
    detail: trimmed.length > 1000 ? `${trimmed.slice(0, 997)}...` : trimmed,
  };
};

const refreshAccessToken = async (refreshToken: string) => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as
    | { access_token: string; refresh_token: string }
    | null;
};

const setAuthCookies = async (accessToken: string, refreshToken: string) => {
  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const store = await cookies();
  const target = new URL(`/api/books/${bookId}/preview/render`, API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  const doPost = (token?: string) =>
    fetch(target.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify(body),
    });

  let response: Response;
  try {
    response = await doPost(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  let payload = await readResponsePayload(response);

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      await setAuthCookies(newTokens.access_token, newTokens.refresh_token);
      try {
        response = await doPost(newTokens.access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
      payload = await readResponsePayload(response);
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: `Book preview render failed (${response.status})` },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
