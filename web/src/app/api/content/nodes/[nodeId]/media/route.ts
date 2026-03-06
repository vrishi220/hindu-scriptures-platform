import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

const buildAuthHeader = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const resolvedParams = await params;

  const response = await fetch(
    `${API_BASE_URL}/api/content/nodes/${resolvedParams.nodeId}/media${request.nextUrl.search}`,
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
      payload || { detail: "Failed to load media" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || []);
}
