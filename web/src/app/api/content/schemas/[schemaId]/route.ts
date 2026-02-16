import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ schemaId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
  const resolvedParams = await params;

  const response = await fetch(
    `${API_BASE_URL}/api/content/schemas/${resolvedParams.schemaId}`,
    {
      headers: {
        Accept: "application/json",
        ...authHeader,
      },
      cache: "no-store",
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to load schema" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ schemaId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
  const resolvedParams = await params;
  const body = await request.json().catch(() => null);

  const response = await fetch(
    `${API_BASE_URL}/api/content/schemas/${resolvedParams.schemaId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeader,
      },
      body: JSON.stringify(body),
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to update schema" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ schemaId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
  const resolvedParams = await params;

  const response = await fetch(
    `${API_BASE_URL}/api/content/schemas/${resolvedParams.schemaId}`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...authHeader,
      },
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Failed to delete schema" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || { message: "Deleted" });
}
