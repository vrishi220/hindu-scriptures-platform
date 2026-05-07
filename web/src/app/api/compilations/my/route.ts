import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, BACKEND_UNAVAILABLE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doGet = (token?: string) =>
    fetch(`${API_BASE_URL}/api/compilations/my`, {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
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

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to fetch compilations" }));
    return NextResponse.json(error, { status: response.status });
  }

  const data = await response.json().catch(() => []);
  return NextResponse.json(data);
}
