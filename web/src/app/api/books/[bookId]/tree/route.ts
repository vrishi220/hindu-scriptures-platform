import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const resolvedParams = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const target = new URL(
    `/api/content/books/${resolvedParams.bookId}/tree/nested`,
    API_BASE_URL
  );

  const doGet = (token?: string) =>
    fetch(target.toString(), {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await doGet(accessToken);
  } catch {
    return NextResponse.json(
      { detail: "Tree service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens?.access_token) {
      try {
        response = await doGet(newTokens.access_token);
      } catch {
        return NextResponse.json(
          { detail: "Tree service unavailable. Please start the API server and try again." },
          { status: 503 }
        );
      }
      payload = await response.json().catch(() => null);
      if (response.ok) {
        const res = NextResponse.json(payload);
        res.cookies.set(ACCESS_TOKEN_COOKIE, newTokens.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        res.cookies.set(REFRESH_TOKEN_COOKIE, newTokens.refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        return res;
      }
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Tree fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
