import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, BACKEND_UNAVAILABLE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


const forwardRequest = async (
  id: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown
) => {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  const doRequest = (token?: string) =>
    fetch(`${API_BASE_URL}/api/metadata/draft-books/${id}/metadata-binding`, {
      method,
      headers: {
        Accept: "application/json",
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...buildAuthHeader(token),
      },
      ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await doRequest(accessToken);
  } catch {
    return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
  }

  let payload = await response.json().catch(() => null);

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
        response = await doRequest(access_token);
      } catch {
        return NextResponse.json({ detail: BACKEND_UNAVAILABLE }, { status: 503 });
      }

      payload = await response.json().catch(() => null);
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: `Failed to ${method.toLowerCase()} metadata binding` },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return forwardRequest(id, "GET");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }
  return forwardRequest(id, "POST", body);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }
  return forwardRequest(id, "PATCH", body);
}
