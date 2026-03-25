import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
  }

  const { uploadId } = await params;

  try {
    const target = new URL(
      `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/complete`,
      API_BASE_URL
    );

    const response = await fetch(target.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const rawText = await response.text();
    let payload: unknown = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = null;
      }
    }

    return NextResponse.json(payload || {}, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed";
    return NextResponse.json(
      { detail: `Canonical upload completion failed: ${message}` },
      { status: 502 }
    );
  }
}
