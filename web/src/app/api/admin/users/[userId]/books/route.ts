import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
  const resolvedParams = await params;

  const response = await fetch(`${API_BASE_URL}/api/users/${resolvedParams.userId}/books`, {
    headers: {
      Accept: "application/json",
      ...authHeader,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to load user books" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
