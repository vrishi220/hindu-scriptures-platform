import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ detail: "Email and password required" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { detail: "Auth service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const rawText = await response.text().catch(() => "");
  const payload = (() => {
    if (!rawText) return null;
    try {
      return JSON.parse(rawText) as { access_token?: string; refresh_token?: string; detail?: string };
    } catch {
      return null;
    }
  })();

  if (!response.ok) {
    const fallbackDetail = rawText || response.statusText || "Login failed";
    return NextResponse.json(
      payload || { detail: `Login failed (${response.status}): ${fallbackDetail}` },
      { status: response.status }
    );
  }

  if (!payload?.access_token || !payload?.refresh_token) {
    const fallbackDetail = rawText || "Invalid auth response";
    return NextResponse.json(
      { detail: `Login failed (${response.status}): ${fallbackDetail}` },
      { status: 502 }
    );
  }

  const res = NextResponse.json({ message: "Logged in" });
  res.cookies.set(ACCESS_TOKEN_COOKIE, payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  res.cookies.set(REFRESH_TOKEN_COOKIE, payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
