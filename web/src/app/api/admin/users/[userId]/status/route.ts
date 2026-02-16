import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const body = await request.json().catch(() => null);
  const resolvedParams = await params;

  const isActiveParam = body?.is_active !== undefined ? `?is_active=${body.is_active}` : "";

  const response = await fetch(
    `${API_BASE_URL}/api/users/${resolvedParams.userId}/status${isActiveParam}`,
    {
      method: "PATCH",
      headers: {
        ...authHeader,
      },
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to update status" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
