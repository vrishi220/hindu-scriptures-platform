/**
 * Shared Next.js API proxy utilities.
 *
 * Provides the auth constants, header helpers, and token-refresh logic that
 * previously appeared verbatim in every route file.  Import from here instead
 * of re-declaring these in each route.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const API_BASE_URL =
  process.env.API_BASE_URL || "http://127.0.0.1:8000";

export const ACCESS_TOKEN_COOKIE =
  process.env.ACCESS_TOKEN_COOKIE || "access_token";

export const REFRESH_TOKEN_COOKIE =
  process.env.REFRESH_TOKEN_COOKIE || "refresh_token";

export const BACKEND_UNAVAILABLE =
  "Auth/content service unavailable. Please try again shortly.";

export function buildAuthHeader(
  token?: string
): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as {
      access_token: string;
      refresh_token: string;
    } | null;
  } catch {
    return null;
  }
}

export async function setAuthCookies(
  accessToken: string,
  refreshToken: string
): Promise<void> {
  const store = await cookies();
  const isProduction = process.env.NODE_ENV === "production";
  store.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
}

// ---------------------------------------------------------------------------
// Higher-level helper — optional convenience wrapper for the standard pattern:
//   1. Try the request with the current access token
//   2. On 401, refresh → retry
//   3. Return a NextResponse with the proxied status/body
// ---------------------------------------------------------------------------

type ProxyOptions = {
  /** Factory called with the current (or refreshed) token. */
  fetcher: (token?: string) => Promise<Response>;
  /** Detail string on backend unavailable (503). */
  unavailableDetail?: string;
  /** Detail string when backend returns non-OK and has no body. */
  failureDetail?: string;
  /** Override success HTTP status (e.g. 201 for creates). Defaults to backend status. */
  successStatus?: number;
};

export async function proxyWithAuth({
  fetcher,
  unavailableDetail = BACKEND_UNAVAILABLE,
  failureDetail,
  successStatus,
}: ProxyOptions): Promise<NextResponse> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  let response: Response;
  try {
    response = await fetcher(accessToken);
  } catch {
    return NextResponse.json({ detail: unavailableDetail }, { status: 503 });
  }

  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      await setAuthCookies(newTokens.access_token, newTokens.refresh_token);
      try {
        response = await fetcher(newTokens.access_token);
      } catch {
        return NextResponse.json({ detail: unavailableDetail }, { status: 503 });
      }
      payload = await response.json().catch(() => null);
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: failureDetail ?? "Request failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(
    payload,
    { status: successStatus ?? response.status }
  );
}
