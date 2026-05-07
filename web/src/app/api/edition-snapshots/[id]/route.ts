import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, BACKEND_UNAVAILABLE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doGet = (token?: string) =>
    fetch(`${API_BASE_URL}/api/edition-snapshots/${id}`, {
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
        response = await doGet(access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
    }
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to fetch snapshot" }, { status: response.status });
  }

  return NextResponse.json(payload);
}
