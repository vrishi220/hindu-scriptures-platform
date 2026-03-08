import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";

export async function GET() {
  try {
    const target = new URL("/health", API_BASE_URL);
    const response = await fetch(target.toString(), {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        payload || { detail: "Health check failed" },
        { status: response.status }
      );
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Error fetching backend health:", error);
    return NextResponse.json(
      { detail: "Backend health unavailable" },
      { status: 502 }
    );
  }
}
