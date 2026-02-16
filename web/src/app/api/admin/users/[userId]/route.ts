import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const resolvedParams = await params;

  const response = await fetch(
    `${API_BASE_URL}/api/users/${resolvedParams.userId}`,
    {
      method: "DELETE",
      headers: {
        ...authHeader,
      },
    }
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return NextResponse.json(
      payload || { detail: "Failed to delete user" },
      { status: response.status }
    );
  }

  return new NextResponse(null, { status: 204 });
}
