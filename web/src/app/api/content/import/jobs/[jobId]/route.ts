import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";

const refreshAccessToken = async (refreshToken: string) => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as
    | { access_token: string; refresh_token: string }
    | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const store = await cookies();
  const { jobId } = await params;
  const target = new URL(`/api/content/import/jobs/${encodeURIComponent(jobId)}`, API_BASE_URL);

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!accessToken && !refreshToken) {
    return NextResponse.json(
      { detail: "Authentication required" },
      { status: 401 }
    );
  }

  const doStatusGet = (token?: string) =>
    fetch(target.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  try {
    let response = await doStatusGet(accessToken);

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
        response = await doStatusGet(refreshed.access_token);
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
          sameSite: "lax",
          path: "/",
        });
        res.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refresh_token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
        return res;
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
