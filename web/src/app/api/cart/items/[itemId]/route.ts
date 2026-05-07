import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, BACKEND_UNAVAILABLE, buildAuthHeader, refreshAccessToken, setAuthCookies } from "@/lib/apiProxy";


export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doDelete = (token?: string) =>
    fetch(`${API_BASE_URL}/api/cart/items/${itemId}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
    });

  let response: Response;
  try {
    response = await doDelete(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      await setAuthCookies(newTokens.access_token, newTokens.refresh_token);
      try {
        response = await doDelete(newTokens.access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }
    }
  }

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Failed to remove cart item" }, { status: response.status });
  }

  return NextResponse.json(payload);
}
