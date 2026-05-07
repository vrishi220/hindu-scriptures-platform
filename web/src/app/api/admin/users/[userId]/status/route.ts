import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, buildAuthHeader } from "@/lib/apiProxy";


export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
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
