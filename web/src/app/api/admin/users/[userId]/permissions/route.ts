import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function PATCH(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const body = await request.json().catch(() => null);
  const resolvedParams = await Promise.resolve(params);

  const response = await fetch(
    `${API_BASE_URL}/api/users/${resolvedParams.userId}/permissions`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify(body),
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to update permissions" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
