import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.API_BASE_URL || "http://localhost:8000/api";

async function buildAuthHeader(): Promise<string | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;
  return accessToken ? `Bearer ${accessToken}` : null;
}

async function refreshAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const newAccessToken = data.access_token;

    // Update cookie
    cookieStore.set("access_token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 15, // 15 minutes
    });

    return newAccessToken;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  let authHeader = await buildAuthHeader();

  // Public endpoint - auth is optional
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/nodes/${id}`, {
      headers,
    });

    // If access token expired, try to refresh (only if we had auth)
    if (response.status === 401 && authHeader) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${API_BASE_URL}/nodes/${id}`, {
          headers,
        });

        if (retryResponse.ok) {
          const data = await retryResponse.json();
          return NextResponse.json(data);
        }

        return NextResponse.json(
          { error: "Failed to fetch node" },
          { status: retryResponse.status }
        );
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText || "Failed to fetch node" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching node:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
