import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const refreshAccessToken = async (refreshToken: string) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as
    | { access_token: string; refresh_token: string }
    | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const resolvedParams = await params;
  const formData = await request.formData();

  const doPost = (token?: string) =>
    fetch(`${API_BASE_URL}/api/content/books/${resolvedParams.bookId}/thumbnail`, {
      method: "POST",
      headers: {
        ...buildAuthHeader(token),
      },
      body: formData,
    });

  let response = await doPost(accessToken);
  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      response = await doPost(refreshed.access_token);
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
      if (!response.ok) {
        return NextResponse.json(
          payload || { detail: "Failed to upload thumbnail" },
          { status: response.status }
        );
      }
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to upload thumbnail" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload, { status: response.status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const resolvedParams = await params;

  const doDelete = (token?: string) =>
    fetch(`${API_BASE_URL}/api/content/books/${resolvedParams.bookId}/thumbnail`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
    });

  let response = await doDelete(accessToken);
  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      response = await doDelete(refreshed.access_token);
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
      if (!response.ok) {
        return NextResponse.json(
          payload || { detail: "Failed to remove thumbnail" },
          { status: response.status }
        );
      }
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to remove thumbnail" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || {}, { status: response.status });
}
