import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";
const BACKEND_UNAVAILABLE = "Auth/content service unavailable. Please try again shortly.";

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

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

export async function proxyTemplatesRequest(request: Request, pathSuffix = "") {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const url = new URL(request.url);
  const search = url.search || "";
  const method = request.method;

  const bodyText = method === "GET" || method === "HEAD" ? undefined : await request.text();

  const doRequest = (token?: string) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...buildAuthHeader(token),
    };

    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = request.headers.get("content-type") || "application/json";
    }

    return fetch(`${API_BASE_URL}/api/templates${pathSuffix}${search}`, {
      method,
      headers,
      body: bodyText,
      cache: "no-store",
    });
  };

  let response: Response;
  try {
    response = await doRequest(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      const { access_token, refresh_token } = newTokens;
      store.set(ACCESS_TOKEN_COOKIE, access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      store.set(REFRESH_TOKEN_COOKIE, refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });

      try {
        response = await doRequest(access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
    }
  }

  const payload = await response.json().catch(() => null);
  if (response.status === 204) {
    return new Response(null, { status: 204 });
  }

  return NextResponse.json(payload || {}, { status: response.status });
}
