import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ schemaId: string }> }
) {
  const { schemaId } = await params;
  const store = await cookies();
  const target = new URL(`/api/content/schemas/${schemaId}`, API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: "DELETE",
      headers,
    });
  } catch {
    return NextResponse.json(
      { detail: "Content service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Schema deletion failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
