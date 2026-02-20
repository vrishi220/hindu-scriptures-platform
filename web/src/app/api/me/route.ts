import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Missing access token cookie" }, { status: 401 });
  }
  const authHeader: Record<string, string> = { Authorization: `Bearer ${accessToken}` };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/users/me`, {
      headers: {
        Accept: "application/json",
        ...authHeader,
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Auth service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(payload || { detail: "Unauthorized" }, { status: response.status });
  }

  return NextResponse.json(payload);
}
