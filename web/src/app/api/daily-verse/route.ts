import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET(request: Request) {
  const store = await cookies();
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  const target = new URL("/api/content/daily-verse", API_BASE_URL);
  if (mode) {
    target.searchParams.set("mode", mode);
  }

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doGet = (token?: string) =>
    fetch(target.toString(), {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      cache: "no-store",
    });

  try {
    let response = await doGet(accessToken);
    let payload = await response.json().catch(() => null);

    if (response.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken);
      if (refreshed?.access_token) {
        response = await doGet(refreshed.access_token);
        payload = await response.json().catch(() => null);
        const res = NextResponse.json(
          response.ok ? payload : payload || { detail: "Failed to fetch daily verse" },
          { status: response.status }
        );
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

      // If refresh failed, fall back to anonymous daily verse behavior.
      response = await doGet();
      payload = await response.json().catch(() => null);
    }

    if (!response.ok) {
      return NextResponse.json(
        payload || { detail: "Failed to fetch daily verse" },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching daily verse:", error);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}
