import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";

const BACKEND_UNAVAILABLE = "Auth service unavailable. Please start the API server and try again.";


export async function GET() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!accessToken && !refreshToken) {
    return NextResponse.json({ detail: "Missing access token cookie" }, { status: 401 });
  }

  const doGet = (token?: string) =>
    fetch(`${API_BASE_URL}/api/users/me`, {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await doGet(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  let payload = await response.json().catch(() => null);
  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      try {
        response = await doGet(refreshed.access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
      payload = await response.json().catch(() => null);
      const res = NextResponse.json(payload || {}, { status: response.status });
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.access_token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Unauthorized" }, { status: response.status });
  }

  return NextResponse.json(payload);
}

export async function PATCH(request: Request) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const body = await request.json().catch(() => ({}));

  const doPatch = (token?: string) =>
    fetch(`${API_BASE_URL}/api/users/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify(body),
    });

  let response: Response;
  try {
    response = await doPatch(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  let payload = await response.json().catch(() => null);
  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      try {
        response = await doPatch(refreshed.access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
      payload = await response.json().catch(() => null);
      const res = NextResponse.json(payload || {}, { status: response.status });
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.access_token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to update profile" }, { status: response.status });
  }

  return NextResponse.json(payload, { status: 200 });
}
