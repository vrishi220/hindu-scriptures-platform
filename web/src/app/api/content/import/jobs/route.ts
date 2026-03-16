import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
export const maxDuration = 60;

export async function POST(request: Request) {
  const store = await cookies();
  const target = new URL("/api/content/import/jobs", API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json(
      { detail: "Authentication required" },
      { status: 401 }
    );
  }

  const body = await request.json();

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
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

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? (payload as { detail?: string }).detail
          : payload && typeof payload === "object" && "error" in payload
            ? (payload as { error?: string }).error
            : `Import job request failed (${response.status} ${response.statusText})`;
      return NextResponse.json(payload || { detail }, { status: response.status });
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed";
    return NextResponse.json(
      { detail: `Import job request could not reach backend: ${message}` },
      { status: 502 }
    );
  }
}
