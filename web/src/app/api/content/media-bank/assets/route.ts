import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET(request: NextRequest) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const query = request.nextUrl.search;

  const response = await fetch(`${API_BASE_URL}/api/content/media-bank/assets${query}`, {
    headers: {
      Accept: "application/json",
      ...buildAuthHeader(accessToken),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to load media bank assets" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload, { status: response.status });
}

export async function POST(request: NextRequest) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const formData = await request.formData();

  const doPost = (token?: string) =>
    fetch(`${API_BASE_URL}/api/content/media-bank/assets`, {
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
          payload || { detail: "Failed to upload media asset" },
          { status: response.status }
        );
      }
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to upload media asset" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload, { status: response.status });
}
