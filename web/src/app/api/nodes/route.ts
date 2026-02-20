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

export async function POST(request: Request) {
  let authHeader = await buildAuthHeader();

  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/nodes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    // If access token expired, try to refresh
    if (response.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        authHeader = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${API_BASE_URL}/nodes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify(body),
        });

        if (retryResponse.ok) {
          const data = await retryResponse.json();
          return NextResponse.json(data, { status: 201 });
        }

        return NextResponse.json(
          { error: "Failed to create node" },
          { status: retryResponse.status }
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText || "Failed to create node" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error creating node:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
