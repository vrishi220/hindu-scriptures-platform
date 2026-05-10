import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  API_BASE_URL,
  REFRESH_TOKEN_COOKIE,
  buildAuthHeader,
  refreshAccessToken,
  setAuthCookies,
} from "@/lib/apiProxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const target = `${API_BASE_URL}/api/compilations/${id}/publish-as-book`;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  const send = (token?: string) =>
    fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildAuthHeader(token) },
      body: JSON.stringify(body),
    });

  let response: Response;
  try {
    response = await send(accessToken);
  } catch {
    return NextResponse.json(
      { detail: "Compilations service unavailable" },
      { status: 503 }
    );
  }

  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed?.access_token) {
      try {
        response = await send(refreshed.access_token);
      } catch {
        return NextResponse.json(
          { detail: "Compilations service unavailable" },
          { status: 503 }
        );
      }
      await setAuthCookies(refreshed.access_token, refreshed.refresh_token);
    }
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to publish compilation" },
      { status: response.status }
    );
  }
  return NextResponse.json(payload, { status: response.status });
}
