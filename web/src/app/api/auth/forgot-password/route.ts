import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.email) {
    return NextResponse.json({ detail: "Email required" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email }),
    });
  } catch {
    return NextResponse.json(
      { detail: "Auth service unavailable. Please try again shortly." },
      { status: 503 }
    );
  }

  const rawText = await response.text().catch(() => "");
  const payload = (() => {
    if (!rawText) return null;
    try {
      return JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (!response.ok) {
    const fallbackDetail = rawText || response.statusText || "Forgot password failed";
    return NextResponse.json(
      payload || { detail: `Forgot password failed (${response.status}): ${fallbackDetail}` },
      { status: response.status }
    );
  }

  return NextResponse.json(payload || { message: "If an account exists, a reset link has been generated." });
}
