import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const store = await cookies();
  const { jobId } = await params;
  const target = new URL(`/api/content/import/jobs/${encodeURIComponent(jobId)}`, API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json(
      { detail: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
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

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? (payload as { detail?: string }).detail
          : payload && typeof payload === "object" && "error" in payload
            ? (payload as { error?: string }).error
            : `Import job status failed (${response.status} ${response.statusText})`;
      return NextResponse.json(payload || { detail }, { status: response.status });
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed";
    return NextResponse.json(
      { detail: `Import job status request could not reach backend: ${message}` },
      { status: 502 }
    );
  }
}
