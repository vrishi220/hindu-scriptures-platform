import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, BACKEND_UNAVAILABLE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";

const DEFAULT_PREFERENCES = {
  source_language: "english",
  transliteration_enabled: true,
  transliteration_script: "iast",
  show_roman_transliteration: true,
  show_only_preferred_script: false,
  show_media: true,
  show_commentary: true,
  preview_show_titles: false,
  preview_show_labels: false,
  preview_show_details: false,
  preview_show_media: true,
  preview_show_sanskrit: true,
  preview_show_transliteration: true,
  preview_show_english: true,
  preview_transliteration_script: "iast",
  word_meanings_default_source_language: "sa",
  word_meanings_default_meaning_language: "en",
  scriptures_book_browser_view: "list",
  scriptures_media_manager_view: "list",
  admin_media_bank_browser_view: "list",
};


export async function GET() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doGet = (token?: string) =>
    fetch(`${API_BASE_URL}/api/preferences`, {
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
    return NextResponse.json(DEFAULT_PREFERENCES, { status: 200 });
  }
  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      try {
        response = await doGet(refreshed.access_token);
      } catch {
        return NextResponse.json(DEFAULT_PREFERENCES, { status: 200 });
      }
      payload = await response.json().catch(() => null);
      const res = NextResponse.json(payload || {}, { status: response.status });
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return res;
    }
  }

  if (!response.ok) {
    if (response.status >= 500) {
      return NextResponse.json(DEFAULT_PREFERENCES, { status: 200 });
    }
    return NextResponse.json(payload || { detail: "Failed to fetch preferences" }, { status: response.status });
  }

  return NextResponse.json(payload, { status: 200 });
}

export async function PATCH(request: Request) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const body = await request.json().catch(() => ({}));

  const doPatch = (token?: string) =>
    fetch(`${API_BASE_URL}/api/preferences`, {
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
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 502 });
  }
  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      try {
        response = await doPatch(refreshed.access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 502 });
      }
      payload = await response.json().catch(() => null);
      const res = NextResponse.json(payload || {}, { status: response.status });
      res.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to update preferences" }, { status: response.status });
  }

  return NextResponse.json(payload, { status: 200 });
}
