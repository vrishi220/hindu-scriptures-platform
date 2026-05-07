import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET(request: Request) {
  const store = await cookies();
  const { searchParams } = new URL(request.url);

  const target = new URL("/api/content/books", API_BASE_URL);
  searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doFetch = (token?: string) =>
    fetch(target.toString(), {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  try {
    let response = await doFetch(accessToken);
    let rawText = await response.text();

    if (response.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken);
      if (refreshed?.access_token) {
        response = await doFetch(refreshed.access_token);
        rawText = await response.text();
      }
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }

    return NextResponse.json(payload ?? [], { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Upstream error" }, { status: 502 });
  }
}
