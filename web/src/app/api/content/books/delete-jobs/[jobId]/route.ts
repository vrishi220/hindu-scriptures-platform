import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const ACCESS_TOKEN_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "access_token";
const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE || "refresh_token";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const target = new URL(
    `/api/content/books/delete-jobs/${encodeURIComponent(jobId)}`,
    API_BASE_URL
  );

  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!accessToken && !refreshToken) {
    return NextResponse.json(
      { detail: "Authentication required" },
      { status: 401 }
    );
  }

  const doGet = (token?: string) =>
    fetch(target.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  try {
    let response = await doGet(accessToken);
    let payload = (await response.json().catch(() => null)) as
      | { detail?: string; error?: string }
      | null;

    if (response.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken);
      if (refreshed?.access_token) {
        response = await doGet(refreshed.access_token);
        payload = (await response.json().catch(() => null)) as
          | { detail?: string; error?: string }
          | null;

        const res = NextResponse.json(payload || {}, {
          status: response.status,
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
        });
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
      return NextResponse.json(
        payload || { detail: "Delete job status failed" },
        {
          status: response.status,
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
        }
      );
    }

    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch {
    return NextResponse.json(
      { detail: "Delete job status request could not reach backend" },
      {
        status: 502,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      }
    );
  }
}
