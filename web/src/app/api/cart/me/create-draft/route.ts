import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, BACKEND_UNAVAILABLE, buildAuthHeader, refreshAccessToken, setAuthCookies } from "@/lib/apiProxy";


export async function POST(request: Request) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  const doPost = (token?: string) =>
    fetch(`${API_BASE_URL}/api/cart/me/create-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify(body),
    });

  let response: Response;
  try {
    response = await doPost(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  let payload = await response.json().catch(() => null);

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      await setAuthCookies(newTokens.access_token, newTokens.refresh_token);
      try {
        response = await doPost(newTokens.access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
      payload = await response.json().catch(() => null);
    }
  }

  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to create draft from cart" }, { status: response.status });
  }

  return NextResponse.json(payload, { status: 201 });
}
