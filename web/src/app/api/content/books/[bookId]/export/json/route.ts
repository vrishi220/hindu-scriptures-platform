import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
  }

  const resolvedParams = await params;
  const target = new URL(
    `/api/content/books/${resolvedParams.bookId}/export/json`,
    API_BASE_URL
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(payload || { detail: "Export failed" }, { status: response.status });
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { detail: "Export timed out after 5 minutes. Book may be too large." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { detail: "Export request failed" },
      { status: 500 }
    );
  }
}
