import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, buildAuthHeader, refreshAccessToken } from "@/lib/apiProxy";


export async function POST(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!accessToken && !refreshToken) {
    return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
  }

  const { uploadId } = await params;
  const formData = await request.formData();

  try {
    const target = new URL(
      `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/chunk`,
      API_BASE_URL
    );

    const doChunk = (token?: string) =>
      fetch(target.toString(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

    let response = await doChunk(accessToken);

    let rawText = await response.text();
    let payload: unknown = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = null;
      }
    }

    if (response.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken);
      if (refreshed?.access_token) {
        response = await doChunk(refreshed.access_token);
        rawText = await response.text();
        payload = null;
        if (rawText) {
          try {
            payload = JSON.parse(rawText);
          } catch {
            payload = null;
          }
        }

        const res = NextResponse.json(payload || {}, { status: response.status });
        res.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        res.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });
        return res;
      }
    }

    return NextResponse.json(payload || {}, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed";
    return NextResponse.json(
      { detail: `Canonical upload chunk failed: ${message}` },
      { status: 502 }
    );
  }
}
