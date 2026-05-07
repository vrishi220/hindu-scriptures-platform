import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const resolvedParams = await params;

  const response = await fetch(
    `${API_BASE_URL}/api/content/nodes/${resolvedParams.nodeId}/comments${request.nextUrl.search}`,
    {
      headers: {
        Accept: "application/json",
        ...buildAuthHeader(accessToken),
      },
      cache: "no-store",
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to load comments" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  const resolvedParams = await params;
  const body = await request.json().catch(() => null);

  const doPost = (token?: string) =>
    fetch(`${API_BASE_URL}/api/content/nodes/${resolvedParams.nodeId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...buildAuthHeader(token),
      },
      body: JSON.stringify(body),
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
          payload || { detail: "Failed to save comment" },
          { status: response.status }
        );
      }
      return res;
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to save comment" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || {}, { status: response.status });
}
