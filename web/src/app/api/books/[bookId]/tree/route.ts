import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const resolvedParams = await params;
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const target = new URL(
    `/api/content/books/${resolvedParams.bookId}/tree/nested`,
    API_BASE_URL
  );

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      headers: {
        Accept: "application/json",
        ...authHeader,
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Tree service unavailable. Please start the API server and try again." },
      { status: 503 }
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload || { detail: "Tree fetch failed" },
      { status: response.status }
    );
  }

  return NextResponse.json(payload);
}
